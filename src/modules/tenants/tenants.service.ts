import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';

import { Tenant } from '../../schemas/tenant.schema';
import type { TenantDocument } from '../../schemas/tenant.schema';
import { TenantStatus } from '../../schemas/tenant.schema';
import { TenantUser } from '../../schemas/tenant-user.schema';
import type { TenantUserDocument } from '../../schemas/tenant-user.schema';
import { UserStatus, UserRole } from '../../schemas/tenant-user.schema';
import { UpdateTenantDto, InviteUserDto, ListUsersDto, UpdateUserProfileDto } from './dto/tenant.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class TenantsService {
  constructor(
    @InjectModel(Tenant.name)
    private tenantModel: Model<TenantDocument>,

    @InjectModel(TenantUser.name)
    private userModel: Model<TenantUserDocument>,

    private mailService: MailService,
  ) { }

  // ─────────────────────────────────────────────────────────
  // TENANT PROFILE
  // ─────────────────────────────────────────────────────────

  /** GET /tenants/me — returns the caller's tenant profile */
  async getProfile(tenantId: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Tenant not found');
    
    // Security: Do not return sensitive tokens to the frontend
    const { 
      slack_access_token, 
      google_workspace_refresh_token,
      ...safeTenant 
    } = tenant as any;

    return {
      ...safeTenant,
      is_slack_connected: !!slack_access_token,
      is_google_connected: !!google_workspace_refresh_token,
    };
  }

  /** PATCH /tenants/me — update mutable tenant profile fields */
  async updateProfile(tenantId: string, dto: UpdateTenantDto) {
    const updated = await this.tenantModel
      .findByIdAndUpdate(tenantId, { $set: dto }, { new: true, runValidators: true })
      .lean();
    if (!updated) throw new NotFoundException('Tenant not found');
    return updated;
  }

  async disconnectGoogle(tenantId: string) {
    return this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: {
        google_workspace_refresh_token: null,
        google_workspace_domain: null,
      }
    });
  }

  async disconnectSlack(tenantId: string) {
    return this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: {
        slack_access_token: null,
        slack_user_token: null,
        slack_team_id: null,
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // USER MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /** GET /tenants/me/users — list all users in the tenant */
  async listUsers(tenantId: string, query: ListUsersDto) {
    const filter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
    };
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;

    const users = await this.userModel
      .find(filter)
      .select('-password_hash')   // never return hashed password
      .sort({ createdAt: -1 })
      .lean();

    return { data: users, total: users.length };
  }

  /** GET /tenants/me/users/pending — list pending users */
  async listPendingUsers(tenantId: string) {
    const users = await this.userModel
      .find({
        tenant_id: new Types.ObjectId(tenantId),
        status: UserStatus.PENDING_APPROVAL,
      })
      .select('-password_hash')
      .sort({ createdAt: -1 })
      .lean();

    return { data: users, total: users.length };
  }

  /** GET /tenants/me/users/:id */
  async getUser(userId: string, tenantId: string) {
    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(userId), tenant_id: new Types.ObjectId(tenantId) })
      .select('-password_hash')
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * POST /tenants/me/users — invite a new user
   * Creates the user record in INVITED status; a real app would send an email.
   * Validates seat limit against ACTIVE users only.
   */
  async inviteUser(dto: InviteUserDto, tenantId: string, invitedByUserId: string) {
    const tenantOid = new Types.ObjectId(tenantId);
    const invitedByOid = new Types.ObjectId(invitedByUserId);

    // Check for duplicate email within the tenant
    const existing = await this.userModel.findOne({
      tenant_id: tenantOid,
      email: dto.email.toLowerCase(),
    });
    if (existing) {
      if (existing.status === UserStatus.DEACTIVATED) {
        throw new ConflictException(
          `${dto.email} was previously deactivated. Reactivate the account instead of re-inviting.`,
        );
      }
      throw new ConflictException(`${dto.email} already exists in this tenant`);
    }

    // Enforce per-tenant user limit (admin + security + sponsor seats)
    await this._enforceUserSeatLimit(tenantId);

    // Generate secure magic link token
    const tokenPayload = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(tokenPayload, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Token valid for 7 days

    const user = await this.userModel.create({
      tenant_id: tenantOid,
      role: UserRole.SPONSOR,
      is_invited: true,
      invited_by: invitedByOid,
      invited_at: new Date(),
      password_hash: null,
      invite_token_hash: tokenHash,
      invite_token_expires_at: expiresAt,
    });

    const tenant = await this.tenantModel.findById(new Types.ObjectId(tenantId));
    const tenantName = tenant ? tenant.name : 'your workspace';

    // Send email asynchronously
    this.mailService.sendInviteEmail(dto.email.toLowerCase(), tokenPayload, tenantName);

    return {
      ...user.toObject(),
      password_hash: undefined,
      message: `Invitation sent to ${dto.email}`,
    };
  }



  /**
   * GET /tenants/me/user — get personal profile
   */
  async getUserProfile(tenantId: string, userId: string) {
    const user = await this._getUser(userId, tenantId);
    return user;
  }

  /**
   * PATCH /tenants/me/user — update personal profile
   */
  async updateUserProfile(tenantId: string, userId: string, dto: UpdateUserProfileDto) {
    const user = await this._getUser(userId, tenantId);
    
    // Only update fields that are provided
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.info !== undefined) updateData.info = dto.info;
    if (dto.avatar !== undefined) updateData.avatar = dto.avatar;
    if (dto.marketing_opt_in !== undefined) updateData.marketing_opt_in = dto.marketing_opt_in;

    await this.userModel.findByIdAndUpdate(user._id, updateData);
    
    return { ...user.toObject(), ...updateData };
  }

  /**
   * POST /tenants/me/users/:id/deactivate — soft-delete a user
   * Deactivated users cannot log in; their sponsorships remain for audit trail.
   */
  async deactivateUser(userId: string, tenantId: string, callerId: string) {
    if (userId === callerId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const user = await this._getUser(userId, tenantId);

    if (user.status === UserStatus.DEACTIVATED) {
      throw new BadRequestException('User is already deactivated');
    }

    // Prevent deactivating last admin
    if (user.role === UserRole.ADMIN) {
      await this._ensureAdminRemainsAfterChange(tenantId, userId);
    }

    await this.userModel.findByIdAndUpdate(user._id, {
      status: UserStatus.DEACTIVATED,
    });

    return { success: true, userId, status: UserStatus.DEACTIVATED };
  }

  /**
   * POST /tenants/me/users/:id/reactivate — re-enable a deactivated user
   * Sets status back to ACTIVE and enforces seat limit.
   */
  async reactivateUser(userId: string, tenantId: string) {
    const user = await this._getUser(userId, tenantId);

    if (user.status !== UserStatus.DEACTIVATED) {
      throw new BadRequestException('User is not deactivated');
    }

    await this._enforceUserSeatLimit(tenantId);

    await this.userModel.findByIdAndUpdate(user._id, {
      status: UserStatus.ACTIVE,
    });

    return { success: true, userId, status: UserStatus.ACTIVE };
  }

  /** POST /tenants/me/users/:id/approve — admin approves an auto-joined sponsor */
  async approveUser(userId: string, tenantId: string) {
    const user = await this._getUser(userId, tenantId);

    if (user.status !== UserStatus.PENDING_APPROVAL) {
      throw new BadRequestException('User is not pending approval');
    }

    await this._enforceUserSeatLimit(tenantId);

    await this.userModel.findByIdAndUpdate(user._id, {
      status: UserStatus.ACTIVE,
    });

    return { success: true, userId, status: UserStatus.ACTIVE };
  }

  /** POST /tenants/me/users/:id/reject — admin rejects an auto-joined sponsor */
  async rejectUser(userId: string, tenantId: string) {
    const user = await this._getUser(userId, tenantId);

    if (user.status !== UserStatus.PENDING_APPROVAL) {
      throw new BadRequestException('User is not pending approval');
    }

    // Delete the record so they can try signing up again if it was a mistake
    await this.userModel.findByIdAndDelete(user._id);

    return { success: true, userId, status: 'rejected_deleted' };
  }

  /**
   * POST /tenants/me/users/:id/set-password — admin sets password for a user
   * Typically used after the first invite flow or a password reset.
   */
  async setPassword(userId: string, tenantId: string, password: string) {
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const user = await this._getUser(userId, tenantId);
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await this.userModel.findByIdAndUpdate(user._id, {
      password_hash: hash,
      status: UserStatus.ACTIVE,   // activates invited users on first password set
      is_invited: false,
    });

    return { success: true, userId, status: UserStatus.ACTIVE };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────

  private async _getUser(userId: string, tenantId: string): Promise<TenantUserDocument> {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      tenant_id: new Types.ObjectId(tenantId),
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async _enforceUserSeatLimit(tenantId: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant?.contractor_seat_limit) return; // no limit set

    // Count only active/invited users (not deactivated)
    const activeCount = await this.userModel.countDocuments({
      tenant_id: new Types.ObjectId(tenantId),
      status: { $in: [UserStatus.ACTIVE, UserStatus.INVITED] },
    });

    if (activeCount >= tenant.contractor_seat_limit) {
      throw new ForbiddenException(
        `User seat limit reached (${tenant.contractor_seat_limit}). ` +
        `Deactivate a user or upgrade your plan to add more.`,
      );
    }
  }

  private async _ensureAdminRemainsAfterChange(tenantId: string, excludeUserId: string) {
    const otherAdmins = await this.userModel.countDocuments({
      tenant_id: new Types.ObjectId(tenantId),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      _id: { $ne: new Types.ObjectId(excludeUserId) },
    });

    if (otherAdmins === 0) {
      throw new ForbiddenException(
        'Cannot remove the last active admin. Promote another user to admin first.',
      );
    }
  }

  /**
   * GET /tenants/me/stats — lightweight stats used by dashboard header
   */
  async getStats(tenantId: string) {
    const tenantOid = new Types.ObjectId(tenantId);
    const [activeUsers, invitedUsers, tenant] = await Promise.all([
      this.userModel.countDocuments({ tenant_id: tenantOid, status: UserStatus.ACTIVE }),
      this.userModel.countDocuments({ tenant_id: tenantOid, status: UserStatus.INVITED }),
      this.tenantModel.findById(tenantId).select('plan billing_status contractor_seat_limit').lean(),
    ]);

    return {
      active_users: activeUsers,
      invited_users: invitedUsers,
      plan: tenant?.plan,
      billing_status: tenant?.billing_status,
      contractor_seat_limit: tenant?.contractor_seat_limit ?? null,
    };
  }
}
