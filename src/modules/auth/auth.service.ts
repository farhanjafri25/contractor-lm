import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { TenantUser, UserStatus } from '../../schemas/tenant-user.schema';
import type { TenantUserDocument } from '../../schemas/tenant-user.schema';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(TenantUser.name) private userModel: Model<TenantUserDocument>,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) { }

    async validateUser(email: string, password: string, tenantId: string) {
        const user = await this.userModel.findOne({
            email: email.toLowerCase(),
            tenant_id: new Types.ObjectId(tenantId),
            status: UserStatus.ACTIVE,
        });
        if (!user || !user.password_hash) throw new UnauthorizedException('Invalid credentials');
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) throw new UnauthorizedException('Invalid credentials');
        return user;
    }

    async login(user: TenantUserDocument) {
        const payload = {
            sub: user._id,
            tenant_id: user.tenant_id,
            role: user.role,
            email: user.email,
        };
        const access_token = this.jwtService.sign(payload as any);
        const refresh_token = this.jwtService.sign(payload as any, {
            secret: this.configService.get<string>('jwt.refreshSecret') ?? '',
            expiresIn: (this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d') as any,
        });

        // Update last_login_at
        await this.userModel.findByIdAndUpdate(user._id, { last_login_at: new Date() });

        return { access_token, refresh_token, expires_in: 3600, user: { _id: user._id, email: user.email, role: user.role } };
    }

    async refreshToken(token: string) {
        const payload = this.jwtService.verify(token, {
            secret: this.configService.get<string>('jwt.refreshSecret'),
        });
        const access_token = this.jwtService.sign({
            sub: payload.sub,
            tenant_id: payload.tenant_id,
            role: payload.role,
            email: payload.email,
        });
        return { access_token, expires_in: 3600 };
    }
}
