import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Template, TemplateDocument, TemplateType } from './schema/template.schema';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { RenderTemplateDto } from './dto/render-template.dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectModel(Template.name) private templateModel: Model<TemplateDocument>,
  ) {}

  /**
   * Create a new message template
   * @param createTemplateDto Template data
   * @param accountId Account ID
   * @returns Created template
   */
  async create(createTemplateDto: CreateTemplateDto, accountId: string): Promise<TemplateDocument> {
    // Check if template with same name already exists for this account
    const existingTemplate = await this.templateModel.findOne({
      name: createTemplateDto.name,
      account: accountId,
    });

    if (existingTemplate) {
      throw new ConflictException(`Template with name "${createTemplateDto.name}" already exists`);
    }

    // Extract variables from content {{variableName}}
    const variables = this.extractVariables(createTemplateDto.content);
    
    // Create the template
    const newTemplate = await this.templateModel.create({
      ...createTemplateDto,
      account: accountId,
      variables: Object.fromEntries(variables.map(v => [v, ''])),
    });

    this.logger.log(`Created new template: ${newTemplate.name} for account ${accountId}`);
    return newTemplate;
  }

  /**
   * Get all templates for a account with optional filtering
   * @param accountId Account ID
   * @param type Optional template type filter
   * @param search Optional search term 
   * @param skip Number of records to skip (pagination)
   * @param limit Max number of records to return
   * @returns Paginated templates list
   */
  async findAll(
    accountId: string,
    type?: TemplateType,
    search?: string,
    skip: number = 0,
    limit: number = 50
  ): Promise<{ templates: TemplateDocument[], total: number }> {
    // Build query
    const query: any = { account: accountId };
    
    if (type) {
      query.type = type;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
      ];
      
      // If search is a single word, also check tags
      if (!search.includes(' ')) {
        query.$or.push({ tags: { $regex: search, $options: 'i' } });
      }
    }
    
    // Get total count
    const total = await this.templateModel.countDocuments(query);
    
    // Get paginated results
    const templates = await this.templateModel.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .exec();
    
    return { templates, total };
  }

  /**
   * Find template by ID
   * @param id Template ID
   * @param accountId Account ID
   * @returns Template or throws if not found
   */
  async findById(id: string, accountId: string): Promise<TemplateDocument> {
    const template = await this.templateModel.findOne({
      _id: id,
      account: accountId,
    }).exec();
    
    if (!template) {
      throw new NotFoundException(`Template with ID "${id}" not found or does not belong to account`);
    }
    
    return template;
  }

  /**
   * Update a template
   * @param id Template ID
   * @param updateTemplateDto Updated template data
   * @param accountId Account ID
   * @returns Updated template
   */
  async update(id: string, updateTemplateDto: UpdateTemplateDto, accountId: string): Promise<TemplateDocument> {
    // Check if template exists and belongs to account
    const template = await this.findById(id, accountId);
    
    if (!template) {
      throw new NotFoundException(`Template with ID "${id}" not found or does not belong to account`);
    }
    
    // If updating name, check for duplicates
    if (updateTemplateDto.name && updateTemplateDto.name !== template.name) {
      const existingTemplate = await this.templateModel.findOne({
        name: updateTemplateDto.name,
        account: accountId,
        _id: { $ne: id },
      });
      
      if (existingTemplate) {
        throw new ConflictException(`Template with name "${updateTemplateDto.name}" already exists`);
      }
    }
    
    // If updating content, extract new variables
    if (updateTemplateDto.content) {
      const newVariables = this.extractVariables(updateTemplateDto.content);
      
      // Merge existing variables with new ones
      const existingVars = template.variables || {};
      const updatedVars = {};
      
      // Keep existing values for variables that still exist
      newVariables.forEach(varName => {
        updatedVars[varName] = existingVars[varName] || '';
      });
      
      updateTemplateDto.variables = updatedVars;
    }
    
    // Update the template
    const updatedTemplate = await this.templateModel.findByIdAndUpdate(
      id,
      updateTemplateDto,
      { new: true }
    ).exec();
    
    if (!updatedTemplate) {
      throw new NotFoundException(`Template with ID "${id}" not found after update attempt`);
    }
    
    this.logger.log(`Updated template ${id} for account ${accountId}`);
    return updatedTemplate;
  }

  /**
   * Delete a template
   * @param id Template ID
   * @param accountId Account ID
   */
  async delete(id: string, accountId: string): Promise<void> {
    // Check if template exists and belongs to account
    await this.findById(id, accountId);
    
    await this.templateModel.deleteOne({
      _id: id,
      account: accountId,
    }).exec();
    
    this.logger.log(`Deleted template ${id} for account ${accountId}`);
  }

  /**
   * Render a template by replacing variables with values
   * @param renderDto Template and variables data
   * @param accountId Account ID
   * @returns Rendered template text
   */
  async renderTemplate(renderDto: RenderTemplateDto, accountId: string): Promise<string> {
    // Get the template
    const template = await this.findById(renderDto.templateId, accountId);
    
    // Get the content and variables to replace
    const content = template.content;
    const variables = renderDto.variables || {};
    
    // Replace all variables in the template
    let renderedContent = content;
    
    // Replace {{variableName}} with the value from variables
    const variableRegex = /\{\{([^}]+)\}\}/g;
    renderedContent = renderedContent.replace(variableRegex, (match, variableName) => {
      const value = variables[variableName.trim()];
      return value !== undefined ? value : match; // Keep the placeholder if no value provided
    });
    
    // Update usage count and last used date
    await this.templateModel.updateOne(
      { _id: template._id },
      { 
        $inc: { usageCount: 1 },
        $set: { lastUsed: new Date() }
      }
    ).exec();
    
    return renderedContent;
  }

  /**
   * Create default templates for a new account
   * @param accountId Account ID
   */
  async createDefaultTemplates(accountId: string): Promise<void> {
    const defaultTemplates = [
      {
        name: 'Welcome Message',
        content: 'Hello {{name}}, thank you for reaching out to us! How can we help you today?',
        type: TemplateType.WELCOME,
        isDefault: true,
        tags: ['welcome', 'greeting'],
      },
      {
        name: 'Follow-up',
        content: 'Hi {{name}}, I wanted to follow up on our conversation regarding {{topic}}. Do you have any questions?',
        type: TemplateType.CUSTOM,
        isDefault: true,
        tags: ['follow-up'],
      },
      {
        name: 'Appointment Reminder',
        content: 'Reminder: You have an appointment on {{date}} at {{time}}. Please let us know if you need to reschedule.',
        type: TemplateType.REMINDER,
        isDefault: true,
        tags: ['appointment', 'reminder'],
      },
      {
        name: 'Marketing Promotion',
        content: 'Special offer for you, {{name}}! {{promotion_details}} Use code {{promo_code}} to get your discount.',
        type: TemplateType.MARKETING,
        isDefault: true,
        tags: ['marketing', 'promotion'],
      },
    ];
    
    for (const template of defaultTemplates) {
      try {
        // Check if template already exists
        const exists = await this.templateModel.findOne({
          name: template.name,
          account: accountId,
        });
        
        if (!exists) {
          await this.create(template as CreateTemplateDto, accountId);
        }
      } catch (error) {
        this.logger.error(`Failed to create default template "${template.name}": ${error.message}`);
      }
    }
    
    this.logger.log(`Created default templates for account ${accountId}`);
  }
  
  /**
   * Find templates by tags
   * @param tags Tags to search for
   * @param accountId Account ID
   * @returns Templates matching the tags
   */
  async findByTags(tags: string[], accountId: string): Promise<TemplateDocument[]> {
    return this.templateModel.find({
      tags: { $in: tags },
      account: accountId,
    }).exec();
  }
  
  /**
   * Get template usage statistics
   * @param accountId Account ID
   * @returns Template usage stats
   */
  async getUsageStats(accountId: string): Promise<any> {
    const stats = await this.templateModel.aggregate([
      { $match: { account: accountId } },
      { $sort: { usageCount: -1 } },
      {
        $group: {
          _id: '$type',
          templates: { $push: { id: '$_id', name: '$name', usageCount: '$usageCount' } },
          totalUsage: { $sum: '$usageCount' },
          count: { $sum: 1 },
        }
      },
      { $sort: { totalUsage: -1 } }
    ]).exec();
    
    return stats;
  }

  /**
   * Extract variable names from template content
   * @param content Template content with {{variableName}} placeholders
   * @returns Array of variable names
   */
  private extractVariables(content: string): string[] {
    const variableRegex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    
    let match;
    while ((match = variableRegex.exec(content)) !== null) {
      variables.add(match[1].trim());
    }
    
    return Array.from(variables);
  }
}
