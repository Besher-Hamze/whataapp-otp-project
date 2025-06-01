import { Controller, Get, Post, Body, Patch, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { GetUserId } from 'src/common/decorators';
import { JwtGuard } from 'src/common/guards/jwt.guard';

@UseGuards(JwtGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService,
  ) {}

  @Post()
  create(@Body() createAccountDto: CreateAccountDto) {
    return this.accountsService.create(createAccountDto);
  }

  @Get('get-available-accounts')
  async getAccountsByUser(@GetUserId() userId: string) {
    return await this.accountsService.findAccountsByUser(userId);
  }

  @Get()
  findAll() {
    return this.accountsService.findAllAccounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accountsService.findAccountById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateAccountDto: UpdateAccountDto) {
    return this.accountsService.updateAccount(id, updateAccountDto);
  }

}
