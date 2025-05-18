import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Contact } from './schema/contacts.schema';
import { Model, Types } from 'mongoose';
import { PhoneService } from '../phone/phone.service';

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name) private contactModel: Model<Contact>,
    private readonly phoneService: PhoneService,
  ) {}

  async create(createContactDto: CreateContactDto) {
    const existingContact = await this.contactModel.findOne({
      phone_number: createContactDto.phone_number,
    });

    if (existingContact) {
      throw new ConflictException('Phone Number already exists');
    }

    const newContact = await this.contactModel.create({
      ...createContactDto,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const existsInPhone = await this.phoneService.findByNumber(
      createContactDto.phone_number,
    );
    if (!existsInPhone) {
      await this.phoneService.create({ number: createContactDto.phone_number });
    }

    return newContact;
  }

  async findByPhoneNumber(phone_number: string): Promise<Contact | null> {
    return this.contactModel.findOne({ phone_number }).exec();
  }

  async findAllContacts(): Promise<Contact[]> {
    return this.contactModel.find().exec();
  }

  async findContactById(id: string): Promise<Contact | null> {
    try {
      const contact = await this.contactModel.findById(id).exec();
      if (!contact) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }
      return contact;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid User ID "${id}"`);
      }
      throw error;
    }
  }

  async addGroupToContacts(
    contactIds: Types.ObjectId[],
    groupId: Types.ObjectId,
  ) {
    await this.contactModel.updateMany(
      { _id: { $in: contactIds } },
      { $addToSet: { groups: groupId } },
    );
  }

  async updateContact(
    id: string,
    updateContactDto: UpdateContactDto,
  ): Promise<Contact | null> {
    const existingContact = await this.contactModel.findById(id).exec();
    if (!existingContact) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const duplicateContact = await this.contactModel.findOne({
      phone_number: updateContactDto.phone_number,
      _id: { $ne: id },
    });

    if (duplicateContact) {
      throw new ConflictException('Phone number already exists');
    }

    return this.contactModel.findByIdAndUpdate(
      id,
      {
        ...updateContactDto,
        updated_at: new Date(),
      },
      { new: true },
    );
  }

  async findByAccountId(accountId: string): Promise<any[]> {
    const contacts = await this.contactModel
      .find({ account: accountId })
      .exec();

    return contacts.map((c) => ({
      name: c.name,
      phonenum: c.phone_number,
    }));
  }

  async deleteContact(id: string): Promise<void> {
    const result = await this.contactModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }
}
