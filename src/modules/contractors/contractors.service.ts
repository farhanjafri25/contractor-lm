import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import {
  ContractorIdentity,
  ContractorIdentityDocument,
} from '../../schemas/contractor-identity.schema';
import {
  ContractorContract,
  ContractorContractDocument,
  ContractStatus,
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
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { ListContractorsDto } from './dto/list-contractors.dto';
import { SponsorAction, SponsorActionDocument, SponsorActionType, SponsorActionStatus } from '../../schemas/sponsor-action.schema';

@Injectable()
export class ContractorsService {
  constructor(
    @InjectModel(ContractorIdentity.name)
    private identityModel: Model<ContractorIdentityDocument>,

    @InjectModel(ContractorContract.name)
    private contractModel: Model<ContractorContractDocument>,

    @InjectModel(ContractorAccess.name)
    private accessModel: Model<ContractorAccessDocument>,

    @InjectModel(LifecycleEvent.name)
    private eventModel: Model<LifecycleEventDocument>,

    @InjectQueue('provisioning')
    private provisioningQueue: Queue,

    @InjectQueue('import')
    private importQueue: Queue,

    @InjectModel(SponsorAction.name)
    private sponsorActionModel: Model<SponsorActionDocument>,
  ) { }

  // ─────────────────────────────────────────────────────────
  // LIST — GET /contractors
  // ─────────────────────────────────────────────────────────
  async findAll(tenantId: string, query: ListContractorsDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    // Build an identity-level filter
    const identityFilter: Record<string, any> = { tenant_id: new Types.ObjectId(tenantId) };
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      identityFilter.$or = [{ name: regex }, { email: regex }];
    }
    if (query.department) identityFilter.department = query.department;

    // Build a contract-level filter for the active contract lookup
    const contractFilter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
    };

    // If there's a strict contract filter, pre-fetch valid contractor IDs
    if (query.status || query.sponsor_id) {
      if (query.status) contractFilter.status = query.status;
      if (query.sponsor_id) contractFilter.sponsor_id = new Types.ObjectId(query.sponsor_id);

      const matchingContracts = await this.contractModel
        .find(contractFilter)
        .select('contractor_id')
        .lean();
        
      identityFilter._id = { $in: matchingContracts.map(c => c.contractor_id) };
    }

    const [identities, total] = await Promise.all([
      this.identityModel.find(identityFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.identityModel.countDocuments(identityFilter),
    ]);

    // Attach the most recent relevant contract to each identity
    const contractorIds = identities.map((i) => i._id);
    const recentContracts = await this.contractModel
      .find({ tenant_id: new Types.ObjectId(tenantId), contractor_id: { $in: contractorIds } })
      .sort({ createdAt: -1 })
      .populate('sponsor_id', 'email role')
      .lean();

    const contractMap = new Map();
    for (const c of recentContracts) {
      const cId = c.contractor_id.toString();
      // Since it's sorted newest first, the first one we insert is the most recent
      if (!contractMap.has(cId)) {
        contractMap.set(cId, c);
      } else if (query.status && c.status === query.status) {
        // If the user specifically filtered by a status, ensure the matched status is the one rendered
        contractMap.set(cId, c);
      }
    }

    const data = identities.map((identity) => {
      const active = contractMap.get(identity._id.toString());
      return {
        ...identity,
        sponsor_id: active?.sponsor_id ?? null,
        contracts: active ? [active] : [],
      };
    });

    return { data, pagination: { total, page, limit } };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE — GET /contractors/:id
  // ─────────────────────────────────────────────────────────
  async findOne(contractorId: string, tenantId: string) {
    const identity = await this.identityModel
      .findOne({ _id: new Types.ObjectId(contractorId), tenant_id: new Types.ObjectId(tenantId) })
      .lean();

    if (!identity) throw new NotFoundException('Contractor not found');

    const contracts = await this.contractModel
      .find({ contractor_id: identity._id })
      .populate('sponsor_id', 'email role')
      .sort({ created_at: -1 })
      .lean();

    return { ...identity, contracts };
  }

  // ─────────────────────────────────────────────────────────
  // CREATE — POST /contractors
  // ─────────────────────────────────────────────────────────
  async create(dto: CreateContractorDto, tenantId: string, userId: string, userRole: string = 'admin') {
    const tenantOid = new Types.ObjectId(tenantId);
    const userOid = new Types.ObjectId(userId);

    // Validate dates
    const startDate = new Date(dto.contract.start_date);
    const endDate = new Date(dto.contract.end_date);
    if (endDate <= startDate) {
      throw new BadRequestException('end_date must be after start_date');
    }

    // Check for duplicate identity (same email within tenant)
    const existing = await this.identityModel.findOne({
      tenant_id: tenantOid,
      email: dto.email.toLowerCase(),
    });
    if (existing) {
      // Check if this is a rehire situation (no active contract)
      const activeContract = await this.contractModel.findOne({
        contractor_id: existing._id,
        status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.SUSPENDED] },
      });
      if (activeContract) {
        throw new ConflictException(
          'Contractor already has an active contract. Use POST /contractors/:id/contracts to rehire.',
        );
      }
      // Auto-route to rehire if identity exists but no active contract
      return this.createContractForExistingIdentity(existing._id.toString(), dto, tenantId, userId, userRole);
    }

    // 1. Create contractor identity
    const identity = await this.identityModel.create({
      tenant_id: tenantOid,
      name: dto.name,
      email: dto.email.toLowerCase(),
      job_title: dto.job_title ?? null,
      department: dto.department ?? null,
      phone: dto.phone ?? null,
      location: dto.location ?? null,
      notes: dto.notes ?? null,
      created_by: userOid,
    });

    // 2. Create contract (depends on role)
    const isSponsor = userRole === 'sponsor';
    const initialStatus = isSponsor ? ContractStatus.PENDING : ContractStatus.ACTIVE;

    const contract = await this.contractModel.create({
      contractor_id: identity._id,
      tenant_id: tenantOid,
      sponsor_id: userOid, // The creator is automatically the sponsor
      start_date: startDate,
      end_date: endDate,
      original_end_date: endDate,
      status: initialStatus,
      create_google_account: dto.contract.create_google_account ?? false,
      extension_count: 0,
      is_rehire: false,
      created_by: userOid,
    });

    // 3. Create access records (and queue provisioning ONLY IF active)
    const accessRecords = await this._createAccessAndQueueProvisioning(
      contract,
      dto.contract.application_access ?? [],
      tenantId,
      userId,
      !isSponsor, // enqueue
    );

    // If sponsor, create an ONBOARD action
    if (isSponsor) {
      const responseDeadline = new Date();
      responseDeadline.setDate(responseDeadline.getDate() + 7); // Arbitrary deadline

      await this.sponsorActionModel.create({
        contract_id: contract._id,
        tenant_id: tenantOid,
        sponsor_id: userOid, // the caller
        action_type: SponsorActionType.ONBOARD,
        proposed_end_date: endDate,
        justification: dto.notes ?? 'New contractor onboarding request',
        status: SponsorActionStatus.PENDING,
        response_deadline: responseDeadline,
      });
    }

    // 4. Log lifecycle event
    await this.eventModel.create({
      tenant_id: tenantOid,
      contractor_id: identity._id,
      contract_id: contract._id,
      event_type: isSponsor ? EventType.ONBOARDING_REQUESTED as any : EventType.CONTRACTOR_CREATED, // need to add to enum or use string cast
      actor_type: isSponsor ? ActorType.SPONSOR : ActorType.USER,
      actor_id: userOid,
      metadata: {
        name: dto.name,
        email: dto.email,
        end_date: endDate,
        apps_provisioned: isSponsor ? 0 : accessRecords.length,
      },
    });

    return {
      contractor: identity,
      contract,
      access: accessRecords.map((a) => ({
        _id: a._id,
        tenant_application_id: a.tenant_application_id,
        provisioning_status: a.provisioning_status,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────
  // REHIRE — POST /contractors/:id/contracts
  // ─────────────────────────────────────────────────────────
  async createContractForExistingIdentity(
    contractorId: string,
    dto: CreateContractorDto,
    tenantId: string,
    userId: string,
    userRole: string = 'admin',
  ) {
    const tenantOid = new Types.ObjectId(tenantId);
    const userOid = new Types.ObjectId(userId);
    const contractorOid = new Types.ObjectId(contractorId);

    const identity = await this.identityModel.findOne({
      _id: contractorOid,
      tenant_id: tenantOid,
    });
    if (!identity) throw new NotFoundException('Contractor not found');

    const startDate = new Date(dto.contract.start_date);
    const endDate = new Date(dto.contract.end_date);
    if (endDate <= startDate) {
      throw new BadRequestException('end_date must be after start_date');
    }

    // Check for active contract conflict
    const activeContract = await this.contractModel.findOne({
      contractor_id: contractorOid,
      status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.SUSPENDED] },
    });
    if (activeContract) {
      throw new ConflictException('Contractor already has an active contract');
    }

    // Get the previous contract for rehire linkage
    const previousContract = await this.contractModel
      .findOne({ contractor_id: contractorOid })
      .sort({ created_at: -1 });

    const isSponsor = userRole === 'sponsor';
    const initialStatus = isSponsor ? ContractStatus.PENDING : ContractStatus.ACTIVE;

    const contract = await this.contractModel.create({
      contractor_id: contractorOid,
      tenant_id: tenantOid,
      sponsor_id: userOid, // Rehire sponsor is automatically the caller
      start_date: startDate,
      end_date: endDate,
      original_end_date: endDate,
      status: initialStatus,
      create_google_account: dto.contract.create_google_account ?? false,
      extension_count: 0,
      is_rehire: true,
      previous_contract_id: previousContract?._id ?? null,
      created_by: userOid,
    });

    const accessRecords = await this._createAccessAndQueueProvisioning(
      contract,
      dto.contract.application_access ?? [],
      tenantId,
      userId,
      !isSponsor, // enqueue
    );

    if (isSponsor) {
      const responseDeadline = new Date();
      responseDeadline.setDate(responseDeadline.getDate() + 7);

      await this.sponsorActionModel.create({
        contract_id: contract._id,
        tenant_id: tenantOid,
        sponsor_id: userOid,
        action_type: SponsorActionType.ONBOARD,
        proposed_end_date: endDate,
        justification: dto.notes ?? 'Rehire onboarding request',
        status: SponsorActionStatus.PENDING,
        response_deadline: responseDeadline,
      });
    }

    await this.eventModel.create({
      tenant_id: tenantOid,
      contractor_id: contractorOid,
      contract_id: contract._id,
      event_type: isSponsor ? EventType.ONBOARDING_REQUESTED as any : EventType.CONTRACTOR_ONBOARDED,
      actor_type: isSponsor ? ActorType.SPONSOR : ActorType.USER,
      actor_id: userOid,
      metadata: { is_rehire: true, previous_contract_id: previousContract?._id },
    });

    return {
      contractor: identity,
      contract,
      access: accessRecords.map((a) => ({
        _id: a._id,
        tenant_application_id: a.tenant_application_id,
        provisioning_status: a.provisioning_status,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE IDENTITY — PATCH /contractors/:id
  // ─────────────────────────────────────────────────────────
  async update(contractorId: string, tenantId: string, dto: UpdateContractorDto) {
    const updated = await this.identityModel.findOneAndUpdate(
      { _id: new Types.ObjectId(contractorId), tenant_id: new Types.ObjectId(tenantId) },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Contractor not found');
    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // CSV IMPORT — POST /contractors/import
  // ─────────────────────────────────────────────────────────
  async importFromCsv(
    fileBuffer: Buffer,
    fieldMapping: Record<string, string>,
    tenantId: string,
    userId: string,
  ) {
    // Enqueue the CSV for async processing
    const job = await this.importQueue.add(
      'process-csv',
      {
        csvData: fileBuffer.toString('utf-8'),
        fieldMapping,    // e.g. { "Full Name": "name", "End Date": "end_date", ... }
        tenantId,
        userId,
      },
      { attempts: 2, removeOnComplete: true },
    );

    return {
      event_type: EventType.CONTRACTOR_BULK_IMPORTED,
      job_id: job.id,
      queued: true,
      message: 'CSV import queued. Check lifecycle_events for row-level results.',
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — creates access records and queues provisioning
  // ─────────────────────────────────────────────────────────
  private async _createAccessAndQueueProvisioning(
    contract: ContractorContractDocument,
    applicationAccess: Array<{
      tenant_application_id: string;
      access_role?: string;
      external_account_id?: string;
    }>,
    tenantId: string,
    userId: string,
    enqueue: boolean = true,
  ) {
    if (!applicationAccess.length) return [];

    const accessDocs = applicationAccess.map((app) => ({
      contract_id: contract._id,
      contractor_id: contract.contractor_id,
      tenant_id: new Types.ObjectId(tenantId),
      tenant_application_id: new Types.ObjectId(app.tenant_application_id),
      external_account_id: app.external_account_id ?? null,
      access_role: app.access_role ?? null,
      provisioning_status: ProvisioningStatus.PENDING,
      granted_at: new Date(),
      granted_by: new Types.ObjectId(userId),
    }));

    const accessRecords = await this.accessModel.insertMany(accessDocs);

    if (enqueue) {
      // Queue a provisioning job for each access record
      for (const access of accessRecords) {
        await this.provisioningQueue.add(
          'provision-access',
          {
            access_id: access._id.toString(),
            contract_id: contract._id.toString(),
            contractor_id: contract.contractor_id.toString(),
            tenant_id: tenantId,
            tenant_application_id: access.tenant_application_id.toString(),
            external_account_id: access.external_account_id,
            access_role: access.access_role,
            create_google_account: contract.create_google_account,
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
        );
      }
    }

    return accessRecords;
  }
}
