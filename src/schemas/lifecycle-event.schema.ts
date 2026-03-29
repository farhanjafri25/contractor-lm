import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LifecycleEventDocument = LifecycleEvent & Document;

export enum EventType {
    // Contractor
    CONTRACTOR_CREATED = 'contractor.created',
    CONTRACTOR_ONBOARDED = 'contractor.onboarded',
    CONTRACTOR_BULK_IMPORTED = 'contractor.bulk_imported',
    CONTRACTOR_DELETED = 'contractor.deleted',

    // Access
    ACCESS_GRANTED = 'access.granted',
    ACCESS_REVOKED = 'access.revoked',
    ACCESS_REVOCATION_FAILED = 'access.revocation_failed',

    // Directory / Sync
    DIRECTORY_SYNC_SUCCESS = 'directory_sync.success',
    DIRECTORY_SYNC_FAILED = 'directory_sync.failed',

    // Contract
    CONTRACT_SUSPENDED = 'contract.suspended',
    CONTRACT_REACTIVATED = 'contract.reactivated',
    CONTRACT_EXTENDED = 'contract.extended',
    CONTRACT_TERMINATED = 'contract.terminated',
    CONTRACT_EXPIRED = 'contract.expired',

    // Sponsor / Extension flow
    SPONSOR_REMINDER_SENT = 'sponsor.reminder_sent',
    SPONSOR_NO_RESPONSE = 'sponsor.no_response',
    ONBOARDING_REQUESTED = 'onboarding.requested',
    EXTENSION_REQUEST_SUBMITTED = 'extension.request_submitted',
    EXTENSION_REQUEST_APPROVED = 'extension.request_approved',
    EXTENSION_REQUEST_REJECTED = 'extension.request_rejected',
}

export enum ActorType {
    USER = 'user',
    SYSTEM = 'system',
    SPONSOR = 'sponsor',
}

@Schema({ collection: 'lifecycle_events' }) // no timestamps — created_at is immutable
export class LifecycleEvent {
    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ContractorIdentity', required: true })
    contractor_id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ContractorContract', required: false, default: null })
    contract_id: Types.ObjectId | null;

    @Prop({ type: Types.ObjectId, ref: 'ContractorAccess', default: null })
    access_id: Types.ObjectId | null;

    @Prop({ type: String, enum: EventType, required: true })
    event_type: EventType;

    @Prop({ type: String, enum: ActorType, required: true })
    actor_type: ActorType;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    actor_id: Types.ObjectId | null;

    @Prop({ type: Object, default: {} })
    metadata: Record<string, any>;

    @Prop({ type: Date, default: () => new Date(), immutable: true })
    created_at: Date;
}

export const LifecycleEventSchema = SchemaFactory.createForClass(LifecycleEvent);
LifecycleEventSchema.index({ tenant_id: 1, created_at: -1 });
LifecycleEventSchema.index({ contract_id: 1, event_type: 1 });
LifecycleEventSchema.index({ contractor_id: 1 });
