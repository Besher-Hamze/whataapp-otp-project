import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Contact } from './schema/contacts.schema';
import { Model } from 'mongoose';


@Injectable()
export class ContactsService {
  constructor(@InjectModel(Contact.name) private contactModel: Model<Contact>) {}
  async create(createContactDto: CreateContactDto) {
    const existingContact = await this.contactModel.findOne({
          $or: [
            { phone_number: createContactDto.phone_number },
          ],
    });
    
    if (existingContact) {
      throw new ConflictException('Phone Number already exists');
    }
    const newContact = await this.contactModel.create({
      name: createContactDto.name,
      phone_number: createContactDto.phone_number,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return newContact;
  }

 async findAllContacts(): Promise<Contact[]> {
    return this.contactModel.find().exec();
  }

  async findContactById(id: string): Promise<Contact | null> { // Changed parameter name to id
    try {
      const contact = await this.contactModel.findById(id).exec(); // Use findById
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
  async findOne(id: string): Promise<Contact> {
    const account = await this.contactModel.findById(id).exec();
    if (!account) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return account;
  }

  async updateContact(id: string, updateContactDto: UpdateContactDto): Promise<Contact | null> { // Changed parameter name to id
    // Check if the user exists
    const existingContact = await this.contactModel.findById(id).exec();  // Use findById
    if (!existingContact) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    // Check for duplicate username or email, excluding the user being updated
     const dublicateContact = await this.contactModel.findOne({
      $or: [
        { phone_number: updateContactDto.phone_number },
      ],
      _id: { $ne: existingContact._id }, // Exclude the current user from the check, use _id
    }).exec();

    if (dublicateContact) {
        throw new ConflictException('phone number already exists');
    }

    const updatedContact = await this.contactModel
      .findByIdAndUpdate(  // Use findByIdAndUpdate
        id,
        {
          ...updateContactDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedContact;
  }

  async deleteContact(id: string): Promise<void> { // Changed parameter name to id
    const result = await this.contactModel.deleteOne({ _id: id }).exec(); // Use _id
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }
}

