import { Injectable, Logger, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { TenantUser, UserStatus, UserRole } from '../../schemas/tenant-user.schema';
import type { TenantUserDocument } from '../../schemas/tenant-user.schema';
import { OtpToken, OtpTokenDocument } from '../../schemas/otp.schema';
import { Tenant, TenantDocument, TenantStatus, TenantPlan, BillingStatus } from '../../schemas/tenant.schema';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(TenantUser.name) private userModel: Model<TenantUserDocument>,
        @InjectModel(OtpToken.name) private otpModel: Model<OtpTokenDocument>,
        @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
        private jwtService: JwtService,
        private configService: ConfigService,
        private mailService: MailService,
    ) { }

    // ─────────────────────────────────────────────────────────
    // SIGNUP — POST /auth/signup
    // ─────────────────────────────────────────────────────────
    async signup(email: string, name: string, passwordPlain: string) {
        const emailLower = email.toLowerCase();
        
        // Check if user already exists
        const existingUser = await this.userModel.findOne({ email: emailLower });
        if (existingUser) {
            throw new ConflictException('An account with this email already exists');
        }

        // Generate 6 digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otpCode, 10);
        const passHash = await bcrypt.hash(passwordPlain, 10);

        // Save/Update OTP token document
        await this.otpModel.findOneAndUpdate(
            { email: emailLower },
            { name, password_hash: passHash, otp: otpHash, createdAt: new Date() },
            { upsert: true, new: true }
        );

        // Send Email via Resend
        await this.mailService.sendOtpEmail(emailLower, otpCode, name);

        return { message: 'OTP sent successfully to your email' };
    }

    // ─────────────────────────────────────────────────────────
    // VERIFY OTP & AUTO-JOIN ORG — POST /auth/verify-otp
    // ─────────────────────────────────────────────────────────
    async verifyOtp(email: string, otpCode: string) {
        const emailLower = email.toLowerCase();
        
        const tokenDoc = await this.otpModel.findOne({ email: emailLower });
        if (!tokenDoc) {
            throw new BadRequestException('OTP has expired or does not exist. Please request a new one.');
        }

        const validOtp = await bcrypt.compare(otpCode, tokenDoc.otp);
        if (!validOtp) {
            throw new BadRequestException('Invalid OTP code');
        }

        // OTP Validated! Discover domain.
        const domain = emailLower.split('@')[1];
        if (!domain) throw new BadRequestException('Invalid email format');

        // Check if a Tenant exists for this domain
        let tenant = await this.tenantModel.findOne({ 
            $or: [
                { email_domain: domain },
                { domains: { $in: [domain] } }
            ]
        });

        let newUser: TenantUserDocument;

        if (tenant) {
            // Organization exists! Auto-join as a Sponsor, put in Pending state
            newUser = await this.userModel.create({
                tenant_id: tenant._id,
                email: emailLower,
                name: tokenDoc.name,
                password_hash: tokenDoc.password_hash,
                role: UserRole.SPONSOR,
                status: UserStatus.PENDING_APPROVAL,
                is_invited: false,
            });

            await this.otpModel.deleteOne({ _id: tokenDoc._id });
            return { 
                status: 'pending_approval', 
                message: 'You have joined the organization. An owner or admin must approve your account before you can log in.',
                tenant_name: tenant.name 
            };
        } else {
            // New Organization! Create Workspace and make Admin
            const workspaceName = domain.split('.')[0]; // e.g. "acme" from "acme.com"
            const tenantName = workspaceName.charAt(0).toUpperCase() + workspaceName.slice(1) + ' Workspace';

            tenant = await this.tenantModel.create({
                name: tenantName,
                email_domain: domain,
                domains: [domain],
                status: TenantStatus.TRIAL,
                plan: TenantPlan.FREE,
                billing_status: BillingStatus.TRIALING,
            });

            newUser = await this.userModel.create({
                tenant_id: tenant._id,
                email: emailLower,
                name: tokenDoc.name,
                password_hash: tokenDoc.password_hash,
                role: UserRole.ADMIN,
                status: UserStatus.ACTIVE,
                is_invited: false,
            });

            await this.otpModel.deleteOne({ _id: tokenDoc._id });
            
            // Log them in immediately
            return this.login(newUser);
        }
    }

    // ─────────────────────────────────────────────────────────
    // LOGIN — POST /auth/login
    // ─────────────────────────────────────────────────────────
    async validateUser(email: string, password: string) {
        const user = await this.userModel.findOne({
            email: email.toLowerCase(),
        });
        
        if (!user || !user.password_hash) throw new UnauthorizedException('Invalid credentials');
        
        if (user.status === UserStatus.PENDING_APPROVAL) {
            throw new UnauthorizedException('Account is pending owner/admin approval');
        }
        if (user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException('Account is suspended or deactivated');
        }

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

    // ─────────────────────────────────────────────────────────
    // ACCEPT INVITE — POST /auth/accept-invite
    // ─────────────────────────────────────────────────────────
    async acceptInvite(email: string, token: string, newPasswordPlain: string) {
        const user = await this.userModel.findOne({ email: email.toLowerCase() });
        if (!user) {
            throw new BadRequestException('Invalid invite link or user does not exist');
        }

        if (user.status !== UserStatus.INVITED || !user.is_invited) {
            throw new BadRequestException('This account has already been registered or is not in an invited state.');
        }

        if (!user.invite_token_hash || !user.invite_token_expires_at) {
            throw new BadRequestException('Invalid invite token');
        }

        if (new Date() > user.invite_token_expires_at) {
            throw new BadRequestException('This invite link has expired. Please request a new one.');
        }

        const validToken = await bcrypt.compare(token, user.invite_token_hash);
        if (!validToken) {
            throw new BadRequestException('Invalid invite link');
        }

        // Token is valid! Hash new password and activate the user.
        const passHash = await bcrypt.hash(newPasswordPlain, 10);
        user.password_hash = passHash;
        user.status = UserStatus.ACTIVE;
        
        // Destroy the token so it cannot be used again
        user.invite_token_hash = null;
        user.invite_token_expires_at = null;
        await user.save();

        // Automatically log them in
        return this.login(user);
    }

    // ─────────────────────────────────────────────────────────
    // FORGOT PASSWORD — POST /auth/forgot-password
    // ─────────────────────────────────────────────────────────
    async forgotPassword(email: string) {
        const emailLower = email.toLowerCase();
        
        // Check if user exists
        const user = await this.userModel.findOne({ email: emailLower });
        if (!user) {
            // For security, don't reveal if user exists or not
            return { message: 'If an account exists with this email, an OTP has been sent' };
        }

        // Generate 6 digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otpCode, 10);

        // Save/Update OTP token document
        await this.otpModel.findOneAndUpdate(
            { email: emailLower },
            { otp: otpHash, createdAt: new Date() },
            { upsert: true, new: true }
        );

        // Send Email
        await this.mailService.sendForgotPasswordEmail(emailLower, otpCode);

        return { message: 'If an account exists with this email, an OTP has been sent' };
    }

    // ─────────────────────────────────────────────────────────
    // RESET PASSWORD — POST /auth/reset-password
    // ─────────────────────────────────────────────────────────
    async resetPassword(email: string, otpCode: string, newPasswordPlain: string) {
        const emailLower = email.toLowerCase();
        
        const tokenDoc = await this.otpModel.findOne({ email: emailLower });
        if (!tokenDoc) {
            throw new BadRequestException('OTP has expired or does not exist. Please request a new one.');
        }

        const validOtp = await bcrypt.compare(otpCode, tokenDoc.otp);
        if (!validOtp) {
            throw new BadRequestException('Invalid OTP code');
        }

        // OTP Validated! Hash new password and update user.
        const user = await this.userModel.findOne({ email: emailLower });
        if (!user) {
            throw new BadRequestException('User not found');
        }

        const passHash = await bcrypt.hash(newPasswordPlain, 10);
        user.password_hash = passHash;
        await user.save();

        // Delete the OTP
        await this.otpModel.deleteOne({ _id: tokenDoc._id });

        return { message: 'Password has been reset successfully' };
    }
}
