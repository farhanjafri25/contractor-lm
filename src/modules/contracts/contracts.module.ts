import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { ExpiryProcessor } from '../../jobs/expiry.processor';
import { ReminderProcessor } from '../../jobs/reminder.processor';
import { SponsorAction, SponsorActionSchema } from '../../schemas/sponsor-action.schema';
import { SlackModule } from '../slack/slack.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
            { name: SponsorAction.name, schema: SponsorActionSchema },
        ]),
        BullModule.registerQueue(
            { 
                name: 'revocation',
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            }, 
            { 
                name: 'provisioning',
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            }
        ),
        forwardRef(() => SlackModule),
    ],
    controllers: [ContractsController],
    providers: [ContractsService, ExpiryProcessor, ReminderProcessor],
    exports: [ContractsService], // exported so SponsorModule can inject it
})
export class ContractsModule { }
