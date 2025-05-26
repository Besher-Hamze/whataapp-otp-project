import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Group } from './schema/groups.schema';
import { Model, Types, HydratedDocument } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { PhoneService } from '../phone/phone.service';
import { ContactsService } from '../contacts/contacts.service';
import { Contact } from '../contacts/schema/contacts.schema';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(Group.name) private groupModel: Model<Group>,
    private readonly phoneService: PhoneService,
    private readonly contactsService: ContactsService,
  ) { }

  async create(createGroupDto: CreateGroupDto, userId: string, accountId: string) {
    const contactIds: Types.ObjectId[] = [];
    if (!userId) {
      this.logger.error('User ID is required to create a group');
      throw new Error('User ID is required');
    }

    for (const contact of createGroupDto.phone_numbers) {
      const { phone_number, name } = contact;

      let existingContact =
        await this.contactsService.findByPhoneNumber(phone_number, userId);

      // create if not exist
      if (!existingContact) {
        existingContact = await this.contactsService.create({
          name,
          phone_number,
          account: createGroupDto.account,
        }, userId);
      }

      // Make sure contact exists before adding to group
      if (existingContact && existingContact._id) {
        contactIds.push(existingContact._id);
      }

      const existsInPhone = await this.phoneService.findByNumber(phone_number);
      if (!existsInPhone) {
        await this.phoneService.create({
          number: phone_number,
          user: userId
        });
      }
    }

    const groupDoc = new this.groupModel({
      name: createGroupDto.name,
      contacts: contactIds,
      account: createGroupDto.account,
      user: userId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const newGroup: HydratedDocument<Group> = await groupDoc.save();

    if (newGroup._id && contactIds.length > 0) {
      // Add group to contacts
      const groupId = new Types.ObjectId(newGroup._id);
      await this.contactsService.addGroupToContacts(
        contactIds,
        groupId,
        userId
      );
    }

    return newGroup;
  }

  async findAllGroups(userId: string): Promise<Group[]> {
    return this.groupModel.find({ user: userId }).populate('contacts').exec();
  }

  async findGroupById(id: string, userId: string): Promise<Group | null> {
    try {
      const group = await this.groupModel
        .findOne({ _id: id, user: userId })
        .populate('contacts')
        .exec();

      if (!group) {
        throw new NotFoundException(`Group with ID "${id}" not found or does not belong to user`);
      }

      return group;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid Group ID "${id}"`);
      }
      throw error;
    }
  }

  async updateGroup(
    id: string,
    updateGroupDto: UpdateGroupDto,
    userId: string,
  ): Promise<Group | null> {
    const existingGroup = await this.groupModel.findOne({ _id: id, user: userId });
    if (!existingGroup) {
      throw new NotFoundException(`Group with ID "${id}" not found or does not belong to user`);
    }

    return this.groupModel.findByIdAndUpdate(
      id,
      {
        ...updateGroupDto,
        updated_at: new Date(),
      },
      { new: true },
    );
  }

  async findByAccountId(accountId: string, userId: string): Promise<any[]> {
    const groups = await this.groupModel
      .find({ account: accountId, user: userId })
      .populate('contacts')
      .exec();

    // Optional: Transform contacts
    return groups.map((group) => ({
      _id: group._id,
      name: group.name,
      contacts: group.contacts.map((contact: any) => ({
        name: contact.name,
        phonenum: contact.phone_number,
      })),
    }));
  }

  async deleteGroup(id: string, userId: string): Promise<void> {
    const result = await this.groupModel.deleteOne({ _id: id, user: userId });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Group with ID "${id}" not found or does not belong to user`);
    }
  }
}
