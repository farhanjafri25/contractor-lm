import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractorAccess, ContractorAccessDocument, ProvisioningStatus } from '../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventDocument, EventType, ActorType } from '../schemas/lifecycle-event.schema';

export interface RevocationJob {
    access_id: string;
    contract_id: string;
    contractor_id: string;
    tenant_id: string;
    tenant_application_id: string;
    external_account_id: string;
    app_name: string;
}

@Processor('revocation')
export class RevocationProcessor {
    constructor(
        @InjectModel(ContractorAccess.name) private accessModel: Model<ContractorAccessDocument>,
        @InjectModel(LifecycleEvent.name) private eventModel: Model<LifecycleEventDocument>,
    ) { }

    @Process('revoke-access')
    async handleRevocation(job: Job<RevocationJob>) {
        const { access_id, contract_id, contractor_id, tenant_id, app_name } = job.data;

        try {
            // TODO: Call the external app's API to revoke access
            // e.g. slackClient.kickUser(external_account_id) or githubClient.removeOrgMember(...)
            console.log(`[RevocationProcessor] Revoking access for job: ${job.id}`);

            await this.accessModel.findByIdAndUpdate(access_id, {
                provisioning_status: ProvisioningStatus.REVOKED,
                revoked_at: new Date(),
                revoked_by: 'system',
            });

            await this.eventModel.create({
                tenant_id,
                contractor_id,
                contract_id,
                access_id,
                event_type: EventType.ACCESS_REVOKED,
                actor_type: ActorType.SYSTEM,
                actor_id: null,
                metadata: { app_name },
            });
        } catch (err) {
            await this.accessModel.findByIdAndUpdate(access_id, {
                $inc: { revocation_attempts: 1 },
                last_attempt_at: new Date(),
                failure_reason: err.message,
                provisioning_status: ProvisioningStatus.FAILED,
            });

            await this.eventModel.create({
                tenant_id,
                contractor_id,
                contract_id,
                access_id,
                event_type: EventType.ACCESS_REVOCATION_FAILED,
                actor_type: ActorType.SYSTEM,
                actor_id: null,
                metadata: { app_name, error: err.message },
            });

            throw err; // BullMQ will retry based on job config
        }
    }
}
