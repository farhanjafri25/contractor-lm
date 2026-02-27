import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TenantApplicationDocument = TenantApplication & Document;

export enum TenantApplicationStatus {
    CONNECTED = 'connected',
    DISCONNECTED = 'disconnected',
    ERROR = 'error',
    REVOKED = 'revoked',
}

export enum SyncFrequency {
    REALTIME = 'realtime',
    HOURLY = 'hourly',
    DAILY = 'daily',
}

@Schema({ timestamps: true, collection: 'tenant_applications' })
export class TenantApplication {
    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Application', required: true })
    application_id: Types.ObjectId;

    @Prop({ type: String, default: 'v1' })
    version_id: string;

    @Prop({ type: String, default: null })
    external_tenant_id: string | null;

    @Prop({ type: String, default: null })
    auth_token_encrypted: string | null;

    @Prop({ type: String, default: null })
    refresh_token_encrypted: string | null;

    @Prop({ type: Date, default: null })
    token_expires_at: Date | null;

    @Prop({ type: [String], default: [] })
    granted_scopes: string[];

    @Prop({ type: String, enum: TenantApplicationStatus, default: TenantApplicationStatus.DISCONNECTED })
    status: TenantApplicationStatus;

    // Integration behaviour config
    @Prop({ type: String, enum: SyncFrequency, default: SyncFrequency.DAILY })
    sync_frequency: SyncFrequency;

    @Prop({ type: Boolean, default: true })
    auto_suspend_enabled: boolean;

    @Prop({ type: Number, default: 7 })
    reminder_days_before: number;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    connected_by: Types.ObjectId | null;

    @Prop({ type: Date, default: null })
    connected_at: Date | null;

    @Prop({ type: Date, default: null })
    last_synced_at: Date | null;

    @Prop({ type: Boolean, default: false })
    is_deleted: boolean;
}

export const TenantApplicationSchema = SchemaFactory.createForClass(TenantApplication);
TenantApplicationSchema.index(
    { tenant_id: 1, application_id: 1 },
    { unique: true, partialFilterExpression: { is_deleted: false } },
);
