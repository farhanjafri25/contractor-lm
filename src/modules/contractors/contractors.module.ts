import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ContractorsController } from './contractors.controller';
import { ContractorsService } from './contractors.service';
import { ContractorIdentity, ContractorIdentitySchema } from '../../schemas/contractor-identity.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { SponsorAction, SponsorActionSchema } from '../../schemas/sponsor-action.schema';
import { ImportProcessor } from '../../jobs/import.processor';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorIdentity.name, schema: ContractorIdentitySchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
            { name: SponsorAction.name, schema: SponsorActionSchema },
        ]),
        BullModule.registerQueue({ 
            name: 'provisioning',
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: false,
            },
            connection: {
                maxRetriesPerRequest: null,
            }
        }),
        BullModule.registerQueue({ 
            name: 'import',
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: false,
            },
            connection: {
                maxRetriesPerRequest: null,
            }
        }),
    ],
    controllers: [ContractorsController],
    providers: [ContractorsService, ImportProcessor],
    exports: [ContractorsService],
})
export class ContractorsModule { }
