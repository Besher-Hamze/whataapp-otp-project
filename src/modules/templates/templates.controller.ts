import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { RenderTemplateDto } from './dto/render-template.dto';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId } from 'src/common/decorators';
import { TemplateType } from './schema/template.schema';

@UseGuards(JwtGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  create(
    @Body() createTemplateDto: CreateTemplateDto,
    @GetUserId() userId: string
  ) {
    return this.templatesService.create(createTemplateDto, userId);
  }

  @Get()
  findAll(
    @GetUserId() userId: string,
    @Query('type') type?: TemplateType,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50
  ) {
    const skip = (page - 1) * limit;
    return this.templatesService.findAll(userId, type, search, skip, limit);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.templatesService.findById(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @GetUserId() userId: string
  ) {
    return this.templatesService.update(id, updateTemplateDto, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    return this.templatesService.delete(id, userId);
  }
  
  @Post('render')
  renderTemplate(
    @Body() renderDto: RenderTemplateDto,
    @GetUserId() userId: string
  ) {
    return this.templatesService.renderTemplate(renderDto, userId);
  }
  
  @Get('tags/:tags')
  findByTags(
    @Param('tags') tagsParam: string,
    @GetUserId() userId: string
  ) {
    const tags = tagsParam.split(',').map(tag => tag.trim());
    return this.templatesService.findByTags(tags, userId);
  }
  
  @Get('stats/usage')
  getUsageStats(
    @GetUserId() userId: string
  ) {
    return this.templatesService.getUsageStats(userId);
  }
  
  @Post('default')
  createDefaultTemplates(
    @GetUserId() userId: string
  ) {
    return this.templatesService.createDefaultTemplates(userId);
  }
}
