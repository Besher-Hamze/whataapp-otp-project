import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSavedMessageDto } from './dto/create-saved-massege.dto';
import { UpdateSavedMessageDto } from './dto/update-saved-massege.dto';
import { InjectModel } from '@nestjs/mongoose';
import { SavedMessage } from './schema/saved-messages.schema';
import { Model } from 'mongoose';


@Injectable()
export class SavedMessagesService {
  constructor(@InjectModel(SavedMessage.name) private savedMessagesModel: Model<SavedMessage>) {}
  async create(createSavedMessagesDto: CreateSavedMessageDto) {
    const newSavedMessages = await this.savedMessagesModel.create({
      content: createSavedMessagesDto.content,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return newSavedMessages;
  }

 async findAllSavedMessagess(): Promise<SavedMessage[]> {
    return this.savedMessagesModel.find().exec();
  }

  async findSavedMessagesById(id: string): Promise<SavedMessage | null> { // Changed parameter name to id
    try {
      const savedMessages = await this.savedMessagesModel.findById(id).exec(); // Use findById
      if (!savedMessages) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }
      return savedMessages;
    } catch (error) {
       if (error.name === 'CastError') {
          throw new NotFoundException(`Invalid User ID "${id}"`);
       }
       throw error;
    }
  }

  async updateSavedMessages(id: string, updateSavedMessagesDto: UpdateSavedMessageDto): Promise<SavedMessage | null> { // Changed parameter name to id
    // Check if the user exists
    const existingSavedMessages = await this.savedMessagesModel.findById(id).exec();  // Use findById
    if (!existingSavedMessages) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const updatedSavedMessages = await this.savedMessagesModel
      .findByIdAndUpdate(  // Use findByIdAndUpdate
        id,
        {
          ...updateSavedMessagesDto,
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedSavedMessages;
  }

  async deleteSavedMessages(id: string): Promise<void> { // Changed parameter name to id
    const result = await this.savedMessagesModel.deleteOne({ _id: id }).exec(); // Use _id
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }
}

