import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractorAccessDocument = ContractorAccess & Document;

export enum ProvisioningStatus {
    PENDING = 'pending',
    ACTIVE = 'active',
    REVOKED = 'revoked',
    FAILED = 'failed',
    SKIPPED = 'skipped',
}

export enum SyncStatus {
    PENDING = 'pending',
    SYNCED = 'synced',
    ERROR = 'error',
}

@Schema({ timestamps: true, collection: 'contractor_access' })
export class ContractorAccess {
    @Prop({ type: Types.ObjectId, ref: 'ContractorContract', required: true })
    contract_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ContractorIdentity', required: true })
    contractor_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'TenantApplication', required: true })
    tenant_application_id: Types.ObjectId;

    @Prop({ type: String, default: null })
    external_account_id: string | null;

    @Prop({ type: String, default: null })
    access_role: string | null;

    @Prop({ type: [String], default: [] })
    groups_assigned: string[];

    @Prop({ type: String, enum: ProvisioningStatus, default: ProvisioningStatus.PENDING })
    provisioning_status: ProvisioningStatus;

    @Prop({ type: Number, default: 0 })
    revocation_attempts: number;

    @Prop({ type: Date, default: null })
    last_attempt_at: Date | null;

    @Prop({ type: String, default: null })
    failure_reason: string | null;

    // Directory-type sync tracking (Google Workspace etc.)
    @Prop({ type: Boolean, default: false })
    is_email_provisioned: boolean;

    @Prop({ type: String, enum: SyncStatus, default: SyncStatus.PENDING })
    sync_status: SyncStatus;

    @Prop({ type: Date, default: null })
    last_synced_at: Date | null;

    @Prop({ type: Date, default: null })
    granted_at: Date | null;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    granted_by: Types.ObjectId | null;

    @Prop({ type: Date, default: null })
    revoked_at: Date | null;

    @Prop({ type: String, default: null }) // 'system' or ObjectId string
    revoked_by: string | null;
}

export const ContractorAccessSchema = SchemaFactory.createForClass(ContractorAccess);
ContractorAccessSchema.index({ contract_id: 1 });
ContractorAccessSchema.index({ provisioning_status: 1 });
ContractorAccessSchema.index({ tenant_application_id: 1, external_account_id: 1 });
