import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContractorAccess, ContractorAccessDocument, ProvisioningStatus } from '../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventDocument, EventType, ActorType } from '../schemas/lifecycle-event.schema';
import { GoogleService } from '../modules/integrations/google.service';
import { SlackService } from '../modules/integrations/slack.service';
import { ContractorIdentity, ContractorIdentityDocument } from '../schemas/contractor-identity.schema';

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
        private slackService: SlackService,
    ) {
        super();
    }

    async process(job: Job<any>) {
        if (job.name === 'revoke-slack') {
            const { tenant_id, contractor_id, contract_id } = job.data;
            try {
                const identity = await this.identityModel.findById(contractor_id);
                if (!identity) throw new Error('Contractor identity missing');

                await this.slackService.revokeUserOrNotify(tenant_id, identity.email);

                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id),
                    contractor_id: new Types.ObjectId(contractor_id),
                    contract_id: new Types.ObjectId(contract_id),
                    event_type: EventType.ACCESS_REVOKED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Slack', status: 'Revoked/Notified' },
                });
            } catch (err: any) {
                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id),
                    contractor_id: new Types.ObjectId(contractor_id),
                    contract_id: new Types.ObjectId(contract_id),
                    event_type: EventType.ACCESS_REVOCATION_FAILED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Slack', error: err.message },
                });
                throw err;
            }
            return;
        }

        if (job.name === 'revoke-google') {
            const { tenant_id, contractor_id, contract_id } = job.data;
            try {
                const identity = await this.identityModel.findById(contractor_id);
                if (!identity) throw new Error('Contractor identity missing');

                await this.googleService.deleteUser(tenant_id, identity.email);

                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id),
                    contractor_id: new Types.ObjectId(contractor_id),
                    contract_id: new Types.ObjectId(contract_id),
                    event_type: EventType.ACCESS_REVOKED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Google Workspace', status: 'Deleted' },
                });
            } catch (err: any) {
                await this.eventModel.create({
                    tenant_id: new Types.ObjectId(tenant_id),
                    contractor_id: new Types.ObjectId(contractor_id),
                    contract_id: new Types.ObjectId(contract_id),
                    event_type: EventType.ACCESS_REVOCATION_FAILED,
                    actor_type: ActorType.SYSTEM,
                    actor_id: null,
                    metadata: { app_name: 'Google Workspace', error: err.message },
                });
                throw err;
            }
            return;
        }

        const { access_id, contract_id, contractor_id, tenant_id, app_name } = job.data;

        try {
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
        } catch (err: any) {
            await this.accessModel.findByIdAndUpdate(access_id, {
                $inc: { revocation_attempts: 1 },
                last_attempt_at: new Date(),
                failure_reason: err.message,
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
                metadata: { app_name, error: err.message },
            });

            throw err;
        }
    }
}
