import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';

interface ProcessedMessage {
    id: string;
    from: string;
    fromFull: string;
    body: string;
    type: string;
    timestamp: number;
    hasMedia: boolean;
    isGroupMsg: boolean;
    isForwarded: boolean;
    originalMessage: Message;
}

interface MessageStats {
    totalProcessed: number;
    skippedOld: number;
    skippedOwn: number;
    skippedBroadcast: number;
    processedSuccessfully: number;
    errors: number;
    lastProcessedAt: string;
}

@Injectable()
export class MessageHandlerService {
    private readonly logger = new Logger(MessageHandlerService.name);
    private readonly messageHandlers: Array<(message: ProcessedMessage, accountId: string) => Promise<void>> = [];
    private readonly unreadMessages = new Map<string, { clientId: string, from: string, timestamp: number }>();
    private readonly sessionStartTimes = new Map<string, number>(); // Track when each session started
    private readonly processedMessageIds = new Set<string>(); // Prevent duplicate processing
    private messageStats: MessageStats = {
        totalProcessed: 0,
        skippedOld: 0,
        skippedOwn: 0,
        skippedBroadcast: 0,
        processedSuccessfully: 0,
        errors: 0,
        lastProcessedAt: new Date().toISOString()
    };

    // ✅ Only process messages newer than this (prevent old message processing)
    private readonly MESSAGE_AGE_THRESHOLD_MS = 30000; // 30 seconds

    constructor(
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    ) {
        // Clean up old processed message IDs every hour
        setInterval(() => {
            this.cleanupOldMessageIds();
        }, 3600000); // 1 hour
    }

    registerMessageHandler(handler: (message: ProcessedMessage, accountId: string) => Promise<void>): void {
        this.logger.log(`📝 Registering new message handler (total: ${this.messageHandlers.length + 1})`);
        this.messageHandlers.push(handler);
    }

    /**
     * Mark when a session starts to track message age
     */
    markSessionStart(clientId: string): void {
        const startTime = Date.now();
        this.sessionStartTimes.set(clientId, startTime);
        this.logger.log(`⏰ Session start time marked for ${clientId}: ${new Date(startTime).toISOString()}`);
    }

    async handleIncomingMessage(message: Message, clientId: string): Promise<void> {
        try {
            this.messageStats.totalProcessed++;

            const messageId = message.id.id;
            const messageTimestamp = (message.timestamp || 0) * 1000; // Convert to milliseconds
            const currentTime = Date.now();

            this.logger.log(`🎯 Processing message #${this.messageStats.totalProcessed} for client: ${clientId}`);
            this.logger.debug(`📨 Message details: ID=${messageId}, From=${message.from}, Body="${message.body?.substring(0, 50)}"`);

            // ✅ PREVENT DUPLICATE PROCESSING
            if (this.processedMessageIds.has(messageId)) {
                this.logger.debug(`⏭️ Skipping duplicate message: ${messageId}`);
                return;
            }
            this.processedMessageIds.add(messageId);

            // ✅ FILTER OUT UNWANTED MESSAGES
            if (message.from.endsWith('@broadcast')) {
                this.messageStats.skippedBroadcast++;
                this.logger.debug('🚫 Skipping broadcast message');
                return;
            }

            if (message.fromMe) {
                this.messageStats.skippedOwn++;
                this.logger.debug('🚫 Skipping own message');
                return;
            }

            // ✅ PREVENT OLD MESSAGE PROCESSING
            const sessionStartTime = this.sessionStartTimes.get(clientId);
            const isOldMessage = this.isOldMessage(messageTimestamp, currentTime, sessionStartTime);

            if (isOldMessage) {
                this.messageStats.skippedOld++;
                this.logger.debug(`⏭️ Skipping old message: ${messageId} (timestamp: ${new Date(messageTimestamp).toISOString()})`);
                return;
            }

            // ✅ FIND ACCOUNT
            this.logger.debug(`🔍 Looking for account with clientId: ${clientId}`);
            const account = await this.accountModel.findOne({ clientId }, { _id: 1, user: 1 }).lean().exec();
            if (!account) {
                this.logger.warn(`❌ No account found for clientId: ${clientId}`);
                return;
            }

            const accountId = account._id.toString();
            const sender = this.extractSender(message.from);

            this.logger.log(`📧 Processing NEW message from ${sender} to account ${accountId}`);

            // ✅ STORE UNREAD MESSAGE
            this.unreadMessages.set(messageId, {
                clientId,
                from: sender,
                timestamp: currentTime
            });

            // ✅ CREATE CLEAN MESSAGE OBJECT
            const processedMessage: ProcessedMessage = {
                id: messageId,
                from: sender,
                fromFull: message.from,
                body: message.body || '',
                type: message.type || 'unknown',
                timestamp: messageTimestamp || currentTime,
                hasMedia: message.hasMedia || false,
                isGroupMsg: false,
                isForwarded: message.isForwarded || false,
                originalMessage: message
            };

            // ✅ CALL ALL REGISTERED HANDLERS
            if (this.messageHandlers.length === 0) {
                this.logger.warn('⚠️ No message handlers registered - AutoResponderInitializer might not have run!');
                return;
            }

            this.logger.log(`🔄 Calling ${this.messageHandlers.length} registered message handlers`);

            const handlerResults = await Promise.allSettled(
                this.messageHandlers.map(async (handler, index) => {
                    try {
                        this.logger.debug(`📞 Calling handler ${index + 1}/${this.messageHandlers.length}`);
                        const startTime = Date.now();

                        await handler(processedMessage, accountId);

                        const duration = Date.now() - startTime;
                        this.logger.debug(`✅ Handler ${index + 1} completed in ${duration}ms`);
                        return { success: true, duration };
                    } catch (error) {
                        this.logger.error(`❌ Handler ${index + 1} error: ${error.message}`, error.stack);
                        throw error;
                    }
                })
            );

            // ✅ LOG HANDLER RESULTS
            const successful = handlerResults.filter(r => r.status === 'fulfilled').length;
            const failed = handlerResults.filter(r => r.status === 'rejected');

            if (successful > 0) {
                this.messageStats.processedSuccessfully++;
            }
            if (failed.length > 0) {
                this.messageStats.errors++;
            }

            this.logger.log(`📊 Handler Results: ${successful}/${handlerResults.length} succeeded, ${failed.length} failed`);

            if (failed.length > 0) {
                failed.forEach((failure, index) => {
                    if (failure.status === 'rejected') {
                        this.logger.error(`Handler failure ${index + 1}: ${failure.reason}`);
                    }
                });
            }

            this.messageStats.lastProcessedAt = new Date().toISOString();

        } catch (error) {
            this.messageStats.errors++;
            this.logger.error(`❌ Critical message handling error: ${error.message}`, error.stack);
        }
    }

