// contacts.module.ts
import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from './schema/contacts.schema';
import { PhoneModule } from '../phone/phone.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contact.name, schema: ContactSchema }]),
    PhoneModule,
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService], // ✅ Export it here
})
export class ContactsModule {}
