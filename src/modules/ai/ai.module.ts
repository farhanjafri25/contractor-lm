import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ContractorsModule } from '../contractors/contractors.module';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [ContractorsModule, ContractsModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
