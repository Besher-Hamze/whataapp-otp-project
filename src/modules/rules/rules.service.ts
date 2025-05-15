import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Rule } from './schema/rules.schema';
import { Model } from 'mongoose';


@Injectable()
export class RulesService {
  constructor(@InjectModel(Rule.name) private ruleModel: Model<Rule>) {}
  async create(createRuleDto: CreateRuleDto) {
    const existingRule = await this.ruleModel.findOne({
          $or: [
            { keyword: createRuleDto.keyword },
          ],
    });
    
    if (existingRule) {
      throw new ConflictException('KeyWord already exists');
    }
    const newRule = await this.ruleModel.create({
      keyword: createRuleDto.keyword,
      response: createRuleDto.response,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return newRule;
  }

 async findAllRules(): Promise<Rule[]> {
    return this.ruleModel.find().exec();
  }

  async findRuleById(id: string): Promise<Rule | null> { // Changed parameter name to id
    try {
      const rule = await this.ruleModel.findById(id).exec(); // Use findById
      if (!rule) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }
      return rule;
    } catch (error) {
       if (error.name === 'CastError') {
          throw new NotFoundException(`Invalid User ID "${id}"`);
       }
       throw error;
    }
  }

  async updateRule(id: string, updateRuleDto: UpdateRuleDto): Promise<Rule | null> { // Changed parameter name to id
    // Check if the user exists
    const existingRule = await this.ruleModel.findById(id).exec();  // Use findById
    if (!existingRule) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    // Check for duplicate username or email, excluding the user being updated
     const dublicateRule = await this.ruleModel.findOne({
      $or: [
        { keyword: updateRuleDto.keyword },
      ],
      _id: { $ne: existingRule._id }, // Exclude the current user from the check, use _id
    }).exec();

    if (dublicateRule) {
        throw new ConflictException('phone number already exists');
    }

    const updatedRule = await this.ruleModel
      .findByIdAndUpdate(  // Use findByIdAndUpdate
        id,
        {
          ...updateRuleDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedRule;
  }

  async deleteRule(id: string): Promise<void> { // Changed parameter name to id
    const result = await this.ruleModel.deleteOne({ _id: id }).exec(); // Use _id
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }
}

