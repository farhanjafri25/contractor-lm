import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractorAccess, ContractorAccessDocument, ProvisioningStatus } from '../schemas/contractor-access.schema';
import { ContractorIdentity, ContractorIdentityDocument } from '../schemas/contractor-identity.schema';
import { TenantApplication, TenantApplicationDocument } from '../schemas/tenant-application.schema';
import { GoogleService } from '../modules/integrations/google.service';
import { SlackService } from '../modules/integrations/slack.service';

@Processor('provisioning')
@Injectable()
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    @InjectModel(ContractorAccess.name) private accessModel: Model<ContractorAccessDocument>,
    @InjectModel(ContractorIdentity.name) private identityModel: Model<ContractorIdentityDocument>,
    @InjectModel(TenantApplication.name) private applicationModel: Model<TenantApplicationDocument>,
    private googleService: GoogleService,
    private slackService: SlackService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[Provisioning] ▶ Received job "${job.name}" (ID: ${job.id}) | Data: ${JSON.stringify(job.data)}`);

    if (job.name === 'provision-slack') {
      this.logger.log(`[Provisioning:Slack] Starting for contractor_id=${job.data.contractor_id}, tenant_id=${job.data.tenant_id}`);
      
      const identity = await this.identityModel.findById(job.data.contractor_id);
      if (!identity) {
        this.logger.error(`[Provisioning:Slack] Contractor identity ${job.data.contractor_id} not found in DB — aborting`);
        throw new Error('Contractor identity destroyed mid-provision');
      }
      this.logger.log(`[Provisioning:Slack] Identity found: name="${identity.name}", email="${identity.email}"`);
      
      const [firstName, ...lastNameParts] = identity.name.split(' ');
      const lastName = lastNameParts.join(' ') || 'Contractor';
      this.logger.log(`[Provisioning:Slack] Parsed name: firstName="${firstName}", lastName="${lastName}"`);
      
      this.logger.log(`[Provisioning:Slack] Calling slackService.inviteUserOrNotify(tenant=${job.data.tenant_id}, email=${identity.email})`);
      await this.slackService.inviteUserOrNotify(
        job.data.tenant_id,
        identity.email,
        firstName,
        lastName
      );
      this.logger.log(`[Provisioning:Slack] ✅ Completed successfully for ${identity.email} (Job ${job.id})`);
      return;
    }

    if (job.name === 'provision-google') {
      this.logger.log(`[Provisioning:Google] Starting for contractor_id=${job.data.contractor_id}, tenant_id=${job.data.tenant_id}`);
      
      const identity = await this.identityModel.findById(job.data.contractor_id);
      if (!identity) {
        this.logger.error(`[Provisioning:Google] Contractor identity ${job.data.contractor_id} not found in DB — aborting`);
        throw new Error('Contractor identity destroyed mid-provision');
      }
      this.logger.log(`[Provisioning:Google] Identity found: name="${identity.name}", email="${identity.email}"`);
      
      const [firstName, ...lastNameParts] = identity.name.split(' ');
      const lastName = lastNameParts.join(' ') || 'Contractor';
      this.logger.log(`[Provisioning:Google] Parsed name: firstName="${firstName}", lastName="${lastName}"`);
      
      this.logger.log(`[Provisioning:Google] Calling googleService.provisionUser(tenant=${job.data.tenant_id}, email=${identity.email})`);
      const result = await this.googleService.provisionUser(
        job.data.tenant_id,
        identity.email,
        firstName,
        lastName
      );
      
      if (result) {
        this.logger.log(`[Provisioning:Google] ✅ Google user created: primaryEmail=${result.primaryEmail} (Job ${job.id})`);
      } else {
        this.logger.warn(`[Provisioning:Google] ⚠️ provisionUser returned null — tenant likely missing refresh token (Job ${job.id})`);
      }
      return;
    }

    // Generic provision-access job
    this.logger.log(`[Provisioning:Access] Starting for access_id=${job.data.access_id}, contract_id=${job.data.contract_id}, contractor_id=${job.data.contractor_id}`);
    
    const access = await this.accessModel.findById(job.data.access_id);
    if (!access) {
      this.logger.error(`[Provisioning:Access] Access record ${job.data.access_id} not found — aborting`);
      throw new Error('Access record not found');
    }
    this.logger.log(`[Provisioning:Access] Access record found: app=${access.tenant_application_id}, status=${access.provisioning_status}`);

    const app = await this.applicationModel.findById(access.tenant_application_id).populate('application_id').lean();
    if (!app) {
      this.logger.error(`[Provisioning:Access] TenantApplication ${access.tenant_application_id} not found or disabled — aborting`);
      throw new Error('Tenant application explicitly disabled or missing');
    }
    this.logger.log(`[Provisioning:Access] Application resolved: ${(app as any).application_id?.name ?? app._id}`);

    const identity = await this.identityModel.findById(job.data.contractor_id);
    if (!identity) {
      this.logger.error(`[Provisioning:Access] Contractor identity ${job.data.contractor_id} not found — aborting`);
      throw new Error('Contractor identity destroyed mid-provision');
    }
    this.logger.log(`[Provisioning:Access] Identity found: ${identity.name} (${identity.email})`);

    access.provisioning_status = ProvisioningStatus.PENDING;
    await access.save();
    this.logger.log(`[Provisioning:Access] Status set to PENDING for access ${access._id}`);

    try {
      access.provisioning_status = ProvisioningStatus.ACTIVE;
      access.granted_at = new Date();
      await access.save();

      this.logger.log(`[Provisioning:Access] ✅ Status set to ACTIVE for access ${access._id} (Job ${job.id})`);
    } catch (e) {
      access.provisioning_status = ProvisioningStatus.FAILED;
      await access.save();
      this.logger.error(`[Provisioning:Access] ❌ Job ${job.id} failed: ${e.message}`);
      throw e;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`[Provisioning] ❌ Job ${job.id} ("${job.name}") critically failed: ${error.message}`, error.stack);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`[Provisioning] ✅ Job ${job.id} ("${job.name}") completed successfully`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`[Provisioning] ⏳ Job ${job.id} ("${job.name}") is now active (attempt ${job.attemptsMade + 1})`);
  }
}
