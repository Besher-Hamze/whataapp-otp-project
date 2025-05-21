import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId } from 'src/common/decorators';
import { Types } from 'mongoose';

@UseGuards(JwtGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(
    @Body() createContactDto: CreateContactDto,
    @GetUserId() userId: string
  ) {
    return this.contactsService.create(createContactDto, userId);
  }

  @Get()
  findAll(
    @GetUserId() userId: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50
  ) {
    const skip = (page - 1) * limit;
    return this.contactsService.findAllContacts(userId, search, skip, limit);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.contactsService.findContactById(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
    @GetUserId() userId: string
  ) {
    return this.contactsService.updateContact(id, updateContactDto, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.contactsService.deleteContact(id, userId);
  }
  
  @Get('phone/:phoneNumber')
  findByPhoneNumber(
    @Param('phoneNumber') phoneNumber: string,
    @GetUserId() userId: string
  ) {
    return this.contactsService.findByPhoneNumber(phoneNumber, userId);
  }
  
  @Get('account/:accountId')
  findByAccount(
    @Param('accountId') accountId: string,
    @GetUserId() userId: string
  ) {
    return this.contactsService.findByAccountId(accountId, userId);
  }
  
  @Get('group/:groupId')
  findByGroup(
    @Param('groupId') groupId: string,
    @GetUserId() userId: string
  ) {
    return this.contactsService.findByGroupId(groupId, userId);
  }
  
  @Post('group/:groupId/add')
  addToGroup(
    @Param('groupId') groupId: string,
    @Body() body: { contactIds: string[] },
    @GetUserId() userId: string
  ) {
    const contactIds = body.contactIds.map(id => new Types.ObjectId(id));
    const groupObjectId = new Types.ObjectId(groupId);
    return this.contactsService.addGroupToContacts(contactIds, groupObjectId, userId);
  }
  
  @Post('group/:groupId/remove')
  removeFromGroup(
    @Param('groupId') groupId: string,
    @Body() body: { contactIds: string[] },
    @GetUserId() userId: string
  ) {
    const contactIds = body.contactIds.map(id => new Types.ObjectId(id));
    const groupObjectId = new Types.ObjectId(groupId);
    return this.contactsService.removeGroupFromContacts(contactIds, groupObjectId, userId);
  }
  
  @Post('tags/add')
  addTags(
    @Body() body: { contactIds: string[], tags: string[] },
    @GetUserId() userId: string
  ) {
    return this.contactsService.addTagsToContacts(body.contactIds, body.tags, userId);
  }
  
  @Post('tags/remove')
  removeTags(
    @Body() body: { contactIds: string[], tags: string[] },
    @GetUserId() userId: string
  ) {
    return this.contactsService.removeTagsFromContacts(body.contactIds, body.tags, userId);
  }
  
  @Get('tags/find')
  findByTags(
    @Query('tags') tagsString: string,
    @GetUserId() userId: string
  ) {
    const tags = tagsString.split(',').map(tag => tag.trim());
    return this.contactsService.findByTags(tags, userId);
  }
  
  @Post('import')
  bulkImport(
    @Body() body: { contacts: CreateContactDto[] },
    @GetUserId() userId: string
  ) {
    return this.contactsService.bulkImport(body.contacts, userId);
  }
}
