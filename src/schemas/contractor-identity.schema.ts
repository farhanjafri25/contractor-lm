import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractorIdentityDocument = ContractorIdentity & Document;

@Schema({ timestamps: true, collection: 'contractor_identities' })
export class ContractorIdentity {
    @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
    tenant_id: Types.ObjectId;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true, lowercase: true })
    email: string;

    @Prop({ type: String, default: null })
    job_title: string | null;

    @Prop({ type: String, default: null })
    department: string | null;

    @Prop({ type: String, default: null })
    phone: string | null;

    @Prop({ type: String, default: null })
    location: string | null;

    @Prop({ type: String, default: null })
    notes: string | null;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', required: true })
    created_by: Types.ObjectId;
}

export const ContractorIdentitySchema = SchemaFactory.createForClass(ContractorIdentity);
ContractorIdentitySchema.index({ tenant_id: 1, email: 1 }, { unique: true });
