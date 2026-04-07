import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import {
  ContractorContract,
  ContractorContractDocument,
  ContractStatus,
  TerminationReason,
} from '../../schemas/contractor-contract.schema';
import {
  ContractorAccess,
  ContractorAccessDocument,
  ProvisioningStatus,
} from '../../schemas/contractor-access.schema';
import {
  LifecycleEvent,
  LifecycleEventDocument,
  EventType,
  ActorType,
} from '../../schemas/lifecycle-event.schema';
import { SuspendContractDto, ReactivateContractDto, ExtendContractDto } from './dto/contract-actions.dto';

@Injectable()
export class ContractsService {
  constructor(
    @InjectModel(ContractorContract.name)
    private contractModel: Model<ContractorContractDocument>,

    @InjectModel(ContractorAccess.name)
    private accessModel: Model<ContractorAccessDocument>,

    @InjectModel(LifecycleEvent.name)
    private eventModel: Model<LifecycleEventDocument>,

    @InjectQueue('revocation')
    private revocationQueue: Queue,

    @InjectQueue('provisioning')
    private provisioningQueue: Queue,
  ) { }

  // ─────────────────────────────────────────────────────────
  // GET /contractors/:id/contracts/:contractId
  // ─────────────────────────────────────────────────────────
  async findOne(contractId: string, tenantId: string) {
    const contract = await this.contractModel
      .findOne({ _id: new Types.ObjectId(contractId), tenant_id: new Types.ObjectId(tenantId) })
      .populate('sponsor_id', 'email role')
      .populate('contractor_id', 'name email')
      .lean();

    if (!contract) throw new NotFoundException('Contract not found');

    const accessRecords = await this.accessModel
      .find({ contract_id: contract._id })
      .populate('tenant_application_id', 'application_id status')
      .lean();

    return { ...contract, access: accessRecords };
  }

