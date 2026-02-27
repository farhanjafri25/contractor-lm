import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
        ]),
        BullModule.registerQueue({ name: 'revocation' }),
    ],
    controllers: [AccessController],
    providers: [AccessService],
    exports: [AccessService],
})
export class AccessModule { }
