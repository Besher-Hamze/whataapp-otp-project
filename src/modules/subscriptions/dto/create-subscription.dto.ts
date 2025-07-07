import { IsString, IsNumber, IsBoolean, IsOptional, IsArray } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  name: string;

  @IsNumber()
  messageLimit: number;

  @IsNumber()
  durationInDays: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isCustom?: boolean;

  @IsArray()
  @IsOptional()
  features?: string[];

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
