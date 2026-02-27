import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { ContractorsController } from './contractors.controller';
import { ContractorsService } from './contractors.service';
import { ContractorIdentity, ContractorIdentitySchema } from '../../schemas/contractor-identity.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { ImportProcessor } from '../../jobs/import.processor';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorIdentity.name, schema: ContractorIdentitySchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
        BullModule.registerQueue({ name: 'provisioning' }),
        BullModule.registerQueue({ name: 'import' }),
    ],
    controllers: [ContractorsController],
    providers: [ContractorsService, ImportProcessor],
    exports: [ContractorsService],
})
export class ContractorsModule { }
