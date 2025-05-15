import { Prop } from '@nestjs/mongoose';
import { IsString } from 'class-validator'

export class CreateContactDto {
    @Prop({ required: true })
      name: string;
    
    @Prop({ required: true })
      phone_number: string;
    
      @IsString()
      account: string;
}
