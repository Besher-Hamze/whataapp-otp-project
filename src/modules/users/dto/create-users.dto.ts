import { IsEmail, IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsOptional()
  phone_number?: string;

  @IsEnum(['user', 'admin'])
  @IsOptional()
  userRole?: 'user' | 'admin'; // Optional — defaults to 'user'
}
