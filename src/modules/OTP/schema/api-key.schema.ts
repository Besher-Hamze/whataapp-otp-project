import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class ApiKey extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ default: true })
  isActive: boolean;

}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);