import { IsString, IsEmail, IsNotEmpty, MinLength, Matches } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d{10,15}$/, { message: 'phone_number must start with + followed by 10 to 15 digits' })
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}