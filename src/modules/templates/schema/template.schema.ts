import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Account } from 'src/modules/accounts/schema/account.schema';

export enum TemplateType {
  TEXT = 'text',
  WELCOME = 'welcome',
  REMINDER = 'reminder',
  MARKETING = 'marketing',
  CUSTOM = 'custom',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Template {
  @Prop({ required: true })
  name: string;
  
  @Prop({ required: true })
  content: string;
  
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account', required: true })
  account: Account;
  
  @Prop({ default: false })
  isDefault: boolean;
  
  @Prop({ type: Object, default: {} })
  variables: Record<string, string>;
  
  @Prop({ default: 0 })
  usageCount: number;
  
  @Prop({ type: Date })
  lastUsed: Date;
}

export type TemplateDocument = Template & Document;
export const TemplateSchema = SchemaFactory.createForClass(Template);

// Create index for searching
TemplateSchema.index({ name: 'text', content: 'text', tags: 'text' });
