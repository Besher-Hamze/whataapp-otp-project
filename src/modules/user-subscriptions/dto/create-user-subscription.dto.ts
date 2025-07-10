import { IsMongoId, IsString, IsNumber, IsBoolean, IsArray, IsOptional } from 'class-validator';

export class CreateUserSubscriptionDto {
  @IsMongoId()
  user: string;

  @IsString()
  name: string;

  @IsNumber()
  messageLimit: number;

  @IsNumber()
  durationInDays: number;

  @IsArray()
  @IsString({ each: true })
  features: string[];

  @IsBoolean()
  @IsOptional()
  isCustom?: boolean;

  @IsNumber()
  @IsOptional()
  price?: number;
}
