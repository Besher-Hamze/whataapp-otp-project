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
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GetWhatsappAccountId } from 'src/common/decorators';
import { JwtGuard } from 'src/common/guards/jwt.guard';

@UseGuards(JwtGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) { }

  @Post()
  create(@Body() createGroupDto: CreateGroupDto,
    @GetWhatsappAccountId() accountId: string
) {
    return this.groupsService.create(createGroupDto, accountId);
  }

  @Get()
  findAll(@GetWhatsappAccountId() accountId: string) {
    return this.groupsService.findAllGroups(accountId);
  }

   @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.groupsService.findGroupById(id, accountId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGroupDto: UpdateGroupDto, @GetWhatsappAccountId() accountId: string) {
    return this.groupsService.updateGroup(id, updateGroupDto, accountId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @GetWhatsappAccountId() accountId: string) {
    return this.groupsService.deleteGroup(id, accountId);
  }

}
