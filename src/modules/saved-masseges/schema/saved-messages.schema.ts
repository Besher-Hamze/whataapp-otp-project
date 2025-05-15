import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class SavedMessage extends Document {
  @Prop({ required: true })
  content: string;
}

export const SavedMessageSchema = SchemaFactory.createForClass(SavedMessage);