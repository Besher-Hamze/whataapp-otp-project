import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Account } from 'src/modules/accounts/schema/account.schema';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Rule extends Document {
  @Prop({ type: [String], required: true })
  keywords: [String];

  @Prop({ required: true })
  response: string;
  
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'account', required: true })
  account: Account | string;
}

export type RuleDocument = Rule & Document;
export const RuleSchema = SchemaFactory.createForClass(Rule);