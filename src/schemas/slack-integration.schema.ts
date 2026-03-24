import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SlackIntegrationDocument = SlackIntegration & Document;

@Schema({ timestamps: true, collection: 'slack_integrations' })
export class SlackIntegration {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenant_id: Types.ObjectId;

  @Prop({ required: true })
  team_id: string;

  @Prop({ required: true })
  team_name: string;

  @Prop({ required: true })
  bot_user_id: string;

  @Prop({ required: true })
  access_token_encrypted: string;

  @Prop({ type: Types.ObjectId, ref: 'TenantUser', required: true })
  connected_by: Types.ObjectId;

  @Prop({ default: true })
  is_active: boolean;
}

export const SlackIntegrationSchema =
  SchemaFactory.createForClass(SlackIntegration);
SlackIntegrationSchema.index({ tenant_id: 1 }, { unique: true });
SlackIntegrationSchema.index({ team_id: 1 }, { unique: true });
