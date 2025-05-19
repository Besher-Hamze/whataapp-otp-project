// groups.module.ts
import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Group, GroupSchema } from './schema/groups.schema';
import { PhoneModule } from '../phone/phone.module';
import { ContactsModule } from '../contacts/contacts.module'; // ✅ Import here

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Group.name, schema: GroupSchema }]),
    PhoneModule,
    ContactsModule, // ✅ Add this
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
