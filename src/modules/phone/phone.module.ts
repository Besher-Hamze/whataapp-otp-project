import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Phone, PhoneSchema } from './schema/phone.schema';
import { PhoneService } from './phone.service';
import { PhoneController } from './phone.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Phone.name, schema: PhoneSchema }]),
  ],
  controllers: [PhoneController],
  providers: [PhoneService],
  exports: [PhoneService],
})
export class PhoneModule {}
