// src/whatsapp/services/event-handler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, Message } from 'whatsapp-web.js';
import { QRCodeService } from './qr-code.service';
import { MessageHandlerService } from './message-handler.service';
import { SessionManagerService } from './session-manager.service';
import { AccountService } from './account.service';
import { CleanupService } from './cleanup.service';
import { ReconnectionService } from './reconnection.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/modules/accounts/schema/account.schema';
import { ContactsService } from '../../contacts/contacts.service'; // Adjust the path as needed
import { CreateContactDto } from 'src/modules/contacts/dto/create-contact.dto';


@Injectable()
export class EventHandlerService {
    private readonly logger = new Logger(EventHandlerService.name);

    constructor(
        private readonly qrCodeService: QRCodeService,
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly messageHandler: MessageHandlerService,
        private readonly sessionManager: SessionManagerService,
        private readonly accountService: AccountService,
        private readonly cleanupService: CleanupService, // New
        private readonly reconnectionService: ReconnectionService,
        private readonly contactService: ContactsService,
    ) { }

    setupEventHandlers(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string
    ): void {
        // Add cleanup state tracking using an object for proper reference passing
        const sessionState = { isHandlingLogout: false, isCleaningUp: false };
        
        this.setupQRHandler(client, clientId, emit);
        this.setupMessageHandler(client, clientId, sessionState);
        this.setupAuthHandlers(client, clientId, emit, sessionState);
        this.setupConnectionHandlers(client, clientId, emit, userId, sessionState);
        this.setupErrorHandlers(client, clientId, emit, sessionState);
    }

    private setupQRHandler(client: Client, clientId: string, emit: (event: string, data: any) => void): void {
        client.on('qr', async (qr) => {
            try {
                const qrDataUrl = await this.qrCodeService.generateQR(qr);
                emit('qr', { clientId, qr: qrDataUrl });
            } catch (error) {
                this.logger.error(`QR generation failed: ${error.message}`);
                emit('initialization_failed', { clientId, error: error.message });
            }
        });

        // Listen for QR code scan event - this fires when user scans the QR
        client.on('qr_received', () => {
            this.logger.log(`📱 QR code scanned for ${clientId}, starting loading...`);
            emit('loading_status', { loading: true });
        });

        // Alternative: Listen for loading_screen event if available
        client.on('loading_screen', (percent, message) => {
            this.logger.log(`⏳ Loading ${percent}% for ${clientId}: ${message}`);
            emit('loading_status', { loading: true, percent, message });
        });
    }

    private setupMessageHandler(client: Client, clientId: string, sessionState: { isHandlingLogout: boolean; isCleaningUp: boolean }): void {
        client.on('message', (message: Message) => {
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) return;
            
            setImmediate(() => this.messageHandler.handleIncomingMessage(message, clientId));
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });
    }

    private setupAuthHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, sessionState: { isHandlingLogout: boolean; isCleaningUp: boolean }): void {
        client.on('authenticated', () => {
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) return;
            
            // Don't emit loading_status here anymore since we do it after QR scan
            this.logger.log(`🔐 ${clientId} authenticated`);
            emit('authenticated', { clientId });
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });

        client.on('auth_failure', () => {
            this.logger.error(`🚫 ${clientId} authentication failed`);
            emit('auth_failure', { clientId });
            // Stop loading on auth failure
            emit('loading_status', { loading: false });
        });
    }

    private setupConnectionHandlers(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string,
        sessionState: { isHandlingLogout: boolean; isCleaningUp: boolean }
    ): void {
        client.on('ready', async () => {
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) return;
            
            try {
                await this.handleClientReady(client, clientId, emit, userId);
            } catch (error) {
                this.logger.error(`Ready handler error: ${error.message}`);
                emit('initialization_failed', { clientId, error: error.message });
                // Stop loading on error
                emit('loading_status', { loading: false });
            }
        });

        client.on('disconnected', async (reason) => {
            await this.handleClientDisconnected(client, clientId, reason, emit, sessionState);
        });
    }

    private setupErrorHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, sessionState: { isHandlingLogout: boolean; isCleaningUp: boolean }): void {
        client.on('error', (error) => {
            // If we're handling logout, ignore protocol errors as they're expected
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) {
                if (error.message.includes('Protocol error') && error.message.includes('Session closed')) {
                    this.logger.debug(`Ignoring expected protocol error during logout for ${clientId}: ${error.message}`);
                    return;
                }
            }
            
            this.logger.error(`🚫 Client ${clientId} error: ${error.message}`);
            if (this.isCriticalError(error) && !sessionState.isHandlingLogout) {
                emit('error', { clientId, error: error.message });
                // Stop loading on critical error
                emit('loading_status', { loading: false });
            }
        });
    }

