import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';

import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { ContractorsModule } from './modules/contractors/contractors.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { AccessModule } from './modules/access/access.module';
import { SponsorModule } from './modules/sponsor/sponsor.module';
import { EventsModule } from './modules/events/events.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MailModule } from './modules/mail/mail.module';
import { AiModule } from './modules/ai/ai.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // Config — available globally
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // MongoDB
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
      }),
    }),

    // Redis / BullMQ — supports Upstash (rediss://) and local Redis (redis://)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redis.url');

        if (redisUrl) {
          const url = new URL(redisUrl);
          const isTls = url.protocol === 'rediss:';
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port, 10) || (isTls ? 6380 : 6379),
              password: url.password || undefined,
              username: url.username || undefined,
              maxRetriesPerRequest: null,
              ...(isTls ? { tls: {} } : {}),
            },
            prefix: 'clm',
            defaultJobOptions: {
              removeOnComplete: true,
              removeOnFail: false,
              settings: {
                backoffStrategy: () => 60000,
              }
            },
          };
        }

        // Fallback: bare host+port for local dev without REDIS_URL
        return {
          connection: {
            host: config.get<string>('redis.host') ?? 'localhost',
            port: config.get<number>('redis.port') ?? 6379,
            maxRetriesPerRequest: null,
          },
          prefix: 'clm',
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: false,
            settings: {
              backoffStrategy: () => 60000,
            }
          },
        };
      },
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    // Cron Jobs
    ScheduleModule.forRoot(),

    // Feature modules
    AuthModule,
    TenantsModule,
    ApplicationsModule,
    ContractorsModule,
    ContractsModule,
    AccessModule,
    SponsorModule,
    EventsModule,
    DashboardModule,
    MailModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
