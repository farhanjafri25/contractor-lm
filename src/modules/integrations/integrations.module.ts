import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { Tenant, TenantSchema } from '../../schemas/tenant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }])
  ],
  controllers: [GoogleController],
  providers: [GoogleService],
  exports: [GoogleService]
})
export class IntegrationsModule {}
