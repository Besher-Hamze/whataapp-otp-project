import { IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreatePhoneDto {
  @IsString()
  @IsOptional()
  readonly name?: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+\d{1,15}$/, {
    message:
      'Phone number must start with "+" followed by digits (e.g. +123456789)',
  })
  readonly number: string;
}
