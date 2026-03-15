import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
        BullModule.registerQueue(
            { 
                name: 'revocation',
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                },
                connection: {
                    maxRetriesPerRequest: null,
                }
            },
            { 
                name: 'provisioning',
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                },
                connection: {
                    maxRetriesPerRequest: null,
                }
            },
        ),
    ],
    controllers: [AccessController],
    providers: [AccessService],
    exports: [AccessService],
})
export class AccessModule { }
