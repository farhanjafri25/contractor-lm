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
            { name: 'ContractorIdentity', schema: require('../../schemas/contractor-identity.schema').ContractorIdentitySchema },
            { name: 'TenantApplication', schema: require('../../schemas/tenant-application.schema').TenantApplicationSchema },
        ]),
        require('../integrations/integrations.module').IntegrationsModule,
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
            },
        ),
    ],
    controllers: [AccessController],
    providers: [
        AccessService, 
        require('../../jobs/provisioning.processor').ProvisioningProcessor,
        require('../../jobs/revocation.processor').RevocationProcessor
    ],
    exports: [AccessService],
})
export class AccessModule { }
