import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model, Types } from 'mongoose';
import type { Queue } from 'bull';
import { ContractorAccess } from '../../schemas/contractor-access.schema';
import type { ContractorAccessDocument } from '../../schemas/contractor-access.schema';
import { ProvisioningStatus } from '../../schemas/contractor-access.schema';
import { ContractorContract } from '../../schemas/contractor-contract.schema';
import type { ContractorContractDocument } from '../../schemas/contractor-contract.schema';
import { ContractStatus } from '../../schemas/contractor-contract.schema';
import { LifecycleEvent } from '../../schemas/lifecycle-event.schema';
import type { LifecycleEventDocument } from '../../schemas/lifecycle-event.schema';
import { EventType, ActorType } from '../../schemas/lifecycle-event.schema';
import { ListAccessDto, UpdateAccessDto } from './dto/access.dto';

// Max retries before we stop auto-requeueing
const MAX_REVOCATION_ATTEMPTS = 3;

@Injectable()
export class AccessService {
  constructor(
    @InjectModel(ContractorAccess.name)
    private accessModel: Model<ContractorAccessDocument>,

    @InjectModel(ContractorContract.name)
    private contractModel: Model<ContractorContractDocument>,

    @InjectModel(LifecycleEvent.name)
    private eventModel: Model<LifecycleEventDocument>,

    @InjectQueue('revocation')
    private revocationQueue: Queue,

    @InjectQueue('provisioning')
    private provisioningQueue: Queue,
  ) { }

  // ─────────────────────────────────────────────────────────
  // LIST — GET /access
  // All access records for the tenant, filterable
  // ─────────────────────────────────────────────────────────
  async findAll(tenantId: string, query: ListAccessDto) {
    const filter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
    };
    if (query.status) filter.provisioning_status = query.status;
    if (query.contract_id) filter.contract_id = new Types.ObjectId(query.contract_id);
    if (query.contractor_id) filter.contractor_id = new Types.ObjectId(query.contractor_id);
    if (query.tenant_application_id) {
      filter.tenant_application_id = new Types.ObjectId(query.tenant_application_id);
    }

    const records = await this.accessModel
      .find(filter)
      .populate('contractor_id', 'name email department')
      .populate('contract_id', 'start_date end_date status')
      .populate('tenant_application_id', 'application_id status')
      .populate('granted_by', 'email role')
      .sort({ createdAt: -1 })
      .lean();

    return { data: records, total: records.length };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE — GET /access/:id
  // ─────────────────────────────────────────────────────────
  async findOne(accessId: string, tenantId: string) {
    const record = await this.accessModel
      .findOne({
        _id: new Types.ObjectId(accessId),
        tenant_id: new Types.ObjectId(tenantId),
      })
      .populate('contractor_id', 'name email department job_title')
      .populate('contract_id', 'start_date end_date status extension_count')
      .populate('tenant_application_id', 'application_id status')
      .populate('granted_by', 'email role')
      .lean();

    if (!record) throw new NotFoundException('Access record not found');
    return record;
  }

