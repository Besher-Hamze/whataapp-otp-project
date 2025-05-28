import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schema/users.schema';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Contact {

  _id: Types.ObjectId;
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone_number: string;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }], default: [] })
  groups: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Account', required: true })
  account: Types.ObjectId;


  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Date })
  last_contacted: Date;

  @Prop({ default: '' })
  notes: string;

  @Prop({ default: false })
  starred: boolean;
}

export type ContactDocument = Contact & Document;
export const ContactSchema = SchemaFactory.createForClass(Contact);

// Unique index per account, remove user
ContactSchema.index({ phone_number: 1, account: 1 }, { unique: true });
// Text index for search
ContactSchema.index({ name: 'text', phone_number: 'text', tags: 'text' });