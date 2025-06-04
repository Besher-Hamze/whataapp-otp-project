import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { RenderTemplateDto } from './dto/render-template.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetWhatsappAccountId } from 'src/common/decorators';
import { TemplateType } from './schema/template.schema';

@UseGuards(JwtGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  create(
    @Body() createTemplateDto: CreateTemplateDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.create(createTemplateDto, accountId);
  }

  @Get()
  findAll(
    @GetWhatsappAccountId() accountId: string,
    @Query('type') type?: TemplateType,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50
  ) {
    const skip = (page - 1) * limit;
    return this.templatesService.findAll(accountId, type, search, skip, limit);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.findById(id, accountId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.update(id, updateTemplateDto, accountId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.delete(id, accountId);
  }
  
  @Post('render')
  renderTemplate(
    @Body() renderDto: RenderTemplateDto,
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.renderTemplate(renderDto, accountId);
  }
  
  @Get('tags/:tags')
  findByTags(
    @Param('tags') tagsParam: string,
    @GetWhatsappAccountId() accountId: string
  ) {
    const tags = tagsParam.split(',').map(tag => tag.trim());
    return this.templatesService.findByTags(tags, accountId);
  }
  
  @Get('stats/usage')
  getUsageStats(
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.getUsageStats(accountId);
  }
  
  @Post('default')
  createDefaultTemplates(
    @GetWhatsappAccountId() accountId: string
  ) {
    return this.templatesService.createDefaultTemplates(accountId);
  }
}
