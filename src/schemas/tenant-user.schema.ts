import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TenantUserDocument = TenantUser & Document;

export enum UserRole {
    OWNER = 'owner',
    ADMIN = 'admin',
    SPONSOR = 'sponsor',
}

export enum UserStatus {
    ACTIVE = 'active',
    INVITED = 'invited',
    PENDING_APPROVAL = 'pending_approval',
    SUSPENDED = 'suspended',
    DEACTIVATED = 'deactivated',
}

@Schema({ timestamps: true, collection: 'tenant_users' })
export class TenantUser {
    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ required: true, lowercase: true })
    email: string;

    @Prop({ type: String, default: null })
    password_hash: string | null;

    @Prop({ type: String, enum: UserRole, required: true })
    role: UserRole;

    @Prop({ type: String, enum: UserStatus, default: UserStatus.INVITED })
    status: UserStatus;

    @Prop({ type: Boolean, default: true })
    is_invited: boolean;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    invited_by: Types.ObjectId | null;

    @Prop({ type: Date, default: null })
    invited_at: Date | null;

    @Prop({ type: Date, default: null })
    last_login_at: Date | null;

    @Prop({ type: String, default: null })
    invite_token_hash: string | null;

    @Prop({ type: Date, default: null })
    invite_token_expires_at: Date | null;
}

export const TenantUserSchema = SchemaFactory.createForClass(TenantUser);
TenantUserSchema.index({ tenant_id: 1, email: 1 }, { unique: true });
