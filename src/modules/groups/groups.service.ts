import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Group, GroupDocument } from './schema/groups.schema';
import { Model, Types, HydratedDocument } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { PhoneService } from '../phone/phone.service';
import { ContactsService } from '../contacts/contacts.service';
import { Contact, ContactDocument } from '../contacts/schema/contacts.schema';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(Group.name) private groupModel: Model<Group>,
    private readonly phoneService: PhoneService,
    private readonly contactsService: ContactsService,
  ) { }

  async create(createDto: CreateGroupDto, accountId: string) {
    const existingGroup = await this.groupModel.findOne({ 
      name: createDto.name, 
      account: new Types.ObjectId(accountId) 
    });

    if (existingGroup) {
      const contactIdsToAdd: Types.ObjectId[] = [];

      for (const member of createDto.phone_numbers) {
        let contact = await this.contactsService.findByPhoneNumber(member.phone_number, accountId);
        if (!contact) {
          contact = await this.contactsService.create({ name: member.name, phone_number: member.phone_number }, accountId);
        }

        const exists = await this.phoneService.findByNumber(member.phone_number);
        if (!exists) {
          await this.phoneService.create({ number: member.phone_number, account: accountId });
        }

        if (!existingGroup.contacts.some(cId => cId.equals(contact._id))) {
          contactIdsToAdd.push(contact._id);
        }
      }

      if (contactIdsToAdd.length) {
        existingGroup.contacts.push(...contactIdsToAdd);
        try {
          await existingGroup.save();
          this.logger.log('Group saved with new contacts:', existingGroup.contacts);
        } catch (err) {
          this.logger.error('Failed to save group:', err);
        }

        await this.contactsService.addGroupToContacts(contactIdsToAdd, existingGroup._id, accountId);
      }

      this.logger.log(`Updated existing group ${existingGroup._id} with new contacts`);

      return existingGroup;
    }

    // Group does not exist, create it with contacts
    const contactIds: Types.ObjectId[] = [];

    for (const member of createDto.phone_numbers) {
      const { phone_number, name } = member;
      let contact = await this.contactsService.findByPhoneNumber(phone_number, accountId);
      if (!contact) {
        contact = await this.contactsService.create({ name, phone_number }, accountId);
      }
      contactIds.push(contact._id);

      const exists = await this.phoneService.findByNumber(phone_number);
      if (!exists) {
        await this.phoneService.create({ number: phone_number, account: accountId });
      }
    }

    const group = await this.groupModel.create({
      name: createDto.name,
      contacts: contactIds,
      account: new Types.ObjectId(accountId),
    });

    if (contactIds.length) {
      await this.contactsService.addGroupToContacts(contactIds, group._id, accountId);
    }

    this.logger.log(`Created group ${group._id} under account ${accountId}`);
    return group;
  }
  
async findAllGroups(accountId: string): Promise<Group[]> {
  return this.groupModel
    .find({ account: new Types.ObjectId(accountId) })
    .populate('contacts')
    .exec();
}

  async findGroupById(id: string, accountId: string): Promise<GroupDocument> {
  try {

    const objectAccountId = new Types.ObjectId(accountId);
    const group = await this.groupModel
      .findOne({ _id: id, account: objectAccountId })
      .populate('contacts')
      .exec();

    if (!group) {
      throw new NotFoundException(`Group with ID "${id}" not found or does not belong to account`);
    }

    return group;
  } catch (error: any) {
    if (error.name === 'CastError') {
      throw new NotFoundException(`Invalid Group ID "${id}"`);
    }
    throw error;
  }
}

async updateGroup(
  id: string,
  updateGroupDto: UpdateGroupDto,
  accountId: string,
): Promise<Group | null> {
  const objectId = new Types.ObjectId(id);
  const accountObjectId = new Types.ObjectId(accountId);

  const existingGroup = await this.groupModel.findOne({ _id: objectId, account: accountObjectId });
  if (!existingGroup) {
    throw new NotFoundException(`Group with ID "${id}" not found or does not belong to user`);
  }

  if (updateGroupDto.phone_numbers && updateGroupDto.phone_numbers.length > 0) {
    const contactIdsToAdd: Types.ObjectId[] = [];

    for (const member of updateGroupDto.phone_numbers) {
      let contact: ContactDocument | null = await this.contactsService.findByPhoneNumber(member.phone_number, accountId);

      // If contact not found by new phone number, check if it exists in the group by ID
      if (!contact && existingGroup.contacts.length > 0) {
        const existingContactId = existingGroup.contacts.find(async (cId) =>
          (await this.contactsService.findContactById(cId.toString(), accountId))?.phone_number === member.phone_number
        );
        if (existingContactId) {
          contact = await this.contactsService.findContactById(existingContactId.toString(), accountId);
        }
      }

      if (!contact) {
        // Create new contact if it doesn't exist
        contact = await this.contactsService.create(
          { name: member.name, phone_number: member.phone_number },
          accountId
        );
      } else {
        // Check if update is needed (name or phone_number changed)
        const needsUpdate = contact.name !== member.name || contact.phone_number !== member.phone_number;
        if (needsUpdate) {
          contact = await this.contactsService.updateContact(
            contact._id.toString(),
            { name: member.name, phone_number: member.phone_number },
            accountId
          );
        }
      }

      if (contact && !existingGroup.contacts.some(cId => cId.equals(contact._id))) {
        contactIdsToAdd.push(contact._id);
      }
    }

    if (contactIdsToAdd.length > 0) {
      existingGroup.contacts.push(...contactIdsToAdd);
      await this.contactsService.addGroupToContacts(contactIdsToAdd, existingGroup._id, accountId);
    }
  }

  if (updateGroupDto.name) {
    existingGroup.name = updateGroupDto.name;
  }

  existingGroup.updated_at = new Date();

  try {
    await existingGroup.save();
    this.logger.log('Group saved with new contacts:', existingGroup.contacts);
  } catch (err) {
    this.logger.error('Failed to save group:', err);
    throw err;
  }

  return existingGroup;
}

  async deleteGroup(id: string, accountId: string): Promise<{ message: string }> {
  const objectId = new Types.ObjectId(id);
  const accountObjectId = new Types.ObjectId(accountId);

  const result = await this.groupModel.deleteOne({ _id: objectId, account: accountObjectId });

  if (result.deletedCount === 0) {
    throw new NotFoundException(`Group with ID "${id}" not found or does not belong to user`);
  }

  return { message: `Group with ID "${id}" has been successfully deleted.` };
}

}
