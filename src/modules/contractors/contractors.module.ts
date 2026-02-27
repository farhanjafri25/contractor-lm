import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContractorsController } from './contractors.controller';
import { ContractorsService } from './contractors.service';
import { ContractorIdentity, ContractorIdentitySchema } from '../../schemas/contractor-identity.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorIdentity.name, schema: ContractorIdentitySchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
    ],
    controllers: [ContractorsController],
    providers: [ContractorsService],
    exports: [ContractorsService],
})
export class ContractorsModule { }
