import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SlackAppController } from './slack-app.controller';
import { SlackAppService } from './slack-app.service';
import { Tenant, TenantSchema } from '../../schemas/tenant.schema';
import { TenantUser, TenantUserSchema } from '../../schemas/tenant-user.schema';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractsModule } from '../contracts/contracts.module';
import { SponsorModule } from '../sponsor/sponsor.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: TenantUser.name, schema: TenantUserSchema },
      { name: ContractorContract.name, schema: ContractorContractSchema },
    ]),
    forwardRef(() => ContractsModule),
    forwardRef(() => SponsorModule),
  ],
  controllers: [SlackAppController],
  providers: [SlackAppService],
  exports: [SlackAppService],
})
export class SlackAppModule {}