  // ─────────────────────────────────────────────────────────
  // GET BY CONTRACT — GET /access/contract/:contractId
  // Full provisioning picture for a single contract
  // ─────────────────────────────────────────────────────────
  async findByContract(contractId: string, tenantId: string) {
    const [contract, accessRecords] = await Promise.all([
      this.contractModel
        .findOne({
          _id: new Types.ObjectId(contractId),
          tenant_id: new Types.ObjectId(tenantId),
        })
        .populate('contractor_id', 'name email department')
        .populate('sponsor_id', 'email role')
        .lean(),

      this.accessModel
        .find({
          contract_id: new Types.ObjectId(contractId),
          tenant_id: new Types.ObjectId(tenantId),
        })
        .populate('tenant_application_id', 'application_id status')
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    if (!contract) throw new NotFoundException('Contract not found');

    // Summarise provisioning state across all apps
    const summary = {
      total: accessRecords.length,
      active: accessRecords.filter((r) => r.provisioning_status === ProvisioningStatus.ACTIVE).length,
      pending: accessRecords.filter((r) => r.provisioning_status === ProvisioningStatus.PENDING).length,
      revoked: accessRecords.filter((r) => r.provisioning_status === ProvisioningStatus.REVOKED).length,
      failed: accessRecords.filter((r) => r.provisioning_status === ProvisioningStatus.FAILED).length,
    };

    return { contract, access: accessRecords, summary };
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE — PATCH /access/:id
  // Override external_account_id or access_role (admin correction)
  // ─────────────────────────────────────────────────────────
  async update(accessId: string, tenantId: string, userId: string, dto: UpdateAccessDto) {
    const record = await this.accessModel.findOne({
      _id: new Types.ObjectId(accessId),
      tenant_id: new Types.ObjectId(tenantId),
    });
    if (!record) throw new NotFoundException('Access record not found');

    const updates: Record<string, any> = {};
    if (dto.external_account_id !== undefined) updates.external_account_id = dto.external_account_id;
    if (dto.access_role !== undefined) updates.access_role = dto.access_role;

    if (!Object.keys(updates).length) {
      throw new BadRequestException('No fields provided to update');
    }

    const updated = await this.accessModel
      .findByIdAndUpdate(record._id, { $set: updates }, { new: true })
      .lean();

    await this.eventModel.create({
      tenant_id: record.tenant_id,
      contractor_id: record.contractor_id,
      contract_id: record.contract_id,
      access_id: record._id,
      event_type: EventType.ACCESS_GRANTED,   // re-use access.granted for manual corrections
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: { action: 'manual_update', changes: updates },
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // RETRY REVOCATION — POST /access/:id/retry-revocation
  // Re-queues a failed revocation if under the max attempt limit
  // ─────────────────────────────────────────────────────────
  async retryRevocation(accessId: string, tenantId: string, userId: string) {
    const record = await this.accessModel.findOne({
      _id: new Types.ObjectId(accessId),
      tenant_id: new Types.ObjectId(tenantId),
      provisioning_status: ProvisioningStatus.FAILED,
    });

    if (!record) {
      throw new NotFoundException('Failed access record not found for this tenant');
    }

    if (record.revocation_attempts >= MAX_REVOCATION_ATTEMPTS) {
      throw new BadRequestException(
        `Max revocation attempts (${MAX_REVOCATION_ATTEMPTS}) reached. ` +
        `Use the manual override (PATCH /access/:id) to mark as resolved.`,
      );
    }

    // Reset status to pending before requeueing
    await this.accessModel.findByIdAndUpdate(record._id, {
      provisioning_status: ProvisioningStatus.PENDING,
      failure_reason: null,
      last_attempt_at: null,
    });

    await this.revocationQueue.add(
      'revoke-access',
      {
        access_id: record._id.toString(),
        contract_id: record.contract_id.toString(),
        contractor_id: record.contractor_id.toString(),
        tenant_id: tenantId,
        tenant_application_id: record.tenant_application_id.toString(),
        external_account_id: record.external_account_id,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return { success: true, access_id: accessId, message: 'Revocation re-queued' };
  }

  // ─────────────────────────────────────────────────────────
  // MARK RESOLVED — POST /access/:id/mark-resolved
  // Admin acknowledges a failed record that cannot be auto-revoked
  // (e.g. account was manually deleted in the remote app)
  // ─────────────────────────────────────────────────────────
  async markResolved(accessId: string, tenantId: string, userId: string) {
    const record = await this.accessModel.findOne({
      _id: new Types.ObjectId(accessId),
      tenant_id: new Types.ObjectId(tenantId),
    });

    if (!record) throw new NotFoundException('Access record not found');

    if (record.provisioning_status === ProvisioningStatus.REVOKED) {
      throw new BadRequestException('Access record is already revoked');
    }

    await this.accessModel.findByIdAndUpdate(record._id, {
      provisioning_status: ProvisioningStatus.REVOKED,
      revoked_at: new Date(),
      revoked_by: userId,
      failure_reason: null,
    });

    await this.eventModel.create({
      tenant_id: record.tenant_id,
      contractor_id: record.contractor_id,
      contract_id: record.contract_id,
      access_id: record._id,
      event_type: EventType.ACCESS_REVOKED,
      actor_type: ActorType.USER,
      actor_id: new Types.ObjectId(userId),
      metadata: { action: 'manually_resolved', previous_status: record.provisioning_status },
    });

    return { success: true, access_id: accessId, status: ProvisioningStatus.REVOKED };
  }
}
