import { IsString, IsNotEmpty, IsArray, IsDate, IsMongoId, IsOptional, IsNumber, Min, Max, Validate } from 'class-validator';
import { Type } from 'class-transformer';
import { IsValidPhoneNumbers } from 'src/validators/is-valid-phone-numbers.validator';

export class CreateScheduleDto {
  @IsString({ message: 'Message must be a string' })
  @IsNotEmpty({ message: 'Message is required' })
  message: string;

  @IsArray({ message: 'Recipients must be an array of phone numbers' })
  @IsNotEmpty({ message: 'Recipients list is required and cannot be empty' })
  @Validate(IsValidPhoneNumbers, { message: 'All phone numbers in recipients must be valid' })
  recipients: string[];

  @IsDate({ message: 'Scheduled time must be a valid date' })
  @Type(() => Date)
  scheduledTime: Date;

  @IsMongoId({ message: 'WhatsApp account ID must be a valid MongoDB ID' })
  whatsappAccountId: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1000, { message: 'Message delay must be at least 1000ms (1 second)' })
  @Max(60000, { message: 'Message delay cannot exceed 60000ms (1 minute)' })
  messageDelayMs?: number;
}