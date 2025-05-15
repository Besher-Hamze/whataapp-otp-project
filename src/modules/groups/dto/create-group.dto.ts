import { Prop } from '@nestjs/mongoose';
import {} from 'class-validator'

export class CreateGroupDto {
    @Prop({ required: true })
      name: string;
    
    @Prop({ required: true })
      phone_numbers: string[];
    
}
