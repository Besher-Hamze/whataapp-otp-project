import { IsString, IsNotEmpty, IsArray, Validate } from 'class-validator';
import { IsValidPhoneNumbers } from 'src/validators/is-valid-phone-numbers.validator';

export class NewMessageDto {
  @IsArray({ message: 'to must be an array of phone numbers' })
  @IsNotEmpty({ message: 'to array is required and cannot be empty' })
  @Validate(IsValidPhoneNumbers, { message: 'All phone numbers in to must be valid' })
  to: string[];

  @IsString({ message: 'message must be a string' })
  @IsNotEmpty({ message: 'message is required' })
  message: string;
}
