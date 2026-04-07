import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { Tenant, TenantSchema } from '../../schemas/tenant.schema';
import { Application, ApplicationSchema } from '../../schemas/application.schema';
import { TenantApplication, TenantApplicationSchema } from '../../schemas/tenant-application.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: Application.name, schema: ApplicationSchema },
      { name: TenantApplication.name, schema: TenantApplicationSchema },
    ])
  ],
  controllers: [GoogleController, SlackController],
  providers: [GoogleService, SlackService],
  exports: [GoogleService, SlackService]
})
export class IntegrationsModule {}
