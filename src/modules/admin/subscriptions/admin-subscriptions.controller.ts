import { Controller, Get, Post, Patch, Body, Param, UseGuards, Delete } from '@nestjs/common';
import { SubscriptionsService } from 'src/modules/subscriptions/subscriptions.service';
import { UserSubscriptionsService } from 'src/modules/user-subscriptions/user-subscriptions.service';
import { UsersService } from 'src/modules/users/users.service';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators';
import { CreateSubscriptionDto } from 'src/modules/subscriptions/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from 'src/modules/subscriptions/dto/update-subscription.dto';

@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly userSubscriptionsService: UserSubscriptionsService,
    private readonly usersService: UsersService
  ) {}

  // Subscription plans
  @Get()
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Delete(':id')
  deletePlan(@Param('id') id: string) {
    return this.subscriptionsService.delete(id);
  }

  @Patch(':id/deactivate')
  deactivatePlan(@Param('id') id: string) {
    return this.subscriptionsService.deactivate(id);
  }

  // User subscription requests
  @Get('requests')
  findAllRequests() {
    return this.userSubscriptionsService.findAll();
  }

  @Get('requests/pending')
  findPendingRequests() {
    return this.userSubscriptionsService.findPending();
  }

  @Patch('requests/:id/approve')
  approve(@Param('id') id: string) {
    return this.userSubscriptionsService.approve(id);
  }
@Patch('requests/:id/disapprove')
disapproveSubscriptionRequest(@Param('id') requestId: string) {
  return this.userSubscriptionsService.disapprove(requestId);
}

  @Delete('requests/:id')
  deleteRequest(@Param('id') id: string) {
    return this.userSubscriptionsService.delete(id);
  }

  // Users
  @Get('/users')
  findAllUsers() {
    return this.usersService.findAllUsers();
  }

  @Get('/users/:id')
  findUserById(@Param('id') id: string) {
    return this.usersService.findUserById(id);
  }
}