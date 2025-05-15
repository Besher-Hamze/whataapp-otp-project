import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Group } from './schema/groups.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class GroupsService {
constructor(@InjectModel(Group.name) private groupModel: Model<Group>) {}
  async create(createGroupDto: CreateGroupDto) {
    const newGroup = await this.groupModel.create({
      name: createGroupDto.name,
      phone_numbers: createGroupDto.phone_numbers,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return newGroup;
  }

 async findAllGroups(): Promise<Group[]> {
    return this.groupModel.find().exec();
  }

  async findGroupById(id: string): Promise<Group | null> { // Changed parameter name to id
    try {
      const Group = await this.groupModel.findById(id).exec(); // Use findById
      if (!Group) {
        throw new NotFoundException(`Group with ID "${id}" not found`);
      }
      return Group;
    } catch (error) {
       if (error.name === 'CastError') {
          throw new NotFoundException(`Invalid Group ID "${id}"`);
       }
       throw error;
    }
  }

  async findGroupByEmail(email: string): Promise<Group | null> {
    return this.groupModel.findOne({ email }).exec();
  }

  async updateGroup(id: string, updateGroupDto: UpdateGroupDto): Promise<Group | null> { // Changed parameter name to id
    // Check if the Group exists
    const existingGroup = await this.groupModel.findById(id).exec();  // Use findById
    if (!existingGroup) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
    }

    const updatedGroup = await this.groupModel
      .findByIdAndUpdate(  // Use findByIdAndUpdate
        id,
        {
          ...updateGroupDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedGroup;
  }

  async deleteGroup(id: string): Promise<void> { // Changed parameter name to id
    const result = await this.groupModel.deleteOne({ _id: id }).exec(); // Use _id
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
    }
  }
}


