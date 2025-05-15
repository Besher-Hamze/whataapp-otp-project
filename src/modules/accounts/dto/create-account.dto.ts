import { Prop } from '@nestjs/mongoose';
import { IsNotEmpty, IsString } from 'class-validator'

export class CreateAccountDto {
  @IsNotEmpty()
  @IsString()
  name: string;
    
  @IsNotEmpty()
  @IsString()
  phone_number: string;

  @IsNotEmpty()
  @IsString()
  user: string;
}
