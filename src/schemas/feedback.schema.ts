import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FeedbackDocument = Feedback & Document;

export enum FeedbackCategory {
    BUG = 'bug',
    FEATURE_REQUEST = 'feature_request',
    GENERAL = 'general',
    SUPPORT = 'support',
}

export enum FeedbackStatus {
    NEW = 'new',
    REVIEWED = 'reviewed',
    RESOLVED = 'resolved',
}

@Schema({ timestamps: true, collection: 'feedback' })
export class Feedback {
    @Prop({ type: Types.ObjectId, ref: 'Tenant', default: null })
    tenant_id: Types.ObjectId | null;

    @Prop({ type: Types.ObjectId, ref: 'TenantUser', default: null })
    user_id: Types.ObjectId | null;

    @Prop({ type: String, enum: FeedbackCategory, required: true })
    category: FeedbackCategory;

    @Prop({ type: String, required: true })
    message: string;

    @Prop({ type: String, enum: FeedbackStatus, default: FeedbackStatus.NEW })
    status: FeedbackStatus;

    @Prop({ type: Number, min: 1, max: 5, default: null })
    rating: number | null;

    @Prop({ type: Object, default: {} })
    metadata: Record<string, any>;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
FeedbackSchema.index({ tenant_id: 1, status: 1 });
FeedbackSchema.index({ category: 1, status: 1 });
