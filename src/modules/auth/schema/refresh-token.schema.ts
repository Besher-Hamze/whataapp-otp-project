import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Token extends Document {
  @Prop({ type: String, required: true, index: true })
  userId: string;

  @Prop({ type: String, required: true })
  token: string;

  @Prop({ type: String, enum: ['access', 'refresh'], required: true })
  type: 'access' | 'refresh';

  @Prop({ type: String })
  accountId?: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const TokenSchema = SchemaFactory.createForClass(Token);