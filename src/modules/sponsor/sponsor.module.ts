import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SponsorController } from './sponsor.controller';
import { SponsorService } from './sponsor.service';
import { SponsorAction, SponsorActionSchema } from '../../schemas/sponsor-action.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: SponsorAction.name, schema: SponsorActionSchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
        ContractsModule, // provides ContractsService (applyApprovedExtension, terminate)
    ],
    controllers: [SponsorController],
    providers: [SponsorService],
    exports: [SponsorService],
})
export class SponsorModule { }
