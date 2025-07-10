import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { UserSubscriptionsService } from './user-subscriptions.service';
import { CreateUserSubscriptionDto } from './dto/create-user-subscription.dto';

@Controller('request')
export class UserSubscriptionsController {
  constructor(private readonly service: UserSubscriptionsService) {}

  @Post()
  create(@Body() dto: CreateUserSubscriptionDto) {
    return this.service.create(dto);
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
