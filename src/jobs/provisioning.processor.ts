import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContractorAccess, ContractorAccessDocument, ProvisioningStatus } from '../schemas/contractor-access.schema';
import { ContractorIdentity, ContractorIdentityDocument } from '../schemas/contractor-identity.schema';
import { TenantApplication, TenantApplicationDocument } from '../schemas/tenant-application.schema';
import { GoogleService } from '../modules/integrations/google.service';

@Processor('provisioning')
@Injectable()
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    @InjectModel(ContractorAccess.name) private accessModel: Model<ContractorAccessDocument>,
    @InjectModel(ContractorIdentity.name) private identityModel: Model<ContractorIdentityDocument>,
    @InjectModel(TenantApplication.name) private applicationModel: Model<TenantApplicationDocument>,
    private googleService: GoogleService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'provision-google') {
      this.logger.log(`Processing native Google Workspace provision job ${job.id} for contractor ${job.data.contractor_id}`);
      const identity = await this.identityModel.findById(job.data.contractor_id);
      if (!identity) throw new Error('Contractor identity destroyed mid-provision');
      
      const [firstName, ...lastNameParts] = identity.name.split(' ');
      const lastName = lastNameParts.join(' ') || 'Contractor';
      
      await this.googleService.provisionUser(
        job.data.tenant_id,
        identity.email,
        firstName,
        lastName
      );
      this.logger.log(`Successfully completed Native Google Provisioning job ${job.id}`);
      return;
    }

    this.logger.log(`Processing generic provision job ${job.id} for contract ${job.data.contract_id}`);
    
    const access = await this.accessModel.findById(job.data.access_id);
    if (!access) throw new Error('Access record not found');

    const app = await this.applicationModel.findById(access.tenant_application_id).populate('application_id').lean();
    if (!app) throw new Error('Tenant application explicitly disabled or missing');

    const identity = await this.identityModel.findById(job.data.contractor_id);
    if (!identity) throw new Error('Contractor identity destroyed mid-provision');

    access.provisioning_status = ProvisioningStatus.PENDING;
    await access.save();

    try {
      // Stub for external OIDC provisioning hooks (Okta, Entra, etc)
      // Google natively hooks above.

      access.provisioning_status = ProvisioningStatus.ACTIVE;
      access.granted_at = new Date();
      await access.save();

      this.logger.log(`Successfully completed Provisioning job ${job.id}`);
    } catch (e) {
      access.provisioning_status = ProvisioningStatus.FAILED;
      await access.save();
      this.logger.error(`Provision job ${job.id} officially failed. ${e.message}`);
      throw e;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} critically failed inside BullMQ bounds: ${error.message}`, error.stack);
  }
}
