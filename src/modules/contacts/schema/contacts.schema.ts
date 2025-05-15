import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Contact extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phone_number: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Account' })
  account: string;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);