import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Contact, ContactDocument } from './schema/contacts.schema';
import { Model, Types } from 'mongoose';
import { PhoneService } from '../phone/phone.service';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
    private readonly phoneService: PhoneService,
  ) { }

  /**
   * Create a new contact
   * @param createContactDto Contact data
   * @param userId User ID who owns the contact
   * @returns Created contact
   */
  async create(createContactDto: CreateContactDto, userId: string) {
    // Check if contact with same phone number already exists for this user
    const existingContact = await this.contactModel.findOne({
      phone_number: createContactDto.phone_number,
      user: userId,
    });

    if (existingContact) {
      throw new ConflictException('Contact with this phone number already exists');
    }

    try {
      // Format the phone number to ensure consistency
      const formattedPhoneNumber = this.formatPhoneNumber(createContactDto.phone_number);

      // Create the contact with user association
      const newContact = await this.contactModel.create({
        ...createContactDto,
        phone_number: formattedPhoneNumber,
        user: userId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Register the phone number in the phone service if not already exists
      const existsInPhone = await this.phoneService.findByNumber(formattedPhoneNumber);
      if (!existsInPhone) {
        await this.phoneService.create({
          number: formattedPhoneNumber,
          user: userId
        });
      }

      this.logger.log(`Created new contact: ${newContact.name} (${formattedPhoneNumber}) for user ${userId}`);
      return newContact;
    } catch (error) {
      this.logger.error(`Failed to create contact: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Format phone number to ensure consistency (remove spaces, ensure includes country code)
   * @param phoneNumber Raw phone number
   * @returns Formatted phone number
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters except the plus sign
    let formatted = phoneNumber.replace(/[^\d+]/g, '');

    // Ensure number starts with + if it's an international format
    if (!formatted.startsWith('+') && formatted.length > 10) {
      formatted = '+' + formatted;
    }

    return formatted;
  }

  /**
   * Find contact by phone number
   * @param phoneNumber Phone number to search for
   * @param userId User ID who owns the contact
   * @returns Contact if found, null otherwise
   */
  async findByPhoneNumber(phoneNumber: string, userId: string): Promise<ContactDocument | null> {
    const formatted = this.formatPhoneNumber(phoneNumber);
    return this.contactModel.findOne({
      phone_number: formatted,
      user: userId
    }).exec();
  }

  /**
   * Get all contacts for a specific user
   * @param userId User ID who owns the contacts
   * @param search Optional search term for filtering
   * @param skip Number of records to skip for pagination
   * @param limit Maximum number of records to return
   * @returns Array of contacts
   */
  async findAllContacts(
    userId: string,
    search?: string,
    skip: number = 0,
    limit: number = 50
  ): Promise<{ contacts: ContactDocument[], total: number }> {
    // Build query based on user ID and optional search term
    const query: any = { user: userId };

    if (search) {
      // Search in name or phone number fields
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone_number: { $regex: search, $options: 'i' } },
      ];

      // If search term is a tag, search in tags array too
      if (!search.includes(' ')) {
        query.$or.push({ tags: { $regex: search, $options: 'i' } });
      }
    }

    // Get total count for pagination
    const total = await this.contactModel.countDocuments(query);

    // Get paginated results
    const contacts = await this.contactModel.find(query)
      .sort({ name: 1 }) // Sort by name
      .skip(skip)
      .limit(limit)
      .populate('groups', 'name') // Include group names
      .exec();

    return { contacts, total };
  }

  /**
   * Find contact by ID
   * @param id Contact ID
   * @param userId User ID who owns the contact
   * @returns Contact if found
   */
  async findContactById(id: string, userId: string): Promise<ContactDocument> {
    try {
      const contact = await this.contactModel.findOne({
        _id: id,
        user: userId
      })
        .populate('groups', 'name')
        .exec();

      if (!contact) {
        throw new NotFoundException(`Contact with ID "${id}" not found or does not belong to user`);
      }

      return contact;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid Contact ID "${id}"`);
      }
      throw error;
    }
  }

  /**
   * Add a group to multiple contacts
   * @param contactIds Array of contact IDs
   * @param groupId Group ID to add
   * @param userId User ID who owns the contacts
   */
  async addGroupToContacts(
    contactIds: Types.ObjectId[],
    groupId: Types.ObjectId,
    userId: string
  ) {
    // Only update contacts belonging to this user
    const result = await this.contactModel.updateMany(
      {
        _id: { $in: contactIds },
        user: userId
      },
      { $addToSet: { groups: groupId } },
    );

    this.logger.log(`Added group ${groupId} to ${result.modifiedCount} contacts`);
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Remove a group from multiple contacts
   * @param contactIds Array of contact IDs 
   * @param groupId Group ID to remove
   * @param userId User ID who owns the contacts
   */
  async removeGroupFromContacts(
    contactIds: Types.ObjectId[],
    groupId: Types.ObjectId,
    userId: string
  ) {
    const result = await this.contactModel.updateMany(
      {
        _id: { $in: contactIds },
        user: userId
      },
      { $pull: { groups: groupId } },
    );

    this.logger.log(`Removed group ${groupId} from ${result.modifiedCount} contacts`);
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Update a contact
   * @param id Contact ID
   * @param updateContactDto Update data
   * @param userId User ID who owns the contact
   * @returns Updated contact
   */
  async updateContact(
    id: string,
    updateContactDto: UpdateContactDto,
    userId: string
  ): Promise<any> {
    // Check if contact exists and belongs to this user
    const existingContact = await this.contactModel.findOne({
      _id: id,
      user: userId
    }).exec();

    if (!existingContact) {
      throw new NotFoundException(`Contact with ID "${id}" not found or does not belong to user`);
    }

    // If updating phone number, check for duplicates
    if (updateContactDto.phone_number) {
      const formattedPhoneNumber = this.formatPhoneNumber(updateContactDto.phone_number);

      const duplicateContact = await this.contactModel.findOne({
        phone_number: formattedPhoneNumber,
        user: userId,
        _id: { $ne: id },
      });

      if (duplicateContact) {
        throw new ConflictException('Another contact with this phone number already exists');
      }

      // Update the formatted phone number
      updateContactDto.phone_number = formattedPhoneNumber;
    }

    const updatedContact = await this.contactModel.findByIdAndUpdate(
      id,
      {
        ...updateContactDto,
        updated_at: new Date(),
      },
      { new: true },
    ).populate('groups', 'name');

    this.logger.log(`Updated contact ${id} for user ${userId}`);
    return updatedContact;
  }

  /**
   * Find contacts by account ID
   * @param accountId Account ID
   * @param userId User ID who owns the account
   * @returns Simplified contact list
   */
  async findByAccountId(accountId: string, userId: string): Promise<any[]> {
    const contacts = await this.contactModel
      .find({
        account: accountId,
        user: userId
      })
      .exec();

    return contacts.map((c) => ({
      id: c._id,
      name: c.name,
      phoneNumber: c.phone_number,
    }));
  }

  /**
   * Find contacts by group ID
   * @param groupId Group ID
   * @param userId User ID who owns the contacts
   * @returns Contacts in the group
   */
  async findByGroupId(groupId: string, userId: string): Promise<ContactDocument[]> {
    return this.contactModel.find({
      groups: groupId,
      user: userId
    }).exec();
  }

  /**
   * Add tags to contacts
   * @param contactIds Array of contact IDs
   * @param tags Array of tags to add
   * @param userId User ID who owns the contacts
   */
  async addTagsToContacts(
    contactIds: string[],
    tags: string[],
    userId: string
  ) {
    const result = await this.contactModel.updateMany(
      {
        _id: { $in: contactIds.map(id => new Types.ObjectId(id)) },
        user: userId
      },
      { $addToSet: { tags: { $each: tags } } },
    );

    this.logger.log(`Added tags ${tags.join(', ')} to ${result.modifiedCount} contacts`);
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Remove tags from contacts
   * @param contactIds Array of contact IDs
   * @param tags Array of tags to remove
   * @param userId User ID who owns the contacts
   */
  async removeTagsFromContacts(
    contactIds: string[],
    tags: string[],
    userId: string
  ) {
    const result = await this.contactModel.updateMany(
      {
        _id: { $in: contactIds.map(id => new Types.ObjectId(id)) },
        user: userId
      },
      { $pull: { tags: { $in: tags } } },
    );

    this.logger.log(`Removed tags ${tags.join(', ')} from ${result.modifiedCount} contacts`);
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Find contacts by tags
   * @param tags Array of tags to search for
   * @param userId User ID who owns the contacts
   * @returns Contacts with matching tags
   */
  async findByTags(tags: string[], userId: string): Promise<ContactDocument[]> {
    return this.contactModel.find({
      tags: { $all: tags },
      user: userId
    }).exec();
  }

  /**
   * Delete a contact
   * @param id Contact ID
   * @param userId User ID who owns the contact
   */
  async deleteContact(id: string, userId: string): Promise<void> {
    const result = await this.contactModel.deleteOne({
      _id: id,
      user: userId
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException(`Contact with ID "${id}" not found or does not belong to user`);
    }

    this.logger.log(`Deleted contact ${id} for user ${userId}`);
  }

  /**
   * Bulk import contacts
   * @param contacts Array of contacts to import
   * @param userId User ID who will own the contacts
   * @returns Import results
   */
  async bulkImport(contacts: CreateContactDto[], userId: string): Promise<{
    imported: number;
    duplicates: number;
    errors: { index: number; error: string }[];
  }> {
    let imported = 0;
    let duplicates = 0;
    const errors: { index: number; error: string }[] = [];

    this.logger.log(`Starting bulk import of ${contacts.length} contacts for user ${userId}`);

    // Process contacts in batch
    for (let i = 0; i < contacts.length; i++) {
      try {
        const contact = contacts[i];

        // Format phone number
        const formattedPhoneNumber = this.formatPhoneNumber(contact.phone_number);

        // Check for duplicate
        const existingContact = await this.contactModel.findOne({
          phone_number: formattedPhoneNumber,
          user: userId,
        });

        if (existingContact) {
          duplicates++;
          continue;
        }

        // Create new contact
        await this.contactModel.create({
          ...contact,
          phone_number: formattedPhoneNumber,
          user: userId,
          created_at: new Date(),
          updated_at: new Date(),
        });

        imported++;
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    this.logger.log(`Completed bulk import: ${imported} imported, ${duplicates} duplicates, ${errors.length} errors`);

    return { imported, duplicates, errors };
  }
}
