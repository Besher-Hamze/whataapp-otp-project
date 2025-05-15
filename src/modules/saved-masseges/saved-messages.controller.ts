import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SavedMessagesService } from './saved-messages.service';
import { CreateSavedMessageDto } from './dto/create-saved-massege.dto';
import { UpdateSavedMessageDto } from './dto/update-saved-massege.dto';

@Controller('saved-messages')
export class SavedmessagesController {
  constructor(private readonly SavedMessagesService: SavedMessagesService) {}

  @Post()
  create(@Body() createSavedMassegeDto: CreateSavedMessageDto) {
    return this.SavedMessagesService.create(createSavedMassegeDto);
  }

  @Get()
  findAll() {
    return this.SavedMessagesService.findAllSavedMessagess();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.SavedMessagesService.findSavedMessagesById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSavedMessageDto: UpdateSavedMessageDto) {
    return this.SavedMessagesService.updateSavedMessages(id, updateSavedMessageDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.SavedMessagesService.deleteSavedMessages(id);
  }
}