  // ─────────────────────────────────────────────────────────
  // SUSPEND — POST /contractors/:id/contracts/:contractId/suspend
  // ─────────────────────────────────────────────────────────
  async suspend(
    contractId: string,
    tenantId: string,
    userId: string,
    dto: SuspendContractDto,
  ) {
    const contract = await this._getActiveContract(contractId, tenantId, [
      ContractStatus.ACTIVE,
      ContractStatus.EXTENDED,
    ]);

    await this.contractModel.findByIdAndUpdate(contract._id, {
      status: ContractStatus.SUSPENDED,
    });

    // Queue revocation for all active access records (with suspend action)
    const accessRecords = await this.accessModel.find({
      contract_id: contract._id,
      provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
    });

    for (const access of accessRecords) {
      await this.revocationQueue.add(
        'revoke-access',
        {
          access_id: access._id.toString(),
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          tenant_application_id: access.tenant_application_id.toString(),
          external_account_id: access.external_account_id,
          action: 'suspend',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    if (contract.create_google_account) {
      await this.revocationQueue.add(
        'revoke-google',
        {
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          action: 'suspend',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    if (contract.create_slack_account) {
      await this.revocationQueue.add(
        'revoke-slack',
        {
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          action: 'suspend',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    // Log event
    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACT_SUSPENDED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: { 
        reason: dto.reason, 
        note: dto.note ?? null,
        revocations_queued: accessRecords.length 
      },
    });

    return { success: true, status: ContractStatus.SUSPENDED, revocations_queued: accessRecords.length };
  }

  // ─────────────────────────────────────────────────────────
  // REACTIVATE — POST /contractors/:id/contracts/:contractId/reactivate
  // ─────────────────────────────────────────────────────────
  async reactivate(
    contractId: string,
    tenantId: string,
    userId: string,
    dto: ReactivateContractDto,
  ) {
    const contract = await this._getActiveContract(contractId, tenantId, [
      ContractStatus.SUSPENDED,
    ]);

    // Guard: don't reactivate if past end date
    if (new Date(contract.end_date) < new Date()) {
      throw new BadRequestException('Contract end_date has already passed — cannot reactivate');
    }

    await this.contractModel.findByIdAndUpdate(contract._id, {
      status: ContractStatus.ACTIVE,
    });

    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACT_REACTIVATED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: { note: dto.note ?? null },
    });

    return { success: true, status: ContractStatus.ACTIVE };
  }

  // ─────────────────────────────────────────────────────────
  // DIRECT EXTEND — PATCH /contractors/:id/contracts/:contractId/extend
  // Admin-only fast path that bypasses the sponsor approval flow
  // ─────────────────────────────────────────────────────────
  async extend(
    contractId: string,
    tenantId: string,
    userId: string,
    dto: ExtendContractDto,
  ) {
    const contract = await this._getActiveContract(contractId, tenantId, [
      ContractStatus.ACTIVE,
      ContractStatus.EXTENDED,
      ContractStatus.SUSPENDED,
    ]);

    const newEndDate = new Date(dto.new_end_date);
    if (newEndDate <= new Date(contract.end_date)) {
      throw new BadRequestException('new_end_date must be after the current end_date');
    }

    await this.contractModel.findByIdAndUpdate(contract._id, {
      end_date: newEndDate,
      status: ContractStatus.EXTENDED,
      $inc: { extension_count: 1 },
    });

    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACT_EXTENDED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: {
        previous_end_date: contract.end_date,
        new_end_date: newEndDate,
        note: dto.note ?? null,
      },
    });

    return { success: true, new_end_date: newEndDate, status: ContractStatus.EXTENDED };
  }

  // ─────────────────────────────────────────────────────────
  // TERMINATE — POST /contractors/:id/contracts/:contractId/terminate
  // Immediately revokes all access and closes the contract
  // ─────────────────────────────────────────────────────────
  async terminate(
    contractId: string,
    tenantId: string,
    userId: string,
    reason: TerminationReason = TerminationReason.EARLY_TERMINATION,
  ) {
    const contract = await this._getActiveContract(contractId, tenantId, [
      ContractStatus.ACTIVE,
      ContractStatus.EXTENDED,
      ContractStatus.SUSPENDED,
    ]);

    await this.contractModel.findByIdAndUpdate(contract._id, {
      status: ContractStatus.TERMINATED,
      termination_reason: reason,
    });

    // Queue revocation for all active access records
    const accessRecords = await this.accessModel.find({
      contract_id: contract._id,
      provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
    });

    for (const access of accessRecords) {
      await this.revocationQueue.add(
        'revoke-access',
        {
          access_id: access._id.toString(),
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          tenant_application_id: access.tenant_application_id.toString(),
          external_account_id: access.external_account_id,
          action: 'delete',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    if (contract.create_google_account) {
      await this.revocationQueue.add(
        'revoke-google',
        {
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          action: 'delete',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    if (contract.create_slack_account) {
      await this.revocationQueue.add(
        'revoke-slack',
        {
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: tenantId,
          action: 'delete',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACT_TERMINATED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: {
        reason,
        revocations_queued: accessRecords.length,
      },
    });

    return {
      success: true,
      status: ContractStatus.TERMINATED,
      revocations_queued: accessRecords.length,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────
  private async _getActiveContract(
    contractId: string,
    tenantId: string,
    allowedStatuses: ContractStatus[],
  ): Promise<ContractorContractDocument> {
    const contract = await this.contractModel.findOne({
      _id: new Types.ObjectId(contractId),
      tenant_id: new Types.ObjectId(tenantId),
    });

    if (!contract) throw new NotFoundException('Contract not found');

    if (!allowedStatuses.includes(contract.status)) {
      throw new BadRequestException(
        `Action not allowed on a contract with status '${contract.status}'. ` +
        `Allowed statuses: ${allowedStatuses.join(', ')}.`,
      );
    }

    return contract;
  }

  /**
   * Called by SponsorService after admin approves an extension request.
   * Applies the new end_date and logs the extension event.
   */
  async applyApprovedExtension(
    contractId: string,
    newEndDate: Date,
    approvedByUserId: string,
    sponsorActionId: string,
  ): Promise<void> {
    const contract = await this.contractModel.findById(contractId);
    if (!contract) throw new NotFoundException('Contract not found');

    await this.contractModel.findByIdAndUpdate(contract._id, {
      end_date: newEndDate,
      status: ContractStatus.EXTENDED,
      $inc: { extension_count: 1 },
    });

    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACT_EXTENDED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(approvedByUserId),
      metadata: {
        previous_end_date: contract.end_date,
        new_end_date: newEndDate,
        via_sponsor_action: sponsorActionId,
      },
    });
  }

  /**
   * Called by SponsorService after admin approves an ONBOARD request.
   */
  async approveOnboarding(contractId: string, approvedByUserId: string, sponsorActionId: string) {
    const contract = await this.contractModel.findById(contractId);
    if (!contract) throw new NotFoundException('Contract not found');

    await this.contractModel.findByIdAndUpdate(contract._id, {
      status: ContractStatus.ACTIVE,
    });

    const accessRecords = await this.accessModel.find({
      contract_id: contract._id,
      provisioning_status: ProvisioningStatus.PENDING,
    });

    for (const access of accessRecords) {
      await this.provisioningQueue.add(
        'provision-access',
        {
          access_id: access._id.toString(),
          contract_id: contract._id.toString(),
          contractor_id: contract.contractor_id.toString(),
          tenant_id: contract.tenant_id.toString(),
          tenant_application_id: access.tenant_application_id.toString(),
          external_account_id: access.external_account_id,
          access_role: access.access_role,
          create_google_account: contract.create_google_account,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
      );
    }

    if (contract.create_google_account) {
      await this.provisioningQueue.add('provision-google', {
        tenant_id: contract.tenant_id.toString(),
        contractor_id: contract.contractor_id.toString(),
        contract_id: contract._id.toString(),
      });
    }

    if (contract.create_slack_account) {
      await this.provisioningQueue.add('provision-slack', {
        tenant_id: contract.tenant_id.toString(),
        contractor_id: contract.contractor_id.toString(),
        contract_id: contract._id.toString(),
      });
    }

    await this.eventModel.create({
      tenant_id: contract.tenant_id,
      contractor_id: contract.contractor_id,
      contract_id: contract._id,
      event_type: EventType.CONTRACTOR_ONBOARDED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(approvedByUserId),
      metadata: {
        via_sponsor_action: sponsorActionId,
        apps_provisioned: accessRecords.length,
      },
    });
  }
}