    /**
     * Determine if a message is too old to process
     */
    private isOldMessage(messageTimestamp: number, currentTime: number, sessionStartTime?: number): boolean {
        // If no timestamp available, assume it's current
        if (!messageTimestamp) {
            return false;
        }

        // If session start time is available, use it as reference
        if (sessionStartTime) {
            // Only process messages received after session started (with small buffer)
            const buffer = 5000; // 5 second buffer
            return messageTimestamp < (sessionStartTime - buffer);
        }

        // Fallback: check against age threshold
        const messageAge = currentTime - messageTimestamp;
        return messageAge > this.MESSAGE_AGE_THRESHOLD_MS;
    }

    /**
     * Extract clean sender from WhatsApp ID
     */
    private extractSender(from: string): string {
        return from
            .replace('@c.us', '')
            .replace('@s.whatsapp.net', '')
            .replace('@g.us', ''); // Handle group IDs too
    }

    /**
     * Clean up old processed message IDs to prevent memory leaks
     */
    private cleanupOldMessageIds(): void {
        // Keep only recent message IDs (last 24 hours worth)
        const maxSize = 10000; // Adjust based on your message volume

        if (this.processedMessageIds.size > maxSize) {
            const oldSize = this.processedMessageIds.size;
            const idsToRemove = Array.from(this.processedMessageIds).slice(0, this.processedMessageIds.size - maxSize);

            idsToRemove.forEach(id => this.processedMessageIds.delete(id));

            this.logger.debug(`🧹 Cleaned up ${oldSize - this.processedMessageIds.size} old message IDs`);
        }

        // Clean up old unread messages (older than 24 hours)
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        let cleanedUnread = 0;

        for (const [messageId, data] of this.unreadMessages.entries()) {
            if (data.timestamp < oneDayAgo) {
                this.unreadMessages.delete(messageId);
                cleanedUnread++;
            }
        }

        if (cleanedUnread > 0) {
            this.logger.debug(`🧹 Cleaned up ${cleanedUnread} old unread messages`);
        }
    }

    // ✅ PUBLIC METHODS FOR DEBUGGING/MONITORING

    getUnreadMessages(): Map<string, { clientId: string, from: string, timestamp: number }> {
        return new Map(this.unreadMessages);
    }

    clearUnreadMessage(messageId: string): void {
        this.unreadMessages.delete(messageId);
    }

    getHandlerCount(): number {
        return this.messageHandlers.length;
    }

    getProcessingStats(): MessageStats {
        return { ...this.messageStats };
    }

    getDetailedStats(clientId?: string) {
        const unreadMessages = Array.from(this.unreadMessages.entries());
        const clientUnread = clientId
            ? unreadMessages.filter(([_, data]) => data.clientId === clientId)
            : unreadMessages;

        return {
            ...this.messageStats,
            sessionInfo: {
                trackedSessions: this.sessionStartTimes.size,
                sessionStartTimes: Object.fromEntries(
                    Array.from(this.sessionStartTimes.entries()).map(([id, time]) => [
                        id,
                        new Date(time).toISOString()
                    ])
                ),
            },
            unreadMessages: {
                total: this.unreadMessages.size,
                forClient: clientUnread.length,
                recent: clientUnread
                    .filter(([_, data]) => Date.now() - data.timestamp < 300000) // Last 5 minutes
                    .length
            },
            processedMessageIds: {
                count: this.processedMessageIds.size,
                memoryUsage: `~${Math.round(this.processedMessageIds.size * 50 / 1024)}KB` // Rough estimate
            }
        };
    }

    /**
     * Reset stats for a specific client (useful when session restarts)
     */
    resetClientStats(clientId: string): void {
        this.sessionStartTimes.delete(clientId);

        // Remove unread messages for this client
        for (const [messageId, data] of this.unreadMessages.entries()) {
            if (data.clientId === clientId) {
                this.unreadMessages.delete(messageId);
            }
        }

        this.logger.log(`🔄 Reset message handling stats for client: ${clientId}`);
    }

    /**
     * Force cleanup method for maintenance
     */
    forceCleanup(): void {
        this.cleanupOldMessageIds();
        this.logger.log('🧹 Forced cleanup completed');
    }
}