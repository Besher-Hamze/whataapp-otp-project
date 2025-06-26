import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { MessageContentResolverService } from './message-content-resolver.service';
import { MessageMedia } from 'whatsapp-web.js';

interface MessageResult {
    recipient: string;
    status: string;
    error?: string;
    warning?: string;
}

@Injectable()
export class MessageSenderService {
    private readonly logger = new Logger(MessageSenderService.name);

    constructor(
        private readonly sessionManager: SessionManagerService,
        private readonly recipientResolver: RecipientResolverService,
        private readonly contentResolver: MessageContentResolverService,
    ) { }

    async sendMessage(
  clientId: string,
  to: string[],
  message?: string,
  delayMs: number = 3000,
  photo?: Express.Multer.File
): Promise<{ message: string; results: MessageResult[]; photoSent?: boolean }> {
  const clientState = this.sessionManager.getClientState(clientId);
  this.logger.debug(`sendMessage - ClientState for ${clientId}`);

  if (!clientState?.client) {
    throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
  }

  if (clientState.isSending) {
    throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
  }

  await this.validateClientConnection(clientState, clientId);

  this.sessionManager.updateClientState(clientId, {
    isSending: true,
    lastActivity: Date.now()
  });

  try {
    // ✅ Ensure that if no photo is provided, message must exist
    if (!photo && (!message || message.trim() === '')) {
      throw new HttpException('Either message or photo must be provided.', HttpStatus.BAD_REQUEST);
    }

    // 🔄 Resolve message only if it exists
    const resolvedContent = message
      ? await this.contentResolver.resolveContent(message, clientId)
      : ''; // Optional message with photo

    const resolvedTo = await this.recipientResolver.resolveRecipients(to, clientId);

    if (resolvedTo.length === 0) {
      return { message: 'No valid recipients found', results: [] };
    }

    let results: MessageResult[];

    if (photo) {
      results = await this.sendToRecipientsWithPhoto(
        clientState,
        resolvedTo,
        resolvedContent, // May be empty
        photo,
        delayMs
      );
      return { message: 'Messages sent with photo', results, photoSent: true };
    } else {
      results = await this.sendToRecipients(clientState, resolvedTo, resolvedContent, delayMs);
      return { message: 'Messages sent', results };
    }

  } finally {
    this.sessionManager.updateClientState(clientId, { isSending: false });
  }
}


    async sendMessageExcel(
        clientId: string,
        data: { messages: { number: string; message: string }[] },
        delayMs: number = 3000
    ): Promise<{ message: string; results: MessageResult[] }> {
        const clientState = this.sessionManager.getClientState(clientId);

        if (!clientState?.client) {
            throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
        }

        if (clientState.isSending) {
            throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
        }

        await this.validateClientConnection(clientState, clientId);

        this.sessionManager.updateClientState(clientId, {
            isSending: true,
            lastActivity: Date.now()
        });

        try {
            const allResults: MessageResult[] = [];
            for (const { number, message } of data.messages) {
                try {
                    const resolvedTo = await this.recipientResolver.resolveRecipients([number], clientId);
                    if (resolvedTo.length === 0) {
                        allResults.push({ recipient: number, status: 'failed', error: 'No valid recipient' });
                        continue;
                    }

                    const resolvedContent = await this.contentResolver.resolveContent(message, clientId);
                    const results = await this.sendToRecipients(clientState, resolvedTo, resolvedContent, delayMs);
                    allResults.push(...results);
                } catch (error) {
                    allResults.push({ recipient: number, status: 'failed', error: error.message });
                }
            }

            const successCount = allResults.filter(r => r.status === 'sent').length;
            const failedCount = allResults.length - successCount;
            const summaryMessage = `Bulk send completed: ${successCount} success, ${failedCount} failed`;
            this.logger.log(`📊 ${summaryMessage}`);
            return { message: summaryMessage, results: allResults };
        } finally {
            this.sessionManager.updateClientState(clientId, { isSending: false });
        }
    }

    private async validateClientConnection(clientState: any, clientId: string): Promise<void> {
        if (!clientState.isReady) {
            throw new HttpException('WhatsApp client is not ready. Please wait for initialization.', HttpStatus.SERVICE_UNAVAILABLE);
        }

        let state;
        try {
            state = await clientState.client.getState();
        } catch (error) {
            throw new HttpException('Client state unavailable. Session may be disconnected.', HttpStatus.SERVICE_UNAVAILABLE);
        }

        // if (state !== 'CONNECTED') {
        //     throw new HttpException('Client could not reconnect to WhatsApp.', HttpStatus.UNAUTHORIZED);
        // }
    }

    private async sendToRecipients(
  clientState: any,
  recipients: string[],
  content: string,
  delayMs: number
): Promise<MessageResult[]> {
  const results: MessageResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    const batchPromises = batch.map(async (recipient, batchIndex) => {
      try {
        const chatId = this.formatChatId(recipient);
        await clientState.client.sendMessage(chatId, content);
        results.push({ recipient, status: 'sent' });
        this.sessionManager.updateClientState(clientState.client.options.authStrategy.clientId, {
          lastActivity: Date.now()
        });
      } catch (error) {
        this.logger.error(`❌ Failed to send to ${recipient}: ${error.message}`);
        results.push({ recipient, status: 'failed', error: error.message });
      }
    });

    await Promise.allSettled(batchPromises);

    if (i + batchSize < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  this.logger.debug(`sendToRecipients results: ${JSON.stringify(results, null, 2)}`);
  return results;
}

private async sendToRecipientsWithPhoto(
  clientState: any,
  recipients: string[],
  caption: string,
  photo: Express.Multer.File,
  delayMs: number
): Promise<MessageResult[]> {
  const results: MessageResult[] = [];
  const batchSize = 5;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    const batchPromises = batch.map(async (recipient, batchIndex) => {
      try {
        const chatId = this.formatChatId(recipient);
        const media = new MessageMedia(
          photo.mimetype,
          photo.buffer.toString('base64'),
          photo.originalname
        );

        await clientState.client.sendMessage(chatId, media, { caption });

        results.push({ recipient, status: 'sent' });

        this.sessionManager.updateClientState(
          clientState.client.options.authStrategy.clientId,
          { lastActivity: Date.now() }
        );

      } catch (error: any) {
        const knownSerializeError =
          error?.message?.includes("getMessageModel") ||
          error?.message?.includes("serialize");

        if (knownSerializeError) {
          this.logger.warn(
            `⚠️ Message likely sent, but confirmation failed for ${recipient}: ${error.message}`
          );
          results.push({
            recipient,
            status: 'sent_with_warning',
            warning: 'Sent but confirmation failed'
          });
        } else {
          this.logger.error(`❌ Failed to send photo to ${recipient}: ${error.message}`);
          results.push({ recipient, status: 'failed', error: error.message });
        }
      }
    });

    await Promise.allSettled(batchPromises);

    if (i + batchSize < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  this.logger.debug(`sendToRecipientsWithPhoto results: ${JSON.stringify(results, null, 2)}`);
  return results;
}


    private formatChatId(recipient: string): string {
        let cleanedRecipient = recipient.startsWith('+') ? recipient.slice(1) : recipient;
        cleanedRecipient = cleanedRecipient.split('@')[0];

        if (!/^\d+$/.test(cleanedRecipient)) {
            throw new Error(`Invalid phone number format: ${cleanedRecipient}`);
        }

        return `${cleanedRecipient}@c.us`;
    }
}
