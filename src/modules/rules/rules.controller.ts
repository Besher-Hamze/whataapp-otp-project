import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import {GetWhatsappAccountId} from 'src/common/decorators';

@UseGuards(JwtGuard)
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Post()
  create(
    @Body() createRuleDto: CreateRuleDto[],
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.rulesService.create(createRuleDto, accountId);
  }

  @Get()
  findAll(@GetWhatsappAccountId() accountId: string) {
    return this.rulesService.findAllRules(accountId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.rulesService.findRuleById(id, accountId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string, 
    @Body() updateRuleDto: UpdateRuleDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.rulesService.updateRule(id, updateRuleDto, accountId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.rulesService.deleteRule(id, accountId);
  }
  
  @Get('match/:keyword')
  findByKeyword(
    @Param('keyword') keyword: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.rulesService.findRuleByKeyword(keyword, accountId);
  }
}
