import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Phone, PhoneDocument } from './schema/phone.schema';

@Injectable()
export class PhoneService {
  constructor(
    @InjectModel(Phone.name) private phoneModel: Model<PhoneDocument>,
  ) {}

  async create(data: { number: string, account?: string }) {
    const phone = new this.phoneModel(data);
    return phone.save();
  }

  async findAll() {
    return this.phoneModel.find().exec();
  }

  async findOne(id: string) {
    return this.phoneModel.findById(id);
  }

  async findByNumber(number: string) {
    return this.phoneModel.findOne({ number }).exec();
  }
}
