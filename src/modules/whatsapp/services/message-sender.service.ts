import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { MessageContentResolverService } from './message-content-resolver.service';

interface MessageResult {
    recipient: string;
    status: string;
    error?: string;
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
        message: string,
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
            const resolvedContent = await this.contentResolver.resolveContent(message, clientId);
            const resolvedTo = await this.recipientResolver.resolveRecipients(to, clientId);

            if (resolvedTo.length === 0) {
                return { message: 'No valid recipients found', results: [] };
            }

            const results = await this.sendToRecipients(clientState, resolvedTo, resolvedContent, delayMs);
            return { message: 'Messages sent', results };

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

        if (state !== 'CONNECTED') {
            throw new HttpException('Client could not reconnect to WhatsApp.', HttpStatus.UNAUTHORIZED);
        }
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
