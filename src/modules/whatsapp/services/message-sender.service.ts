import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { MessageContentResolverService } from './message-content-resolver.service';
import { MessageMedia } from 'whatsapp-web.js';
import { ClientState } from '../interfaces/client-state.interface';
import * as mime from 'mime-types';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schema/users.schema';
import { ReconnectionService } from './reconnection.service';

interface MessageResult {
  recipient: string;
  status: 'sent' | 'failed' | 'likely_sent' | 'skipped';
  error?: string;
  warning?: string;
  messageId?: string;
}

interface SendProgress {
  total: number;
  completed: number;
  successful: number;
  failed: number;
  currentBatch: number;
}

@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  // Narrow patterns: message often delivered but library failed to return a serialized Message
  private readonly KNOWN_SUCCESS_ERRORS = [
    'getMessageModel',
    'msg.serialize is not a function',
    'Cannot read property \'serialize\'',
  ];

  private readonly STALE_SESSION_ERRORS = [
    'Execution context was destroyed',
    'Protocol error',
    'Session closed',
    'Target closed',
    'Cannot find context with specified id',
    'Navigation failed',
    'net::ERR_',
    'getState timeout',
  ];

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly reconnectionService: ReconnectionService,
    private readonly recipientResolver: RecipientResolverService,
    private readonly contentResolver: MessageContentResolverService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) { }

  async sendMessage(
    clientId: string,
    to: string[],
    message?: string,
    delayMs: number = 3000,
    photo?: Express.Multer.File,
    userId?: string
  ): Promise<{ message: string; results: MessageResult[]; photoSent?: boolean; summary: SendProgress }> {
    const clientState = this.sessionManager.getClientState(clientId);

    if (!clientState?.client) {
      throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
    }

    if (clientState.isSending) {
      throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // ✅ Check user's message limit here
    const user = await this.userModel.findById(userId);

    if (!user || !user.subscription) {
      this.logger.error(`User subscription not found for user ${userId} and subscription ${user?.subscription} and user ${user}`);
      throw new HttpException(`User subscription not found for user ${userId} and subscription ${user?.subscription} and user ${user}.`, HttpStatus.FORBIDDEN);
    }

    if (user.subscription.messagesUsed >= user.subscription.messageLimit) {
      throw new HttpException('Message limit exceeded. Please upgrade your subscription.', HttpStatus.FORBIDDEN);
    }

    await this.validateClientConnection(clientState, clientId);

    this.sessionManager.updateClientState(clientId, {
      isSending: true,
      lastActivity: Date.now()
    });

    try {
      // ✅ Validate input
      if (!photo && (!message || message.trim() === '')) {
        throw new HttpException('Either message or photo must be provided.', HttpStatus.BAD_REQUEST);
      }

      // ✅ Resolve content and recipients
      const resolvedContent = message ? await this.contentResolver.resolveContent(message, clientId) : '';
      const resolvedTo = await this.recipientResolver.resolveRecipients(to, clientId);

      if (resolvedTo.length === 0) {
        return {
          message: 'No valid recipients found',
          results: [],
          summary: { total: 0, completed: 0, successful: 0, failed: 0, currentBatch: 0 }
        };
      }

      this.logger.log(`📤 Starting to send ${photo ? 'photo' : 'text'} messages to ${resolvedTo.length} recipients`);

      let results: MessageResult[];
      const summary: SendProgress = {
        total: resolvedTo.length,
        completed: 0,
        successful: 0,
        failed: 0,
        currentBatch: 0
      };

      if (photo) {
        results = await this.sendToRecipientsWithPhoto(clientState, resolvedTo, resolvedContent, photo, delayMs, summary, userId!);
        return {
          message: `Messages sent with photo: ${summary.successful}/${summary.total} successful`,
          results,
          photoSent: true,
          summary
        };
      } else {
        results = await this.sendToRecipients(clientState, resolvedTo, resolvedContent, delayMs, summary, userId!);
        return {
          message: `Messages sent: ${summary.successful}/${summary.total} successful`,
          results,
          summary
        };
      }

    } finally {
      this.sessionManager.updateClientState(clientId, { isSending: false });
    }
  }

  async sendMessageExcel(
    clientId: string,
    data: { messages: { number: string; message: string }[] },
    delayMs: number = 3000,
    userId: string
  ): Promise<{ message: string; results: MessageResult[]; summary: SendProgress }> {
    const clientState = this.sessionManager.getClientState(clientId);

    if (!clientState?.client) {
      throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
    }

    if (clientState.isSending) {
      throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // ✅ Check user's message limit here
    const user = await this.userModel.findById(userId);

    if (!user || !user.subscription) {
      throw new HttpException('User subscription not found.', HttpStatus.FORBIDDEN);
    }

    if (user.subscription.messagesUsed >= user.subscription.messageLimit) {
      throw new HttpException('Message limit exceeded. Please upgrade your subscription.', HttpStatus.FORBIDDEN);
    }

    await this.validateClientConnection(clientState, clientId);

    this.sessionManager.updateClientState(clientId, {
      isSending: true,
      lastActivity: Date.now()
    });

    try {
      const allResults: MessageResult[] = [];
      const totalMessages = data.messages.length;
      let completed = 0;
      let successful = 0;

      this.logger.log(`📊 Starting bulk send to ${totalMessages} recipients`);

      for (const { number, message } of data.messages) {
        try {
          const resolvedTo = await this.recipientResolver.resolveRecipients([number], clientId);

          if (resolvedTo.length === 0) {
            allResults.push({
              recipient: number,
              status: 'skipped',
              error: 'No valid recipient found'
            });
            completed++;
            continue;
          }

          const resolvedContent = await this.contentResolver.resolveContent(message, clientId);
          const summary: SendProgress = { total: 1, completed: 0, successful: 0, failed: 0, currentBatch: 0 };

          const results = await this.sendToRecipients(clientState, resolvedTo, resolvedContent, delayMs, summary, userId);
          allResults.push(...results);

          if (results[0]?.status === 'sent' || results[0]?.status === 'likely_sent') {
            successful++;
          }

        } catch (error) {
          this.logger.error(`❌ Error processing message for ${number}: ${error.message}`);
          allResults.push({
            recipient: number,
            status: 'failed',
            error: error.message
          });
        }

        completed++;

        // Log progress every 10 messages
        if (completed % 10 === 0) {
          this.logger.log(`📊 Bulk send progress: ${completed}/${totalMessages} (${successful} successful)`);
        }
      }

      const failed = completed - successful;
      const summaryMessage = `Bulk send completed: ${successful} successful, ${failed} failed out of ${totalMessages} total`;

      this.logger.log(`📊 ${summaryMessage}`);

      return {
        message: summaryMessage,
        results: allResults,
        summary: {
          total: totalMessages,
          completed,
          successful,
          failed,
          currentBatch: 0
        }
      };
    } finally {
      this.sessionManager.updateClientState(clientId, { isSending: false });
    }
  }

  private async validateClientConnection(clientState: any, clientId: string): Promise<void> {
    if (!clientState.isReady) {
      throw new HttpException('WhatsApp client is not ready. Please wait for initialization.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const stateTimeoutMs = Number(process.env.WHATSAPP_GETSTATE_TIMEOUT_MS) || 12_000;

    try {
      const state = await Promise.race([
        clientState.client.getState(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getState timeout')), stateTimeoutMs),
        ),
      ]);
      this.logger.debug(`🔍 Client ${clientId} state: ${state}`);

      if (state !== 'CONNECTED') {
        this.markSessionUnhealthy(clientId, `Pre-send state is ${state}`);
        throw new HttpException(
          `WhatsApp client is ${state}. Session recovery started — retry shortly.`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    } catch (error: any) {
      this.markSessionUnhealthy(clientId, `State check failed: ${error?.message || error}`);
      throw new HttpException(
        'WhatsApp session is unhealthy and recovery has started. Please retry in a few seconds.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async sendToRecipients(
    clientState: any,
    recipients: string[],
    content: string,
    delayMs: number,
    summary: SendProgress,
    userId: string
  ): Promise<MessageResult[]> {
    const results: MessageResult[] = [];
    const batchSize = 1; // Reduced batch size for better reliability
    const totalBatches = Math.ceil(recipients.length / batchSize);

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      summary.currentBatch = currentBatch;

      this.logger.debug(`📦 Processing batch ${currentBatch}/${totalBatches} (${batch.length} recipients)`);

      const batchPromises = batch.map(async (recipient) => {
        return await this.sendSingleMessage(clientState, recipient, content, userId);
      });

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.status === 'sent' || result.value.status === 'likely_sent') {
            summary.successful++;
          } else {
            summary.failed++;
          }
        } else {
          results.push({
            recipient: batch[index],
            status: 'failed',
            error: result.reason?.message || 'Unknown error'
          });
          summary.failed++;
        }
        summary.completed++;
      });

      // Update session activity
      const sid = this.extractClientId(clientState);
      if (sid) {
        this.sessionManager.updateClientState(sid, { lastActivity: Date.now() });
      }

      // Wait between batches
      if (i + batchSize < recipients.length) {
        this.logger.debug(`⏳ Waiting ${delayMs}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  private async sendSingleFileMessage(
    clientState: any,
    recipient: string,
    media: MessageMedia,
    caption: string,
    mimeType: string,
    userId: string
  ): Promise<MessageResult> {
    try {
      const cleanedRecipient = recipient.replace(/\D/g, '');
      const chatId = `${cleanedRecipient}@c.us`;

      let sendResult;
      if (mimeType.startsWith('image/')) {
        sendResult = await clientState.client.sendMessage(chatId, media, { caption, mediaType: 'photo' });
        this.logger.log(`📸 Sent photo to ${recipient}: ${media.filename}`);
      } else if (mimeType.startsWith('video/')) {
        sendResult = await clientState.client.sendMessage(chatId, media, { caption, mediaType: 'video' });
        this.logger.log(`🎥 Sent video to ${recipient}: ${media.filename}`);
      } else {
        sendResult = await clientState.client.sendMessage(chatId, media, { caption, mediaType: 'document' });
        this.logger.log(`📄 Sent document to ${recipient}: ${media.filename}`);
      }

      // Increment message count for successful send
      await this.userModel.findByIdAndUpdate(userId, { $inc: { 'subscription.messagesUsed': 1 } });

      return { recipient, status: 'sent' };
    } catch (error: any) {
      const clientId = this.extractClientId(clientState);
      const msg = error?.message || '';

      if (clientId && this.isStaleSessionError(msg)) {
        this.markSessionUnhealthy(clientId, `File send: ${msg}`);
        return {
          recipient,
          status: 'failed',
          error: 'Session became unhealthy and is recovering. Retry this send.',
        };
      }

      const knownSerializeError =
        msg.includes('getMessageModel') ||
        msg.includes('msg.serialize is not a function') ||
        msg.includes("Cannot read property 'serialize'");

      if (knownSerializeError) {
        this.logger.warn(`⚠️ File likely sent, but confirmation failed for ${recipient}: ${msg}`);
        await this.userModel.findByIdAndUpdate(userId, { $inc: { 'subscription.messagesUsed': 1 } });
        return { recipient, status: 'likely_sent', warning: 'Sent but confirmation failed' };
      }

      this.logger.error(`❌ Failed to send file to ${recipient}: ${msg}`);
      return { recipient, status: 'failed', error: msg || 'Unknown error' };
    }
  }

  private async sendToRecipientsWithPhoto(
    clientState: any,
    recipients: string[],
    caption: string,
    file: Express.Multer.File,
    delayMs: number,
    summary: SendProgress,
    userId: string
  ): Promise<MessageResult[]> {
    const results: MessageResult[] = [];
    const batchSize = 1; // Smaller batch for all file types
    const totalBatches = Math.ceil(recipients.length / batchSize);

    const mimeType = mime.lookup(file.originalname) || 'application/octet-stream'; // Fallback to generic type
    if (!mimeType) {
      this.logger.warn(`Unable to determine MIME type for ${file.originalname}, using application/octet-stream`);
    }

    // Prepare media once
    const media = new MessageMedia(
      mimeType,
      file.buffer.toString('base64'),
      file.originalname
    );

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      summary.currentBatch = currentBatch;

      this.logger.debug(`📦 Processing file batch ${currentBatch}/${totalBatches} (${batch.length} recipients)`);

      const batchPromises = batch.map(async (recipient) => {
        const UniqContent = `عزيزي صاحب الرقم ${recipient}:\n ${caption}  `;
        return await this.sendSingleFileMessage(clientState, recipient, media, UniqContent, mimeType, userId);
      });

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.status === 'sent' || result.value.status === 'likely_sent') {
            summary.successful++;
          } else {
            summary.failed++;
          }
        } else {
          results.push({
            recipient: batch[index],
            status: 'failed',
            error: result.reason?.message || 'Unknown error'
          });
          summary.failed++;
        }
        summary.completed++;
      });

      const sid = this.extractClientId(clientState);
      if (sid) {
        this.sessionManager.updateClientState(sid, { lastActivity: Date.now() });
      }

      // Wait between batches (minimum 5s for files)
      if (i + batchSize < recipients.length) {
        const fileDelay = Math.max(delayMs, 5000); // Minimum 5s for files
        this.logger.debug(`⏳ Waiting ${fileDelay}ms before next file batch...`);
        await new Promise(resolve => setTimeout(resolve, fileDelay));
      }
    }

    return results;
  }

  private async sendSingleMessage(
    clientState: ClientState,
    recipient: string,
    content: string,
    userId: string
  ): Promise<MessageResult> {
    try {
      const cleanedRecipient = recipient.replace(/\D/g, '');
      const chatId = `${cleanedRecipient}@c.us`;

      this.logger.debug(`📤 Sending message to ${recipient}`);
      const UniqContent = `عزيزي صاحب الرقم ${recipient}:\n ${content}  `;
      const messageResult = await clientState.client.sendMessage(chatId, UniqContent, { sendSeen: false });

      // Increment message count for successful send
      await this.userModel.findByIdAndUpdate(userId, { $inc: { 'subscription.messagesUsed': 1 } });

      return {
        recipient,
        status: 'sent',
        messageId: messageResult?.id?.id || 'unknown'
      };

    } catch (error: any) {
      return await this.handleSendError(recipient, error, this.extractClientId(clientState));
    }
  }

  private async sendSinglePhotoMessage(
    clientState: any,
    recipient: string,
    media: MessageMedia,
    caption: string,
    userId: string
  ): Promise<MessageResult> {
    try {
      const cleanedRecipient = recipient.replace(/\D/g, '');
      const chatId = `${cleanedRecipient}@c.us`;

      this.logger.debug(`📤 Sending photo message to ${recipient}`);
      const UniqContent = `عزيزي صاحب الرقم ${recipient}:\n ${caption}  `;
      const messageResult = await clientState.client.sendMessage(chatId, media, { caption: UniqContent, sendSeen: false });

      // Increment message count for successful send
      await this.userModel.findByIdAndUpdate(userId, { $inc: { 'subscription.messagesUsed': 1 } });

      return {
        recipient,
        status: 'sent',
        messageId: messageResult?.id?.id || 'unknown'
      };

    } catch (error: any) {
      return await this.handleSendError(recipient, error, this.extractClientId(clientState));
    }
  }

  private async handleSendError(
    recipient: string,
    error: any,
    clientId?: string,
  ): Promise<MessageResult> {
    const errorMessage = error?.message || 'Unknown error';

    if (clientId && this.isStaleSessionError(errorMessage)) {
      this.markSessionUnhealthy(clientId, `Send error: ${errorMessage}`);
      return {
        recipient,
        status: 'failed',
        error: 'Session became unhealthy and is recovering. Retry this send.',
      };
    }

    const isKnownSuccessError = this.KNOWN_SUCCESS_ERRORS.some(knownError =>
      errorMessage.includes(knownError)
    );

    if (isKnownSuccessError) {
      this.logger.warn(`⚠️ Message likely sent to ${recipient}, but confirmation failed: ${errorMessage}`);
      return {
        recipient,
        status: 'likely_sent',
        warning: 'Message likely sent but confirmation failed due to WhatsApp Web JS limitation'
      };
    }

    if (errorMessage.includes('Rate limit') || errorMessage.includes('too many')) {
      this.logger.warn(`🚫 Rate limited for ${recipient}: ${errorMessage}`);
      return {
        recipient,
        status: 'failed',
        error: 'Rate limited - try again later'
      };
    }

    this.logger.error(`❌ Failed to send to ${recipient}: ${errorMessage}`);
    return {
      recipient,
      status: 'failed',
      error: errorMessage
    };
  }

  private isStaleSessionError(message: string): boolean {
    return this.STALE_SESSION_ERRORS.some(s => message.includes(s));
  }

  private extractClientId(clientState: ClientState | any): string | undefined {
    const unsafeClient = clientState?.client as any;
    return unsafeClient?.options?.authStrategy?.clientId;
  }

  private markSessionUnhealthy(clientId: string, reason: string): void {
    this.logger.warn(`⚠️ Marking ${clientId} unhealthy: ${reason}`);
    this.sessionManager.updateClientState(clientId, {
      isReady: false,
      lastActivity: Date.now(),
    });
    void this.reconnectionService.handleReconnection(clientId);
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