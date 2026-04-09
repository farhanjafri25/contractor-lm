import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SponsorAction,
  SponsorActionDocument,
  SponsorActionType,
  SponsorActionStatus,
} from '../../schemas/sponsor-action.schema';
import {
  ContractorContract,
  ContractorContractDocument,
  ContractStatus,
} from '../../schemas/contractor-contract.schema';
import {
  LifecycleEvent,
  LifecycleEventDocument,
  EventType,
  ActorType,
} from '../../schemas/lifecycle-event.schema';
import {
  CreateSponsorActionDto,
  ReviewSponsorActionDto,
  ReviewDecision,
  ListSponsorActionsDto,
} from './dto/sponsor-action.dto';
import { ContractsService } from '../contracts/contracts.service';

// Sponsors must respond within this many days before their reminder deadline
const RESPONSE_DEADLINE_DAYS = 7;

@Injectable()
export class SponsorService {
  constructor(
    @InjectModel(SponsorAction.name)
    private sponsorActionModel: Model<SponsorActionDocument>,

    @InjectModel(ContractorContract.name)
    private contractModel: Model<ContractorContractDocument>,

    @InjectModel(LifecycleEvent.name)
    private eventModel: Model<LifecycleEventDocument>,

    @Inject(forwardRef(() => ContractsService))
    private contractsService: ContractsService,
  ) { }

  // ─────────────────────────────────────────────────────────
  // LIST — GET /sponsor/actions
  // Can be filtered by status and/or contract_id
  // Sponsors see only their own; admins see all (enforced at controller)
  // ─────────────────────────────────────────────────────────
  async findAll(tenantId: string, query: ListSponsorActionsDto, sponsorId?: string) {
    const filter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
    };
    if (sponsorId) filter.sponsor_id = new Types.ObjectId(sponsorId);
    if (query.status) filter.status = query.status;
    if (query.contract_id) filter.contract_id = new Types.ObjectId(query.contract_id);

    const actions = await this.sponsorActionModel
      .find(filter)
      .populate({
        path: 'contract_id',
        select: 'contractor_id start_date end_date status',
        populate: { path: 'contractor_id', select: 'name department email' }
      })
      .populate('sponsor_id', 'email role')
      .populate('reviewed_by', 'email role')
      .sort({ createdAt: -1 })
      .lean();

    return { data: actions, total: actions.length };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE — GET /sponsor/actions/:id
  // ─────────────────────────────────────────────────────────
  async findOne(actionId: string, tenantId: string) {
    const action = await this.sponsorActionModel
      .findOne({ _id: new Types.ObjectId(actionId), tenant_id: new Types.ObjectId(tenantId) })
      .populate({
        path: 'contract_id',
        select: 'contractor_id start_date end_date status',
        populate: { path: 'contractor_id', select: 'name department email' }
      })
      .populate('sponsor_id', 'email role')
      .populate('reviewed_by', 'email role')
      .lean();

    if (!action) throw new NotFoundException('Sponsor action not found');
    return action;
  }

