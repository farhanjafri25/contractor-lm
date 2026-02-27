import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model } from 'mongoose';
import type { Queue } from 'bull';
import { ContractorContract } from '../schemas/contractor-contract.schema';
import type { ContractorContractDocument } from '../schemas/contractor-contract.schema';
import { ContractStatus } from '../schemas/contractor-contract.schema';
import { ContractorAccess } from '../schemas/contractor-access.schema';
import type { ContractorAccessDocument } from '../schemas/contractor-access.schema';
import { ProvisioningStatus } from '../schemas/contractor-access.schema';
import { LifecycleEvent } from '../schemas/lifecycle-event.schema';
import type { LifecycleEventDocument } from '../schemas/lifecycle-event.schema';
import { EventType, ActorType } from '../schemas/lifecycle-event.schema';

@Injectable()
export class ExpiryProcessor {
    constructor(
        @InjectModel(ContractorContract.name)
        private contractModel: Model<ContractorContractDocument>,

        @InjectModel(ContractorAccess.name)
        private accessModel: Model<ContractorAccessDocument>,

        @InjectModel(LifecycleEvent.name)
        private eventModel: Model<LifecycleEventDocument>,

        @InjectQueue('revocation')
        private revocationQueue: Queue,
    ) { }

    /**
     * Runs every hour — finds contracts past end_date and queues revocations
     */
    @Cron(CronExpression.EVERY_HOUR)
    async processExpiredContracts() {
        const now = new Date();

        const expiredContracts = await this.contractModel.find({
            end_date: { $lte: now },
            status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
        });

        for (const contract of expiredContracts) {
            await this.contractModel.findByIdAndUpdate(contract._id, {
                status: ContractStatus.EXPIRED,
            });

            const accessRecords = await this.accessModel.find({
                contract_id: contract._id,
                provisioning_status: ProvisioningStatus.ACTIVE,
            });

            for (const access of accessRecords) {
                await this.revocationQueue.add(
                    'revoke-access',
                    {
                        access_id: access._id.toString(),
                        contract_id: contract._id.toString(),
                        contractor_id: contract.contractor_id.toString(),
                        tenant_id: contract.tenant_id.toString(),
                        tenant_application_id: access.tenant_application_id.toString(),
                        external_account_id: access.external_account_id,
                    },
                    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
                );
            }

            await this.eventModel.create({
                tenant_id: contract.tenant_id,
                contractor_id: contract.contractor_id,
                contract_id: contract._id,
                event_type: EventType.CONTRACT_EXPIRED,
                actor_type: ActorType.SYSTEM,
                actor_id: null,
                metadata: { end_date: contract.end_date, revocations_queued: accessRecords.length },
            });
        }

        if (expiredContracts.length > 0) {
            console.log(`[ExpiryProcessor] Processed ${expiredContracts.length} expired contracts`);
        }
    }
}
