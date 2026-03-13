import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TenantUser, TenantUserSchema } from '../../schemas/tenant-user.schema';
import { OtpToken, OtpTokenSchema } from '../../schemas/otp.schema';
import { Tenant, TenantSchema } from '../../schemas/tenant.schema';
import { MailModule } from '../mail/mail.module';

@Module({
    imports: [
        ConfigModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService): any => ({
                secret: config.get<string>('jwt.secret') ?? '',
                signOptions: { expiresIn: config.get<string>('jwt.expiresIn') ?? '1h' },
            }),
        }),
        MongooseModule.forFeature([
            { name: TenantUser.name, schema: TenantUserSchema },
            { name: OtpToken.name, schema: OtpTokenSchema },
            { name: Tenant.name, schema: TenantSchema },
        ]),
        MailModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy],
    exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule { }
