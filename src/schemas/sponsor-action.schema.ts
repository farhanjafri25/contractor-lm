import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SponsorActionDocument = SponsorAction & Document;

export enum SponsorActionType {
    ONBOARD = 'onboard',
    EXTEND = 'extend',
    TERMINATE = 'terminate',
    NO_RESPONSE = 'no_response',
    REACTIVATE = 'reactivate',
    ACCESS_CHANGE = 'access_change',
}

export enum SponsorActionStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
}

@Schema({ timestamps: true, collection: 'sponsor_actions' })
export class SponsorAction {
    @Prop({ type: Types.ObjectId, ref: 'ContractorContract', required: true })
    contract_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', required: true })
    sponsor_id: Types.ObjectId;

    // Request phase
    @Prop({ type: String, enum: SponsorActionType, required: true })
    action_type: SponsorActionType;

    @Prop({ type: Date, default: null })
    proposed_end_date: Date | null;

    @Prop({ type: String, default: null })
    justification: string | null;

    // Approval phase
    @Prop({ type: String, enum: SponsorActionStatus, default: SponsorActionStatus.PENDING })
    status: SponsorActionStatus;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    reviewed_by: Types.ObjectId | null;

    @Prop({ type: Date, default: null })
    reviewed_at: Date | null;

    @Prop({ type: String, default: null })
    review_note: string | null;

    // After approval, canonical new end date
    @Prop({ type: Date, default: null })
    new_end_date: Date | null;

    @Prop({ type: Date, default: null })
    reminder_sent_at: Date | null;

    @Prop({ type: Date, required: true })
    response_deadline: Date;

    @Prop({ type: Date, default: null })
    actioned_at: Date | null;
}

export const SponsorActionSchema = SchemaFactory.createForClass(SponsorAction);
SponsorActionSchema.index({ contract_id: 1 });
SponsorActionSchema.index({ sponsor_id: 1, actioned_at: -1 });
SponsorActionSchema.index({ status: 1, response_deadline: 1 }); // for pending action queries
