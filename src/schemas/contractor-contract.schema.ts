import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractorContractDocument = ContractorContract & Document;

export enum ContractStatus {
    PENDING = 'pending',
    ACTIVE = 'active',
    EXTENDED = 'extended',
    SUSPENDED = 'suspended',
    EXPIRED = 'expired',
    TERMINATED = 'terminated',
}

export enum TerminationReason {
    NATURAL_EXPIRY = 'natural_expiry',
    EARLY_TERMINATION = 'early_termination',
    REHIRED = 'rehired',
    NO_SHOW = 'no_show',
}

@Schema({ timestamps: true, collection: 'contractor_contracts' })
export class ContractorContract {
    @Prop({ type: Types.ObjectId, ref: 'ContractorIdentity', required: true })
    contractor_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    sponsor_id: Types.ObjectId | null;

    @Prop({ required: true })
    start_date: Date;

    @Prop({ required: true })
    end_date: Date;

    @Prop({ required: true })
    original_end_date: Date;

    @Prop({ type: String, enum: ContractStatus, default: ContractStatus.ACTIVE })
    status: ContractStatus;

    @Prop({ type: Boolean, default: false })
    create_google_account: boolean;

    @Prop({ type: Boolean, default: false })
    create_slack_account: boolean;

    @Prop({ type: Number, default: 0 })
    extension_count: number;

    @Prop({ type: String, enum: TerminationReason, default: null })
    termination_reason: TerminationReason | null;

    @Prop({ type: Boolean, default: false })
    is_rehire: boolean;

    @Prop({ type: Types.ObjectId, ref: 'ContractorContract', default: null })
    previous_contract_id: Types.ObjectId | null;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', required: true })
    created_by: Types.ObjectId;
}

export const ContractorContractSchema = SchemaFactory.createForClass(ContractorContract);
ContractorContractSchema.index({ tenant_id: 1, status: 1 });
ContractorContractSchema.index({ sponsor_id: 1, status: 1 });
ContractorContractSchema.index({ end_date: 1, status: 1 }); // expiry engine polling
