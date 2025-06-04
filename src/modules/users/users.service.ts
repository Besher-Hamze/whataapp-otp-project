import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from './schema/users.schema'; // Update import
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import * as bcrypt from 'bcrypt';

export interface CreateUserResponse {
  user: UserDocument | null; // Update type
  access_token: string | null;
  refresh_token: string | null;
  message?: string;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {} // Update type

  async createUser(createUserDto: CreateUserDto): Promise<UserDocument> { // Update return type
    const existingUser = await this.userModel.findOne({
      $or: [{ username: createUserDto.username }, { email: createUserDto.email }],
    });

    if (existingUser) {
      if (existingUser.username === createUserDto.username) {
        throw new ConflictException('Username already exists');
      } else {
        throw new ConflictException('Email already exists');
      }
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const newUser = await this.userModel.create({
      username: createUserDto.username,
      email: createUserDto.email,
      phone_number: createUserDto.phone_number,
      password: hashedPassword,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return newUser;
  }

  async findAllUsers(): Promise<UserDocument[]> { // Update return type
    return this.userModel.find().exec();
  }

  async findUserById(id: string): Promise<UserDocument | null> { // Update return type
    try {
      const user = await this.userModel.findById(id).exec();
      if (!user) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }
      return user;
    } catch (error) {
      if (error.name === 'CastError') {
        throw new NotFoundException(`Invalid User ID "${id}"`);
      }
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<UserDocument | null> { // Update return type
    return this.userModel.findOne({ email }).exec();
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument | null> { // Update return type
    const existingUser = await this.userModel.findById(id).exec();
    if (!existingUser) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const duplicateUser = await this.userModel.findOne({
      $or: [{ username: updateUserDto.username }, { email: updateUserDto.email }],
      _id: { $ne: existingUser._id },
    }).exec();

    if (duplicateUser) {
      if (duplicateUser.username === updateUserDto.username) {
        throw new ConflictException('Username already exists');
      } else {
        throw new ConflictException('Email already exists');
      }
    }

    let hashedPassword;
    if (updateUserDto.password) {
      hashedPassword = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          ...updateUserDto,
          ...(hashedPassword ? { password: hashedPassword } : {}),
          updated_at: new Date(),
        },
        { new: true },
      )
      .exec();
    return updatedUser;
  }

  async deleteUser(id: string): Promise<void> {
    const result = await this.userModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }

  async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}