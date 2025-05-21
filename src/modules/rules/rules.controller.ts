import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId } from 'src/common/decorators';

@UseGuards(JwtGuard)
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Post()
  create(
    @Body() createRuleDto: CreateRuleDto,
    @GetUserId() userId: string
  ) {
    return this.rulesService.create(createRuleDto, userId);
  }

  @Get()
  findAll(@GetUserId() userId: string) {
    return this.rulesService.findAllRules(userId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.rulesService.findRuleById(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string, 
    @Body() updateRuleDto: UpdateRuleDto,
    @GetUserId() userId: string
  ) {
    return this.rulesService.updateRule(id, updateRuleDto, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.rulesService.deleteRule(id, userId);
  }
  
  @Get('match/:keyword')
  findByKeyword(
    @Param('keyword') keyword: string,
    @GetUserId() userId: string
  ) {
    return this.rulesService.findRuleByKeyword(keyword, userId);
  }
}
