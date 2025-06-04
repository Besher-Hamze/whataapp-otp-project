import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsDateString()
  send_date?: Date;

  @IsString()
  @IsNotEmpty()
  client: string;

  @IsOptional()
  @IsEnum(['pending', 'sent', 'failed'])
  status?: 'pending' | 'sent' | 'failed';
}
