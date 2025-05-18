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
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId } from 'src/common/decorators/intex';

// @UseGuards(JwtGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(
    @Body() createContactDto: CreateContactDto,
    @GetUserId() userId: string,
  ) {
    return this.contactsService.create(createContactDto);
  }

  @Get()
  findAll(@GetUserId() userId: string) {
    console.log(userId);
    return this.contactsService.findAllContacts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactsService.findContactById(id);
  }

  @Get('account/:accountId')
  findByAccount(@Param('accountId') accountId: string) {
    return this.contactsService.findByAccountId(accountId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateContactDto: UpdateContactDto) {
    return this.contactsService.updateContact(id, updateContactDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contactsService.deleteContact(id);
  }
}
