//users.controller.ts
import { Controller, Post, Body, Put, Param, Delete, Get, Patch, Query, NotFoundException, ConflictException} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { CreateUserResponse } from './users.service';

@Controller('user')
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const user = await this.userService.updateUser(id, updateUserDto);
    return { success: true, user };
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string){
    await this.userService.deleteUser(id);
    return {success : true};
  }

  @Get()
  async findAllUsers(){
    const users = await this.userService.findAllUsers();
    return {success : true , users};
  }

  @Get('email/:email')
  async findUserByEmail(@Param('email') email: string) {
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      throw new NotFoundException(`User with email "${email}" not found`);
    }
    return { success: true, user };
  }

}