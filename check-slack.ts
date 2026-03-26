import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant } from './src/schemas/tenant.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tenantModel = app.get<Model<any>>(getModelToken(Tenant.name));
  
  const tenants = await tenantModel.find({ slack_access_token: { $ne: null } }).lean();
  
  console.log('--- Connected Slack Tenants ---');
  tenants.forEach(t => {
    console.log(`ID: ${t._id}`);
    console.log(`Name: ${t.name}`);
    console.log(`Slack Team ID: ${t.slack_team_id}`);
    console.log(`Has Bot Token: ${!!t.slack_access_token}`);
    console.log(`Has User Token: ${!!t.slack_user_token}`);
    console.log(`Default Channel: ${t.slack_channel_id || 'Not set'}`);
    console.log('---------------------------');
  });

  if (tenants.length === 0) {
    console.log('No tenants have Slack connected.');
  }

  await app.close();
}

bootstrap();
