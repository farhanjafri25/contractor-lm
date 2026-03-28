import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { LifecycleEvent, LifecycleEventSchema } from '../../schemas/lifecycle-event.schema';
import { ContractorIdentity, ContractorIdentitySchema } from '../../schemas/contractor-identity.schema';
import { TenantApplication, TenantApplicationSchema } from '../../schemas/tenant-application.schema';
import { Application, ApplicationSchema } from '../../schemas/application.schema';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ProvisioningProcessor } from '../../jobs/provisioning.processor';
import { RevocationProcessor } from '../../jobs/revocation.processor';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: LifecycleEvent.name, schema: LifecycleEventSchema },
            { name: ContractorIdentity.name, schema: ContractorIdentitySchema },
            { name: TenantApplication.name, schema: TenantApplicationSchema },
            { name: Application.name, schema: ApplicationSchema },
        ]),
        IntegrationsModule,
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
        ProvisioningProcessor,
        RevocationProcessor
    ],
    exports: [AccessService],
})
export class AccessModule { }
