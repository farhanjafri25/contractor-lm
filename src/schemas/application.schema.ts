import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApplicationDocument = Application & Document;

export enum AuthType {
    OAUTH2 = 'oauth2',
    API_KEY = 'api_key',
    SAML = 'saml',
    MANUAL = 'manual',
}

@Schema({ timestamps: true, collection: 'applications' })
export class Application {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true, unique: true, lowercase: true })
    slug: string;

    @Prop({ type: String, enum: AuthType, required: true })
    auth_type: AuthType;

    @Prop({ type: String, default: null })
    image_url: string | null;

    @Prop({ type: String, default: 'v1' })
    version_id: string;

    @Prop({ type: [String], default: [] })
    scopes: string[];

    @Prop({ type: Boolean, default: true })
    is_active: boolean;
}

export const ApplicationSchema = SchemaFactory.createForClass(Application);
