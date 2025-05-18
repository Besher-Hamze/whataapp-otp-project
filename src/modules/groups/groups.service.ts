import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(
    @InjectModel(Group.name) private groupModel: Model<Group>,
    private readonly phoneService: PhoneService,
    private readonly contactsService: ContactsService,
  ) {}

  async create(createGroupDto: CreateGroupDto) {
    const contactIds: Types.ObjectId[] = [];

    for (const contact of createGroupDto.phone_numbers) {
      const { phone_number, name } = contact;

      let existingContact =
        await this.contactsService.findByPhoneNumber(phone_number);

      // create if not exist
      if (!existingContact) {
        existingContact = await this.contactsService.create({
          name,
          phone_number,
          account: createGroupDto.account,
        });
      }

      // 👇 tell TypeScript: we guarantee it exists now
      contactIds.push((existingContact as any)._id); // ✅ safest with no TS complaints

      const existsInPhone = await this.phoneService.findByNumber(phone_number);
      if (!existsInPhone) {
        await this.phoneService.create({ number: phone_number });
      }
    }

    const groupDoc = new this.groupModel({
      name: createGroupDto.name,
      contacts: contactIds,
      account: createGroupDto.account,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const newGroup: HydratedDocument<Group> = await groupDoc.save();

    const groupId = newGroup._id?.toString(); // force extract safely
    await this.contactsService.addGroupToContacts(
      contactIds,
      new Types.ObjectId(groupId),
    );

    return newGroup;
  }

  async findAllGroups(): Promise<Group[]> {
    return this.groupModel.find().populate('contacts').exec();
  }

  async findGroupById(id: string): Promise<Group | null> {
    try {
      const group = await this.groupModel
        .findById(id)
        .populate('contacts')
        .exec();

      if (!group) {
        throw new NotFoundException(`Group with ID "${id}" not found`);
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
  ): Promise<Group | null> {
    const existingGroup = await this.groupModel.findById(id);
    if (!existingGroup) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
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

  async findByAccountId(accountId: string): Promise<any[]> {
    const groups = await this.groupModel
      .find({ account: accountId })
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

  async deleteGroup(id: string): Promise<void> {
    const result = await this.groupModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
    }
  }
}
