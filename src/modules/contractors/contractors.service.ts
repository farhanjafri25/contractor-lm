import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
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
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { ListContractorsDto } from './dto/list-contractors.dto';
import { SponsorAction, SponsorActionDocument, SponsorActionType, SponsorActionStatus } from '../../schemas/sponsor-action.schema';
import { Application, ApplicationDocument } from '../../schemas/application.schema';
import { TenantApplication, TenantApplicationDocument } from '../../schemas/tenant-application.schema';

@Injectable()
export class ContractorsService {
  private readonly logger = new Logger(ContractorsService.name);

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

    @InjectQueue('revocation')
    private revocationQueue: Queue,

    @InjectModel(SponsorAction.name)
    private sponsorActionModel: Model<SponsorActionDocument>,

    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,

    @InjectModel(TenantApplication.name)
    private tenantApplicationModel: Model<TenantApplicationDocument>,
  ) { }

  // ─────────────────────────────────────────────────────────
  // LIST — GET /contractors
  // ─────────────────────────────────────────────────────────
  async findAll(tenantId: string, query: ListContractorsDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    // Build an identity-level filter
    const identityFilter: Record<string, any> = { 
      tenant_id: new Types.ObjectId(tenantId),
      is_deleted: { $ne: true }
    };
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
      .findOne({ 
        _id: new Types.ObjectId(contractorId), 
        tenant_id: new Types.ObjectId(tenantId),
        is_deleted: { $ne: true }
      })
      .lean();

    if (!identity) throw new NotFoundException('Contractor not found');
  
    const contracts = await this.contractModel
      .find({ contractor_id: identity._id })
      .populate('sponsor_id', 'name full_name email role')
      .sort({ createdAt: -1 })
      .lean();
  
    // Attach the most recent sponsor to the identity for the detail view
    const activeSponsor = contracts[0]?.sponsor_id || null;
  
    return { ...identity, sponsor_id: activeSponsor, contracts };
  }

  // ─────────────────────────────────────────────────────────
  // CREATE — POST /contractors
  // ─────────────────────────────────────────────────────────
  async create(dto: CreateContractorDto, tenantId: string, userId: string, userRole: string = 'admin') {
    this.logger.log(`[Create] Starting contractor creation: email=${dto.email}, tenant=${tenantId}, role=${userRole}`);
    const tenantOid = new Types.ObjectId(tenantId);
    const userOid = new Types.ObjectId(userId);

    // Validate dates
    const startDate = new Date(dto.contract.start_date);
    const endDate = new Date(dto.contract.end_date);
    if (endDate <= startDate) {
      this.logger.warn(`[Create] Invalid dates: start=${startDate.toISOString()}, end=${endDate.toISOString()}`);
      throw new BadRequestException('end_date must be after start_date');
    }
    this.logger.log(`[Create] Contract dates: ${startDate.toISOString()} → ${endDate.toISOString()}`);

    // Check for duplicate identity (same email within tenant)
    const existing = await this.identityModel.findOne({
      tenant_id: tenantOid,
      email: dto.email.toLowerCase(),
    });
    if (existing) {
      this.logger.log(`[Create] Existing identity found for ${dto.email} (id=${existing._id}), checking for active contract...`);
      // Check if this is a rehire situation (no active contract)
      const activeContract = await this.contractModel.findOne({
        contractor_id: existing._id,
        status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED, ContractStatus.SUSPENDED] },
      });
      if (activeContract) {
        this.logger.warn(`[Create] Contractor ${dto.email} already has active contract ${activeContract._id} (status=${activeContract.status})`);
        throw new ConflictException('Contractor already has an active contract. Please use the Rehire workflow.');
      }
      this.logger.log(`[Create] No active contract — routing to rehire flow for ${dto.email}`);
      // Auto-route to rehire if identity exists but no active contract
      return this.createContractForExistingIdentity(existing._id.toString(), dto, tenantId, userId, userRole);
    }

    // 1. Create contractor identity
    this.logger.log(`[Create] Creating new identity for ${dto.email}...`);
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
    this.logger.log(`[Create] Identity created: id=${identity._id}, email=${identity.email}`);

    // 2. Create contract (depends on role)
    const isSponsor = userRole === 'sponsor';
    const initialStatus = isSponsor ? ContractStatus.PENDING : ContractStatus.ACTIVE;
    this.logger.log(`[Create] Creating contract: status=${initialStatus}, google=${dto.contract.create_google_account ?? false}, slack=${dto.contract.create_slack_account ?? false}`);

    const contract = await this.contractModel.create({
      contractor_id: identity._id,
      tenant_id: tenantOid,
      sponsor_id: userOid, // The creator is automatically the sponsor
      start_date: startDate,
      end_date: endDate,
      original_end_date: endDate,
      status: initialStatus,
      create_google_account: dto.contract.create_google_account ?? false,
      create_slack_account: dto.contract.create_slack_account ?? false,
      extension_count: 0,
      is_rehire: false,
      created_by: userOid,
    });
    this.logger.log(`[Create] Contract created: id=${contract._id}, status=${contract.status}`);

    // 3. Create access records (and queue provisioning ONLY IF active)
    const applicationAccess = [...(dto.contract.application_access ?? [])];
    
    // Auto-resolve Google/Slack if enabled via checkboxes
    if (contract.create_google_account) {
      const googleApp = await this._findTenantApplicationBySlug(tenantId, 'google-workspace');
      if (googleApp && !applicationAccess.find(a => a.tenant_application_id === googleApp._id.toString())) {
        applicationAccess.push({ tenant_application_id: googleApp._id.toString(), access_role: 'User' });
      }
    }
    if (contract.create_slack_account) {
      const slackApp = await this._findTenantApplicationBySlug(tenantId, 'slack');
      if (slackApp && !applicationAccess.find(a => a.tenant_application_id === slackApp._id.toString())) {
        applicationAccess.push({ tenant_application_id: slackApp._id.toString(), access_role: 'User' });
      }
    }

    this.logger.log(`[Create] Creating access records: ${applicationAccess.length} apps (including special integrations), enqueue=${!isSponsor}`);
    const accessRecords = await this._createAccessAndQueueProvisioning(
      contract,
      applicationAccess,
      tenantId,
      userId,
      !isSponsor, // enqueue
    );
    this.logger.log(`[Create] ${accessRecords.length} access records created`);

    if (!isSponsor && contract.create_google_account) {
      this.logger.log(`[Create] Queuing provision-google job for contractor ${identity._id}`);
      await this.provisioningQueue.add('provision-google', {
        tenant_id: tenantId,
        contractor_id: identity._id.toString(),
        contract_id: contract._id.toString(),
      });
      this.logger.log(`[Create] ✅ provision-google job queued`);
    } else {
      this.logger.log(`[Create] Skipping Google provisioning: isSponsor=${isSponsor}, create_google_account=${contract.create_google_account}`);
    }

    if (!isSponsor && contract.create_slack_account) {
      this.logger.log(`[Create] Queuing provision-slack job for contractor ${identity._id}`);
      await this.provisioningQueue.add('provision-slack', {
        tenant_id: tenantId,
        contractor_id: identity._id.toString(),
        contract_id: contract._id.toString(),
      });
      this.logger.log(`[Create] ✅ provision-slack job queued`);
    } else {
      this.logger.log(`[Create] Skipping Slack provisioning: isSponsor=${isSponsor}, create_slack_account=${contract.create_slack_account}`);
    }

    // If sponsor, create an ONBOARD action
    if (isSponsor) {
      this.logger.log(`[Create] Sponsor flow — creating ONBOARD action`);
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
      this.logger.log(`[Create] ONBOARD sponsor action created`);
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

    this.logger.log(`[Create] ✅ Contractor creation complete: identity=${identity._id}, contract=${contract._id}, accessRecords=${accessRecords.length}`);
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
  // BULK CREATE — POST /contractors/bulk
  // ─────────────────────────────────────────────────────────
  async bulkCreate(dtos: CreateContractorDto[], tenantId: string, userId: string, userRole: string = 'admin') {
    const CHUNK_SIZE = 50;
    const results: PromiseSettledResult<any>[] = [];

    for (let i = 0; i < dtos.length; i += CHUNK_SIZE) {
      const chunk = dtos.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map((dto) => this.create(dto, tenantId, userId, userRole))
      );
      results.push(...chunkResults);
    }

    const successful: { index: number; data: any }[] = [];
    const failed: { index: number; reason: any }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push({ index, data: result.value });
      } else {
        failed.push({ index, reason: result.reason?.message || 'Unknown error' });
      }
    });

    return {
      total: dtos.length,
      successful: successful.length,
      failed: failed.length,
      results: { successful, failed },
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
      .sort({ createdAt: -1 });

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
      create_slack_account: dto.contract.create_slack_account ?? false,
      extension_count: 0,
      is_rehire: true,
      previous_contract_id: previousContract?._id ?? null,
      created_by: userOid,
    });

    const applicationAccess = [...(dto.contract.application_access ?? [])];
    
    // Auto-resolve Google/Slack if enabled via checkboxes
    if (contract.create_google_account) {
      const googleApp = await this._findTenantApplicationBySlug(tenantId, 'google-workspace');
      if (googleApp && !applicationAccess.find(a => a.tenant_application_id === googleApp._id.toString())) {
        applicationAccess.push({ tenant_application_id: googleApp._id.toString(), access_role: 'User' });
      }
    }
    if (contract.create_slack_account) {
      const slackApp = await this._findTenantApplicationBySlug(tenantId, 'slack');
      if (slackApp && !applicationAccess.find(a => a.tenant_application_id === slackApp._id.toString())) {
        applicationAccess.push({ tenant_application_id: slackApp._id.toString(), access_role: 'User' });
      }
    }

    const accessRecords = await this._createAccessAndQueueProvisioning(
      contract,
      applicationAccess,
      tenantId,
      userId,
      !isSponsor, // enqueue
    );

    if (!isSponsor && contract.create_google_account) {
      this.logger.log(`[Rehire] Queuing provision-google job for contractor ${contractorOid}`);
      await this.provisioningQueue.add('provision-google', {
        tenant_id: tenantId,
        contractor_id: contractorOid.toString(),
        contract_id: contract._id.toString(),
      });
      this.logger.log(`[Rehire] ✅ provision-google job queued`);
    }

    if (!isSponsor && contract.create_slack_account) {
      this.logger.log(`[Rehire] Queuing provision-slack job for contractor ${contractorOid}`);
      await this.provisioningQueue.add('provision-slack', {
        tenant_id: tenantId,
        contractor_id: contractorOid.toString(),
        contract_id: contract._id.toString(),
      });
      this.logger.log(`[Rehire] ✅ provision-slack job queued`);
    }

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
  // DELETE IDENTITY (SOFT) — DELETE /contractors/:id
  // ─────────────────────────────────────────────────────────
  async remove(contractorId: string, tenantId: string, userId: string) {
    const contractorOid = new Types.ObjectId(contractorId);
    const tenantOid = new Types.ObjectId(tenantId);
    const userOid = new Types.ObjectId(userId);

    const identity = await this.identityModel.findOne({
      _id: contractorOid,
      tenant_id: tenantOid,
      is_deleted: { $ne: true },
    });
    if (!identity) throw new NotFoundException('Contractor not found');

    // 1. Mark identity as deleted (Soft Delete)
    await this.identityModel.findByIdAndUpdate(contractorOid, {
      $set: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: userOid,
      },
    });

    // 2. Terminate all active contracts and find the most recent one for event logging
    const contracts = await this.contractModel.find({ 
      contractor_id: contractorOid 
    }).sort({ createdAt: -1 });

    if (contracts.length > 0) {
      await this.contractModel.updateMany(
        { contractor_id: contractorOid, status: { $ne: ContractStatus.TERMINATED } },
        { $set: { status: ContractStatus.TERMINATED, termination_reason: TerminationReason.EARLY_TERMINATION } },
      );
    }
    
    // Pick the most recent contract to satisfy potential schema requirements or for better auditing
    const latestContract = contracts[0];
    const latestContractId = latestContract?._id;

    // 3. Queue revocation for all active access records (with DELETE action)
    const accessRecords = await this.accessModel.find({
      contractor_id: contractorOid,
      provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
    });

    for (const access of accessRecords) {
      await this.revocationQueue.add(
        'revoke-access',
        {
          access_id: access._id.toString(),
          contractor_id: contractorOid.toString(),
          contract_id: access.contract_id.toString(), // Use the contract linked to this specific access
          tenant_id: tenantId,
          tenant_application_id: access.tenant_application_id.toString(),
          external_account_id: access.external_account_id,
          action: 'delete',
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }

    // Special handling for managed Google/Slack accounts on any contracts
    for (const contract of contracts) {
      if (contract.create_google_account) {
        await this.revocationQueue.add('revoke-google', {
          contract_id: contract._id.toString(),
          contractor_id: contractorOid.toString(),
          tenant_id: tenantId,
          action: 'delete',
        });
      }
      if (contract.create_slack_account) {
        await this.revocationQueue.add('revoke-slack', {
          contract_id: contract._id.toString(),
          contractor_id: contractorOid.toString(),
          tenant_id: tenantId,
          action: 'delete',
        });
      }
    }

    // 4. Log lifecycle event
    await this.eventModel.create({
      tenant_id: tenantOid,
      contractor_id: contractorOid,
      contract_id: latestContractId || null, // Pass it explicitly, even if null
      event_type: EventType.CONTRACTOR_DELETED,
      actor_type: ActorType.USER,
      actor_id: userOid,
      metadata: { deleted_at: new Date(), access_revocations_queued: accessRecords.length },
    });

    return { success: true, message: 'Contractor soft-deleted and workspace revocations queued.' };
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
  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  private async _findTenantApplicationBySlug(tenantId: string, slug: string) {
    const app = await this.applicationModel.findOne({ slug });
    if (!app) return null;

    return this.tenantApplicationModel.findOne({
      tenant_id: new Types.ObjectId(tenantId),
      application_id: app._id,
      is_deleted: false,
    });
  }

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
    this.logger.log(`[AccessQueue] _createAccessAndQueueProvisioning: contract=${contract._id}, apps=${applicationAccess.length}, enqueue=${enqueue}`);
    if (!applicationAccess.length) {
      this.logger.log(`[AccessQueue] No additional application access records to create`);
      return [];
    }

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
    this.logger.log(`[AccessQueue] Inserted ${accessRecords.length} access records into DB`);

    if (enqueue) {
      this.logger.log(`[AccessQueue] Queuing provision-access jobs for ${accessRecords.length} records...`);
      // Find valid global application slugs to filter out special integrations
      const googleApp = await this._findTenantApplicationBySlug(tenantId, 'google-workspace');
      const slackApp = await this._findTenantApplicationBySlug(tenantId, 'slack');
      const specialAppIds = [googleApp?._id?.toString(), slackApp?._id?.toString()].filter(Boolean);

      // Queue a provisioning job for each access record, EXCEPT special apps
      for (const access of accessRecords) {
        if (specialAppIds.includes(access.tenant_application_id.toString())) {
          this.logger.log(`[AccessQueue] Skipping generic provision-access for ${access.tenant_application_id} (handled by specialised job)`);
          continue;
        }

        this.logger.log(`[AccessQueue] Queuing provision-access: access_id=${access._id}, app=${access.tenant_application_id}`);
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
      this.logger.log(`[AccessQueue] ✅ Generic provision-access jobs queued`);
    } else {
      this.logger.log(`[AccessQueue] Skipping provisioning queue (enqueue=false, likely sponsor flow)`);
    }

    return accessRecords;
  }
}
