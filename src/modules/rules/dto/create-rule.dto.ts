import { Prop } from '@nestjs/mongoose';
import {} from 'class-validator'

export class CreateRuleDto {
    
    @Prop({ required: true })
      keyword: string;

    @Prop({ required: true })
      response: string;
}
