import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Rule, RuleDocument } from './schema/rules.schema';
import { Model } from 'mongoose';

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @InjectModel(Rule.name)
    private ruleModel: Model<RuleDocument>, // ✅ This is critical
  ) { }


  async create(createRuleDtos: CreateRuleDto[], accountId: string) {
    const newRules: Partial<Rule>[] = [];


    for (const dto of createRuleDtos) {
      const exists = await this.ruleModel.findOne({
        keywords: { $in: dto.keywords },
        account: accountId,
      });

      if (!exists) {
        newRules.push({
          ...dto,
          account: accountId,
        });
      }
    }

    if (newRules.length > 0) {
      await this.ruleModel.insertMany(newRules as Rule[]);
    }

    const replies = await this.findAllRules(accountId);

    return replies;

  }


  async findAllRules(accountId: string): Promise<Rule[]> {
    return this.ruleModel.find({ account: accountId }).exec();
  }

  async findRuleById(id: string, accountId: string): Promise<Rule | null> {
    try {
      const rule = await this.ruleModel.findOne({ _id: id, account: accountId }).exec();
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

  async findRuleByKeyword(keyword: string, accountId: string): Promise<Rule | null> {
    return this.ruleModel.findOne({
      keywords: keyword,
      user: accountId
    }).exec();
  }

  /**
   * Find a matching rule for an incoming message
   * @param message The message text to match against rules
   * @param accountId User ID owning the rules
   * @returns Matching rule or null if no match
   */
  async findMatchingRule(message: string, accountId: string): Promise<Rule | null> {
    // Get all rules for this user
    const rules = await this.findAllRules(accountId);

    // Simple keyword matching algorithm
    // Convert message to lowercase for case-insensitive matching
    const messageLower = message.toLowerCase().trim();

    // Check for exact match first
    const exactMatch = rules.find(rule =>
      rule.keywords.some(k => messageLower === k.toLowerCase().trim()) // Updated to check keywords array
    );

    if (exactMatch) {
      return exactMatch;
    }

    // Then check if message contains any keywords
    return rules.find(rule =>
      rule.keywords.some(k => messageLower.includes(k.toLowerCase().trim())) // Updated to check keywords array
    ) || null;
  }

  async updateRule(id: string, updateRuleDto: UpdateRuleDto, accountId: string): Promise<Rule | null> {
    // Check if the rule exists and belongs to the account
    const existingRule = await this.findRuleById(id, accountId);

    if (!existingRule) {
      throw new NotFoundException(`Rule with ID "${id}" not found or does not belong to account`);
    }

    // If keywords are being updated, check for duplicates
    if (updateRuleDto.keywords) {
      const duplicateRule = await this.ruleModel.findOne({
        keywords: { $in: updateRuleDto.keywords },
        account: accountId, // ✅ FIXED
        _id: { $ne: id },
      }).exec();

      if (duplicateRule) {
        throw new ConflictException('One or more keywords already exist for this account');
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

    this.logger.log(`Updated rule ${id} for account ${accountId}`);
    return updatedRule;
  }


  async deleteRule(id: string, accountId: string): Promise<void> {
    // Verify the rule exists and belongs to the account
    await this.findRuleById(id, accountId);

    const result = await this.ruleModel.deleteOne({ _id: id, account: accountId }).exec(); // ✅ FIXED

    if (result.deletedCount === 0) {
      throw new NotFoundException(`Rule with ID "${id}" not found`);
    }

    this.logger.log(`Deleted rule ${id} for account ${accountId}`);
  }

}