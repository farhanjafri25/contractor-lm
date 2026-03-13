import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TenantDocument = Tenant & Document;

export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    TRIAL = 'trial',
    CANCELLED = 'cancelled',
}

export enum TenantPlan {
    FREE = 'free',
    STARTER = 'starter',
    GROWTH = 'growth',
    ENTERPRISE = 'enterprise',
}

export enum BillingStatus {
    ACTIVE = 'active',
    PAST_DUE = 'past_due',
    CANCELLED = 'cancelled',
    TRIALING = 'trialing',
}

@Schema({ timestamps: true, collection: 'tenants' })
export class Tenant {
    @Prop({ required: true })
    name: string;

    @Prop({ type: [String], default: [] })
    domains: string[];

    @Prop({ required: true, unique: true, lowercase: true })
    email_domain: string;

    @Prop({ type: String, enum: TenantStatus, default: TenantStatus.TRIAL })
    status: TenantStatus;

    @Prop({ type: Number, default: null })
    contractor_seat_limit: number | null;

    @Prop({ type: String, enum: TenantPlan, default: TenantPlan.FREE })
    plan: TenantPlan;

    @Prop({ type: String, enum: BillingStatus, default: BillingStatus.TRIALING })
    billing_status: BillingStatus;

    @Prop({ type: Date, default: null })
    billing_renewal_date: Date | null;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
