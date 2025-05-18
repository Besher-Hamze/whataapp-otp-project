import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { PhoneService } from './phone.service';
import { CreatePhoneDto } from './dto/create-phone.dto';

@Controller('phones')
export class PhoneController {
  constructor(private readonly phoneService: PhoneService) {}

  @Post('create')
  create(@Body() body: CreatePhoneDto) {
    return this.phoneService.create(body);
  }

  @Get()
  findAll() {
    return this.phoneService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.phoneService.findOne(id);
  }
}
