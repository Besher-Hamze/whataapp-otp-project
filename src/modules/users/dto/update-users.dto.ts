import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-users.dto';
import { IsEnum, IsOptional } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsEnum(['user', 'admin'])
  @IsOptional()
  userRole?: 'user' | 'admin';
}