private async handleClientReady(
    client: Client,
    clientId: string,
    emit: (event: string, data: any) => void,
    userId: string
): Promise<void> {
    // Stop loading when client is ready
    emit('loading_status', { loading: false });

    const userInfo = client.info;
    const phoneNumber = userInfo?.wid?.user || 'Unknown';
    const name = userInfo?.pushname || 'Unknown';

    // Save account
    const account = await this.accountService.handleAccountReady(phoneNumber, name, clientId, userId);
    const accountId = account._id.toString();

    this.sessionManager.updateClientState(clientId, {
        isReady: true,
        lastActivity: Date.now(),
        reconnectAttempts: 0,
    });

    // Save session state to database
    await this.sessionManager.saveSessionState(clientId);

    const isRestored = this.sessionManager.isRestoredSession(clientId);

    // ✅ Fetch and filter contacts
    // ✅ Fetch all WhatsApp contacts
const allContacts = await client.getContacts();

// ✅ Strictly filter saved contacts
const savedContacts = allContacts.filter((c) =>
    c.isMyContact &&                        // Saved in address book
    c.isUser &&                             // Is a WhatsApp user
    c.id && c.id.user &&                    // Has valid ID
    /^\d{7,15}$/.test(c.id.user)            // Number looks real (7-15 digits)
);

const seenNumbers = new Set<string>();

for (const contact of savedContacts) {
    const rawNumber = contact.id.user;
    const phoneNumber = '+' + rawNumber;

    if (seenNumbers.has(phoneNumber)) continue;
    seenNumbers.add(phoneNumber);

    const displayName = contact.name || contact.pushname || 'Unnamed';

    const createContactDto: CreateContactDto = {
        name: displayName,
        phone_number: phoneNumber,
        account: accountId,
    };

    try {
        await this.contactService.create(createContactDto, accountId);
    } catch (err) {
        this.logger.warn(`⚠️ Skipped contact ${phoneNumber}: ${err.message}`);
    }
}


    emit('ready', {
        phoneNumber,
        name,
        clientId,
        status: 'active',
        isRestored,
        message: isRestored
            ? 'WhatsApp session restored successfully.'
            : 'WhatsApp client ready and account saved/updated.',
    });

    this.logger.log(`🎉 Client ${clientId} is ready (${isRestored ? 'restored' : 'new'} session)`);
}



private async handleClientDisconnected(
        client: Client,
        clientId: string,
        reason: string,
        emit: (event: string, data: any) => void,
        sessionState?: { isHandlingLogout: boolean; isCleaningUp: boolean }
    ): Promise<void> {
        this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);

        // Update session state immediately
        this.sessionManager.updateClientState(clientId, { isReady: false });
        await this.sessionManager.markSessionAsDisconnected(clientId);

        const isLogout = this.isLogoutReason(reason);

        if (isLogout) {
            // Set logout state if sessionState is available
            if (sessionState) {
                sessionState.isHandlingLogout = true;
                sessionState.isCleaningUp = true;
            }
            
            this.logger.log(`🔒 ${clientId} detected as logged out due to: ${reason}`);
            
            // Remove all listeners immediately to prevent race conditions
            try {
                client.removeAllListeners();
            } catch (error) {
                this.logger.debug(`Could not remove listeners: ${error.message}`);
            }
            
            emit('logged_out', { clientId, reason });
            
            // Schedule cleanup after a short delay
            setTimeout(async () => {
                try {
                    await this.accountService.handleLogout(clientId, client);
                } catch (error) {
                    this.logger.error(`❌ Account logout handling failed for ${clientId}: ${error.message}`);
                    // Don't let logout errors crash the application
                }
            }, 1000);
        } else {
            this.logger.log(`🔄 ${clientId} disconnected but not logged out, attempting reconnection`);
            emit('disconnected', { clientId, reason });
            
            const account = await this.accountModel.findOne({ clientId }).exec();
            if (account) {
                emit('reconnecting', { clientId, reason });
                await this.reconnectionService.handleReconnection(clientId);
            } else {
                this.logger.warn(`❌ No account found for ${clientId}, cannot reconnect`);
            }
        }
    }

    private isLogoutReason(reason: string): boolean {
        return (
            reason.toLowerCase().includes('logout') ||
            reason.toLowerCase().includes('conflict') ||
            reason.toLowerCase().includes('logged out')
        );
    }

    private isCriticalError(error: Error): boolean {
        return error.message.includes('Session closed') ||
            error.message.includes('Protocol error') ||
            error.message.includes('Target closed');
    }
}