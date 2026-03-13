import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OtpTokenDocument = OtpToken & Document;

@Schema({ timestamps: true, collection: 'otp_tokens' })
export class OtpToken {
    @Prop({ type: String, required: true })
    email: string;

    @Prop({ type: String, required: true })
    name: string; // Temporarily store the desired name during signup

    @Prop({ type: String, required: true })
    password_hash: string; // Temporarily store the desired password hash

    @Prop({ type: String, required: true })
    otp: string; // The hashed 6-digit code

    // Mongoose TTL index: Document automatically deletes 2 minutes after creation
    @Prop({ type: Date, default: Date.now, expires: 120 })
    createdAt: Date;
}

export const OtpTokenSchema = SchemaFactory.createForClass(OtpToken);
// Create an index to quickly lookup by email
OtpTokenSchema.index({ email: 1 });
