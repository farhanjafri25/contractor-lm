import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import {
  SlackIntegration,
  SlackIntegrationSchema,
} from '../../schemas/slack-integration.schema';
import { EncryptionService } from '../../common/services/encryption.service';
import { ContractsModule } from '../contracts/contracts.module';
import { SponsorModule } from '../sponsor/sponsor.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SlackIntegration.name, schema: SlackIntegrationSchema },
    ]),
    forwardRef(() => ContractsModule),
    forwardRef(() => SponsorModule),
  ],
  controllers: [SlackController],
  providers: [SlackService, EncryptionService],
  exports: [SlackService],
})
export class SlackModule {}
