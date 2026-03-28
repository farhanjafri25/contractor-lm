import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContractorAccess, ContractorAccessDocument, ProvisioningStatus } from '../schemas/contractor-access.schema';
import { ContractorIdentity, ContractorIdentityDocument } from '../schemas/contractor-identity.schema';
import { TenantApplication, TenantApplicationDocument } from '../schemas/tenant-application.schema';
import { GoogleService } from '../modules/integrations/google.service';
import { SlackService } from '../modules/integrations/slack.service';
import { Application, ApplicationDocument } from '../schemas/application.schema';

@Processor('provisioning')
@Injectable()
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    @InjectModel(ContractorAccess.name) private accessModel: Model<ContractorAccessDocument>,
    @InjectModel(ContractorIdentity.name) private identityModel: Model<ContractorIdentityDocument>,
    @InjectModel(TenantApplication.name) private applicationModel: Model<TenantApplicationDocument>,
    @InjectModel(Application.name) private globalApplicationModel: Model<ApplicationDocument>,
    private googleService: GoogleService,
    private slackService: SlackService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[Provisioning] ▶ Received job "${job.name}" (ID: ${job.id}) | Data: ${JSON.stringify(job.data)}`);

    if (job.name === 'provision-slack') {
      try {
        this.logger.log(`[Provisioning:Slack] Starting for contractor_id=${job.data.contractor_id}, tenant_id=${job.data.tenant_id}`);
        
        const identity = await this.identityModel.findById(job.data.contractor_id);
        if (!identity) {
          this.logger.error(`[Provisioning:Slack] Contractor identity ${job.data.contractor_id} not found in DB — aborting`);
          throw new Error('Contractor identity destroyed mid-provision');
        }
        
        const [firstName, ...lastNameParts] = identity.name.split(' ');
        const lastName = lastNameParts.join(' ') || 'Contractor';
        
        await this.slackService.inviteUserOrNotify(
          job.data.tenant_id,
          identity.email,
          firstName,
          lastName
        );

        // Update ContractorAccess record
        await this.updateAccessStatusBySlug(
          job.data.tenant_id,
          job.data.contract_id,
          'slack',
          ProvisioningStatus.ACTIVE
        );

        this.logger.log(`[Provisioning:Slack] ✅ Completed successfully for ${identity.email} (Job ${job.id})`);
        return;
      } catch (e) {
        await this.updateAccessStatusBySlug(
          job.data.tenant_id,
          job.data.contract_id,
          'slack',
          ProvisioningStatus.FAILED,
          e.message
        );
        throw e;
      }
    }

    if (job.name === 'provision-google') {
      try {
        this.logger.log(`[Provisioning:Google] Starting for contractor_id=${job.data.contractor_id}, tenant_id=${job.data.tenant_id}`);
        
        const identity = await this.identityModel.findById(job.data.contractor_id);
        if (!identity) {
          this.logger.error(`[Provisioning:Google] Contractor identity ${job.data.contractor_id} not found in DB — aborting`);
          throw new Error('Contractor identity destroyed mid-provision');
        }
        
        const [firstName, ...lastNameParts] = identity.name.split(' ');
        const lastName = lastNameParts.join(' ') || 'Contractor';
        
        const result = await this.googleService.provisionUser(
          job.data.tenant_id,
          identity.email,
          firstName,
          lastName
        );
        
        // Update ContractorAccess record
        await this.updateAccessStatusBySlug(
          job.data.tenant_id,
          job.data.contract_id,
          'google-workspace',
          ProvisioningStatus.ACTIVE,
          undefined,
          result?.primaryEmail ?? undefined
        );

        if (result) {
          this.logger.log(`[Provisioning:Google] ✅ Google user created: primaryEmail=${result.primaryEmail} (Job ${job.id})`);
        } else {
          this.logger.warn(`[Provisioning:Google] ⚠️ provisionUser returned null (missing refresh token?) (Job ${job.id})`);
        }
        return;
      } catch (e) {
        await this.updateAccessStatusBySlug(
          job.data.tenant_id,
          job.data.contract_id,
          'google-workspace',
          ProvisioningStatus.FAILED,
          e.message
        );
        throw e;
      }
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

  private async updateAccessStatusBySlug(
    tenantId: string,
    contractId: string,
    appSlug: string,
    status: ProvisioningStatus,
    failureReason?: string,
    externalId?: string
  ) {
    try {
      this.logger.log(`[Processor:UpdateStatus] Looking for ${appSlug} access for contract ${contractId}...`);
      
      const application = await this.globalApplicationModel.findOne({ slug: appSlug });
      if (!application) {
        this.logger.warn(`[Processor:UpdateStatus] Global application "${appSlug}" not found — skipping status update`);
        return;
      }

      const tenantApplication = await this.applicationModel.findOne({
        tenant_id: new Types.ObjectId(tenantId),
        application_id: application._id,
      });

      if (!tenantApplication) {
        this.logger.warn(`[Processor:UpdateStatus] TenantApplication for ${appSlug} not found for tenant ${tenantId}`);
        return;
      }

      const update: Record<string, any> = { provisioning_status: status };
      if (status === ProvisioningStatus.ACTIVE) {
        update.granted_at = new Date();
      }
      if (failureReason) {
        update.failure_reason = failureReason;
      }
      if (externalId) {
        update.external_account_id = externalId;
      }

      const access = await this.accessModel.findOneAndUpdate(
        {
          tenant_id: new Types.ObjectId(tenantId),
          contract_id: new Types.ObjectId(contractId),
          tenant_application_id: tenantApplication._id,
        },
        { $set: update },
        { new: true }
      );

      if (access) {
        this.logger.log(`[Processor:UpdateStatus] ✅ Set ${appSlug} access to ${status} for access_id=${access._id}`);
      } else {
        this.logger.warn(`[Processor:UpdateStatus] ⚠️ No PENDING access record found for ${appSlug} / contract ${contractId}`);
      }
    } catch (err) {
      this.logger.error(`[Processor:UpdateStatus] ❌ Failed to update access status: ${err.message}`);
    }
  }
}