  // ─────────────────────────────────────────────────────────
  // SUBMIT — POST /sponsor/actions
  // Sponsor creates an extension or termination request
  // ─────────────────────────────────────────────────────────
  async submit(dto: CreateSponsorActionDto, tenantId: string, sponsorId: string) {
    const tenantOid = new Types.ObjectId(tenantId);
    const sponsorOid = new Types.ObjectId(sponsorId);
    const contractOid = new Types.ObjectId(dto.contract_id);

    // Verify contract belongs to this tenant and is active
    const contract = await this.contractModel.findOne({
      _id: contractOid,
      tenant_id: tenantOid,
      status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.SUSPENDED] },
    });
    if (!contract) throw new NotFoundException('Active contract not found');

    // Verify the caller is the assigned sponsor OR the creator of this contract
    const isAssignedSponsor = contract.sponsor_id && contract.sponsor_id.toString() === sponsorId;
    const isCreator = contract.created_by && contract.created_by.toString() === sponsorId;

    if (!isAssignedSponsor && !isCreator) {
      throw new ForbiddenException('Only the assigned sponsor or the creator can submit an action for this contract');
    }

    // Prevent duplicate pending requests
    const existingPending = await this.sponsorActionModel.findOne({
      contract_id: contractOid,
      status: SponsorActionStatus.PENDING,
    });
    if (existingPending) {
      throw new BadRequestException('A pending action already exists for this contract');
    }

    // Validate extension-specific fields
    if (dto.action_type === SponsorActionType.EXTEND) {
      if (!dto.proposed_end_date) {
        throw new BadRequestException('proposed_end_date is required for extend requests');
      }
      const proposedDate = new Date(dto.proposed_end_date);
      if (proposedDate <= new Date(contract.end_date)) {
        throw new BadRequestException('proposed_end_date must be after the current end_date');
      }
    }

    const responseDeadline = new Date();
    responseDeadline.setDate(responseDeadline.getDate() + RESPONSE_DEADLINE_DAYS);

    const action = await this.sponsorActionModel.create({
      contract_id: contractOid,
      tenant_id: tenantOid,
      sponsor_id: sponsorOid,
      action_type: dto.action_type,
      proposed_end_date: dto.proposed_end_date ? new Date(dto.proposed_end_date) : null,
      justification: dto.justification,
      status: SponsorActionStatus.PENDING,
      response_deadline: responseDeadline,
    });

    let submitEventType = EventType.EXTENSION_REQUEST_SUBMITTED;
    if (dto.action_type === SponsorActionType.TERMINATE) {
      submitEventType = EventType.TERMINATION_REQUEST_SUBMITTED;
    } else if (dto.action_type === SponsorActionType.ONBOARD) {
      submitEventType = EventType.ONBOARDING_REQUESTED;
    }

    // Both EXTEND and TERMINATE now go through admin approval
    await this.eventModel.create({
      tenant_id: tenantOid,
      contractor_id: contract.contractor_id,
      contract_id: contractOid,
      event_type: submitEventType,
      actor_type: ActorType.SPONSOR,
      actor_id: sponsorOid,
      metadata: {
        action_id: action._id,
        action_type: dto.action_type,
        proposed_end_date: dto.proposed_end_date ?? null,
        justification: dto.justification,
      },
    });

    return action;
  }

  // ─────────────────────────────────────────────────────────
  // REVIEW — PATCH /sponsor/actions/:id/review
  // Admin approves or rejects a pending extension request
  // ─────────────────────────────────────────────────────────
  async review(
    actionId: string,
    tenantId: string,
    reviewerUserId: string,
    dto: ReviewSponsorActionDto,
  ) {
    const action = await this.sponsorActionModel.findOne({
      _id: new Types.ObjectId(actionId),
      tenant_id: new Types.ObjectId(tenantId),
      status: SponsorActionStatus.PENDING,
    });
    if (!action) throw new NotFoundException('Pending action not found');

    // Only extension, terminate, and onboard requests go through admin review
    if (![SponsorActionType.EXTEND, SponsorActionType.TERMINATE, SponsorActionType.ONBOARD].includes(action.action_type as SponsorActionType)) {
      throw new BadRequestException('This action type does not require admin review');
    }

    const reviewerOid = new Types.ObjectId(reviewerUserId);
    const now = new Date();
    const isApproved = dto.decision === ReviewDecision.APPROVED;

    await this.sponsorActionModel.findByIdAndUpdate(action._id, {
      status: isApproved ? SponsorActionStatus.APPROVED : SponsorActionStatus.REJECTED,
      reviewed_by: reviewerOid,
      reviewed_at: now,
      review_note: dto.review_note ?? null,
      ...(isApproved ? { new_end_date: action.proposed_end_date } : {}),
      actioned_at: now,
    });

    let eventType: EventType;
    if (action.action_type === SponsorActionType.EXTEND) {
      eventType = isApproved ? EventType.EXTENSION_REQUEST_APPROVED : EventType.EXTENSION_REQUEST_REJECTED;
    } else if (action.action_type === SponsorActionType.TERMINATE) {
      eventType = isApproved ? EventType.CONTRACT_TERMINATED : EventType.EXTENSION_REQUEST_REJECTED; // Re-use EXTENSION_REJECTED or add TERMINATE_REJECTED if needed
    } else {
      eventType = isApproved ? EventType.CONTRACTOR_ONBOARDED : EventType.EXTENSION_REQUEST_REJECTED;
    }

    // If approved — apply the action to the contract
    if (isApproved && action.action_type === SponsorActionType.EXTEND && action.proposed_end_date) {
      await this.contractsService.applyApprovedExtension(
        action.contract_id.toString(),
        action.proposed_end_date,
        reviewerUserId,
        action._id.toString(),
      );
    } else if (isApproved && action.action_type === SponsorActionType.TERMINATE) {
      await this.contractsService.terminate(
        action.contract_id.toString(),
        tenantId,
        reviewerUserId,
      );
    } else if (isApproved && action.action_type === SponsorActionType.ONBOARD) {
      await this.contractsService.approveOnboarding(
        action.contract_id.toString(),
        reviewerUserId,
        action._id.toString(),
      );
    }

    // Fetch the contract for the lifecycle event
    const contract = await this.contractModel.findById(action.contract_id);

    // For ONBOARD actions, the actual success event is logged inside `approveOnboarding`, but we'll log the review decision here too.
    let _eventType: EventType;
    if (action.action_type === SponsorActionType.EXTEND) {
      _eventType = isApproved ? EventType.EXTENSION_REQUEST_APPROVED : EventType.EXTENSION_REQUEST_REJECTED;
    } else if (action.action_type === SponsorActionType.TERMINATE) {
      _eventType = isApproved ? EventType.TERMINATION_REQUEST_APPROVED : EventType.TERMINATION_REQUEST_REJECTED;
    } else {
      _eventType = isApproved ? EventType.CONTRACTOR_ONBOARDED : EventType.EXTENSION_REQUEST_REJECTED;
    }

    await this.eventModel.create({
      tenant_id: action.tenant_id,
      contractor_id: contract?.contractor_id ?? action.contract_id,
      contract_id: action.contract_id,
      event_type: _eventType as EventType,
      actor_type: ActorType.USER,
      actor_id: reviewerOid,
      metadata: {
        action_id: action._id,
        decision: dto.decision,
        review_note: dto.review_note ?? null,
        new_end_date: (isApproved && action.action_type === SponsorActionType.EXTEND) ? action.proposed_end_date : null,
      },
    });

    return {
      success: true,
      decision: dto.decision,
      new_end_date: isApproved ? action.proposed_end_date : null,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — immediate termination for terminate actions
  // ─────────────────────────────────────────────────────────
  private async _executeTermination(
    action: SponsorActionDocument,
    contract: ContractorContractDocument,
    sponsorId: string,
  ) {
    // Mark action as approved (self-authorised — no admin needed for terminations)
    await this.sponsorActionModel.findByIdAndUpdate(action._id, {
      status: SponsorActionStatus.APPROVED,
      reviewed_by: action.sponsor_id,
      reviewed_at: new Date(),
      actioned_at: new Date(),
    });

    // Delegate termination to ContractsService
    const result = await this.contractsService.terminate(
      contract._id.toString(),
      contract.tenant_id.toString(),
      sponsorId,
    );

    return {
      ...result,
      action_id: action._id,
      message: 'Contract terminated and access revocations queued',
    };
  }
}
