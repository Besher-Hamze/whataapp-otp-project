import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GetUserId } from 'src/common/decorators';

@Controller('groups')
@UseGuards(AuthGuard('jwt'))
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  create(@Body() createGroupDto: CreateGroupDto, @GetUserId() userId: string) {
    return this.groupsService.create(createGroupDto, userId);
  }

  @Get()
  findAll(@GetUserId() userId: string) {
    return this.groupsService.findAllGroups(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @GetUserId() userId: string) {
    return this.groupsService.findGroupById(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @GetUserId() userId: string,
  ) {
    return this.groupsService.updateGroup(id, updateGroupDto, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @GetUserId() userId: string) {
    return this.groupsService.deleteGroup(id, userId);
  }

  @Get('account/:accountId')
  findByAccount(
    @Param('accountId') accountId: string,
    @GetUserId() userId: string,
  ) {
    return this.groupsService.findByAccountId(accountId, userId);
  }
}
