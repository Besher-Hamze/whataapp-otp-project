import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SavedMessage, SavedMessageSchema } from './schema/saved-messages.schema';
import { SavedMessagesService } from './saved-messages.service';
import { SavedmessagesController } from './saved-messages.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SavedMessage.name, schema: SavedMessageSchema }]),
  ],
  controllers: [SavedmessagesController],
  providers: [SavedMessagesService],
  exports: [SavedMessagesService], // Export if needed by other modules
})
export class SavedMessagesModule {}