import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { ExpiryProcessor } from '../../jobs/expiry.processor';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
        BullModule.registerQueue({ name: 'revocation' }),
    ],
    controllers: [ContractsController],
    providers: [ContractsService, ExpiryProcessor],
    exports: [ContractsService], // exported so SponsorModule can inject it
})
export class ContractsModule { }
