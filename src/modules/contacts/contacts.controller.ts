import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetWhatsappAccountId } from 'src/common/decorators';
import { Types } from 'mongoose';

@UseGuards(JwtGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(
    @Body() createContactDto: CreateContactDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.create(createContactDto, accountId);
  }

  @Get()
  findAll(
    @GetWhatsappAccountId() accountId: string,
  ) {
    return this.contactsService.findAllContacts(accountId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.findContactById(id, accountId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.updateContact(id, updateContactDto, accountId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.deleteContact(id, accountId);
  }
  
  @Get('phone/:phoneNumber')
  findByPhoneNumber(
    @Param('phoneNumber') phoneNumber: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.findByPhoneNumber(phoneNumber, accountId);
  }
  

  @Get('group/:groupId')
  findByGroup(
    @Param('groupId') groupId: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.findByGroupId(groupId, accountId);
  }
  
  @Post('group/:groupId/add')
  addToGroup(
    @Param('groupId') groupId: string,
    @Body() body: { contactIds: string[] },
    @GetWhatsappAccountId() accountId: string
  ) {
    const contactIds = body.contactIds.map(id => new Types.ObjectId(id));
    const groupObjectId = new Types.ObjectId(groupId);
    return this.contactsService.addGroupToContacts(contactIds, groupObjectId, accountId);
  }
  
  @Post('group/:groupId/remove')
  removeFromGroup(
    @Param('groupId') groupId: string,
    @Body() body: { contactIds: string[] },
    @GetWhatsappAccountId() accountId: string
  ) {
    const contactIds = body.contactIds.map(id => new Types.ObjectId(id));
    const groupObjectId = new Types.ObjectId(groupId);
    return this.contactsService.removeGroupFromContacts(contactIds, groupObjectId, accountId);
  }
  
  @Post('tags/add')
  addTags(
    @Body() body: { contactIds: string[], tags: string[] },
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.addTagsToContacts(body.contactIds, body.tags, accountId);
  }
  
  @Post('tags/remove')
  removeTags(
    @Body() body: { contactIds: string[], tags: string[] },
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.removeTagsFromContacts(body.contactIds, body.tags, accountId);
  }
  
  @Get('tags/find')
  findByTags(
    @Query('tags') tagsString: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    const tags = tagsString.split(',').map(tag => tag.trim());
    return this.contactsService.findByTags(tags, accountId);
  }
  
  @Post('import')
  bulkImport(
    @Body() body: { contacts: CreateContactDto[] },
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.contactsService.bulkImport(body.contacts, accountId);
  }
}
