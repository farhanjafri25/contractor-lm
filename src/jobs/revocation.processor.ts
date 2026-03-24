import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractorAccess } from '../schemas/contractor-access.schema';
import type { ContractorAccessDocument } from '../schemas/contractor-access.schema';
import { ProvisioningStatus } from '../schemas/contractor-access.schema';
import { LifecycleEvent } from '../schemas/lifecycle-event.schema';
import type { LifecycleEventDocument } from '../schemas/lifecycle-event.schema';
import { EventType, ActorType } from '../schemas/lifecycle-event.schema';
import { Types } from 'mongoose';
import { GoogleService } from '../modules/integrations/google.service';
import { ContractorIdentity } from '../schemas/contractor-identity.schema';
import type { ContractorIdentityDocument } from '../schemas/contractor-identity.schema';

export interface RevocationJob {
    access_id: string;
    contract_id: string;
    contractor_id: string;
    tenant_id: string;
    tenant_application_id: string;
    external_account_id: string;
    app_name: string;
}

@Processor('revocation', {
    stalledInterval: 300000,
    drainDelay: 300,
    skipStalledCheck: true,
})
export class RevocationProcessor extends WorkerHost {
    constructor(
        @InjectModel(ContractorAccess.name)
        private accessModel: Model<ContractorAccessDocument>,

        @InjectModel(LifecycleEvent.name)
        private eventModel: Model<LifecycleEventDocument>,

        @InjectModel(ContractorIdentity.name)
        private identityModel: Model<ContractorIdentityDocument>,

        private googleService: GoogleService,
    ) {
        super();
    }

    async process(job: Job<any>) {
        if (job.name === 'revoke-google') {
            const { tenant_id, contractor_id, contract_id } = job.data;
            console.log(`[RevocationProcessor] Deleting native Google Workspace user for job: ${job.id}`);
            
            try {
                const identity = await this.identityModel.findById(contractor_id);
                if (!identity) throw new Error('Contractor identity missing');

                await this.googleService.deleteUser(tenant_id, identity.email);

                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id as string),
                    contractor_id: new Types.ObjectId(contractor_id as string),
                    contract_id: new Types.ObjectId(contract_id as string),
                    event_type: EventType.ACCESS_REVOKED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Google Workspace', status: 'Deleted' },
                });
                
                console.log(`[RevocationProcessor] Successfully deleted Google Workspace user ${identity.email}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[RevocationProcessor] Failed to delete Workspace user: ${msg}`);
                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id as string),
                    contractor_id: new Types.ObjectId(contractor_id as string),
                    contract_id: new Types.ObjectId(contract_id as string),
                    event_type: EventType.ACCESS_REVOCATION_FAILED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Google Workspace', error: msg },
                });
                throw err;
            }
            return;
        }

        const { access_id, contract_id, contractor_id, tenant_id, app_name } = job.data;

        try {
            // TODO: call the external app API to revoke access
            console.log(`[RevocationProcessor] Revoking access for job: ${job.id}`);

            await this.accessModel.findByIdAndUpdate(access_id, {
                provisioning_status: ProvisioningStatus.REVOKED,
                revoked_at: new Date(),
                revoked_by: 'system',
            });

            await this.eventModel.create({
                tenant_id: new Types.ObjectId(tenant_id),
                contractor_id: new Types.ObjectId(contractor_id),
                contract_id: new Types.ObjectId(contract_id),
                access_id: new Types.ObjectId(access_id),
                event_type: EventType.ACCESS_REVOKED,
                actor_type: ActorType.SYSTEM,
                actor_id: null,
                metadata: { app_name },
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await this.accessModel.findByIdAndUpdate(access_id, {
                $inc: { revocation_attempts: 1 },
                last_attempt_at: new Date(),
                failure_reason: msg,
                provisioning_status: ProvisioningStatus.FAILED,
            });

            await this.eventModel.create({
                tenant_id: new Types.ObjectId(tenant_id),
                contractor_id: new Types.ObjectId(contractor_id),
                contract_id: new Types.ObjectId(contract_id),
                access_id: new Types.ObjectId(access_id),
                event_type: EventType.ACCESS_REVOCATION_FAILED,
                actor_type: ActorType.SYSTEM,
                actor_id: null,
                metadata: { app_name, error: msg },
            });

            throw err;
        }
    }
}
