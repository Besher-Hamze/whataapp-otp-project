import { IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreatePhoneDto {
  @IsString()
  @IsOptional()
  readonly name?: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\d{1,15}$/, {
    message: 'Phone number must contain only digits (e.g. 123456789)',
  })
  readonly number: string;
}