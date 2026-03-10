import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
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
            { name: 'revocation' },
            { name: 'provisioning' },
        ),
    ],
    controllers: [AccessController],
    providers: [AccessService],
    exports: [AccessService],
})
export class AccessModule { }
