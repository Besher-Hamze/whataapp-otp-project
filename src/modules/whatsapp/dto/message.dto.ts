import { IsString, IsNotEmpty, IsArray, Validate, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { IsValidPhoneNumbers } from 'src/validators/is-valid-phone-numbers.validator';
import { Type } from 'class-transformer';

export class NewMessageDto {
  @IsArray({ message: 'to must be an array of phone numbers' })
  @IsNotEmpty({ message: 'to array is required and cannot be empty' })
  @Validate(IsValidPhoneNumbers, { message: 'All phone numbers in to must be valid' })
  to: string[];

  @IsString({ message: 'message must be a string' })
  @IsNotEmpty({ message: 'message is required' })
  message: string;
  
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1000, { message: 'Delay must be at least 1000ms (1 second)' })
  @Max(60000, { message: 'Delay cannot exceed 60000ms (60 seconds)' })
  delay?: number;
}
