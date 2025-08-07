import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { UserSubscriptionsService } from './user-subscriptions.service';
import { GetUserId } from 'src/common/decorators';

@Controller('request')
export class UserSubscriptionsController {
  constructor(private readonly service: UserSubscriptionsService) {}

  @Post(":id")
  create(@Param("id") id:string ,@GetUserId() userId) {
    return this.service.create(id , userId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('pending')
  findPending() {
    return this.service.findPending();
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
