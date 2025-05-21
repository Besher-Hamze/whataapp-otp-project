import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Rule } from './schema/rules.schema';
import { Model } from 'mongoose';

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);
  
  constructor(@InjectModel(Rule.name) private ruleModel: Model<Rule>) {}
  
  async create(createRuleDto: CreateRuleDto, userId: string) {
    // Check for duplicate keywords
    const existingRule = await this.ruleModel.findOne({
      $or: [
        { keyword: createRuleDto.keyword, user: userId },
      ],
    });
    
    if (existingRule) {
      throw new ConflictException('KeyWord already exists for this user');
    }
    
    const newRule = await this.ruleModel.create({
      keyword: createRuleDto.keyword,
      response: createRuleDto.response,
      user: userId, // Associate rule with a user
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    this.logger.log(`Created new rule with keyword "${createRuleDto.keyword}" for user ${userId}`);
    return newRule;
  }

  async findAllRules(userId: string): Promise<Rule[]> {
    return this.ruleModel.find({ user: userId }).exec();
  }

  async findRuleById(id: string, userId: string): Promise<Rule | null> {
    try {
      const rule = await this.ruleModel.findOne({ _id: id, user: userId }).exec();
      if (!rule) {
        throw new NotFoundException(`Rule with ID "${id}" not found`);
      }
      return rule;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid Rule ID "${id}"`);
      }
      throw error;
    }
  }
  
  async findRuleByKeyword(keyword: string, userId: string): Promise<Rule | null> {
    return this.ruleModel.findOne({ 
      keyword: new RegExp(`^${keyword}$`, 'i'), // Case insensitive match
      user: userId 
    }).exec();
  }
  
  /**
   * Find a matching rule for an incoming message
   * @param message The message text to match against rules
   * @param userId User ID owning the rules
   * @returns Matching rule or null if no match
   */
  async findMatchingRule(message: string, userId: string): Promise<Rule | null> {
    // Get all rules for this user
    const rules = await this.findAllRules(userId);
    
    // Simple keyword matching algorithm
    // Convert message to lowercase for case-insensitive matching
    const messageLower = message.toLowerCase().trim();
    
    // Check for exact match first
    const exactMatch = rules.find(rule => 
      messageLower === rule.keyword.toLowerCase().trim()
    );
    
    if (exactMatch) {
      return exactMatch;
    }
    
    // Then check if message contains any keywords
    return rules.find(rule => 
      messageLower.includes(rule.keyword.toLowerCase().trim())
    ) || null;
  }

  async updateRule(id: string, updateRuleDto: UpdateRuleDto, userId: string): Promise<Rule | null> {
    // Check if the rule exists and belongs to the user
    const existingRule = await this.findRuleById(id, userId);
    
    if (!existingRule) {
      throw new NotFoundException(`Rule with ID "${id}" not found or does not belong to user`);
    }

    // If keyword is being updated, check for duplicates
    if (updateRuleDto.keyword) {
      const duplicateRule = await this.ruleModel.findOne({
        keyword: updateRuleDto.keyword,
        user: userId,
        _id: { $ne: id }, // Use the id parameter instead of existingRule._id
      }).exec();

      if (duplicateRule) {
        throw new ConflictException('Keyword already exists for this user');
      }
    }

    const updatedRule = await this.ruleModel
      .findByIdAndUpdate(
        id,
        {
          ...updateRuleDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
      
    this.logger.log(`Updated rule ${id} for user ${userId}`);
    return updatedRule;
  }

  async deleteRule(id: string, userId: string): Promise<void> {
    // Verify the rule exists and belongs to the user
    await this.findRuleById(id, userId);
    
    const result = await this.ruleModel.deleteOne({ _id: id, user: userId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Rule with ID "${id}" not found`);
    }
    
    this.logger.log(`Deleted rule ${id} for user ${userId}`);
  }
}
