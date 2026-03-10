import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ContractorContract, ContractorContractSchema } from '../../schemas/contractor-contract.schema';
import { ContractorAccess, ContractorAccessSchema } from '../../schemas/contractor-access.schema';
import { ContractorIdentity, ContractorIdentitySchema } from '../../schemas/contractor-identity.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: ContractorContract.name, schema: ContractorContractSchema },
            { name: ContractorAccess.name, schema: ContractorAccessSchema },
            { name: ContractorIdentity.name, schema: ContractorIdentitySchema },
        ]),
    ],
    controllers: [DashboardController],
    providers: [DashboardService],
})
export class DashboardModule { }
