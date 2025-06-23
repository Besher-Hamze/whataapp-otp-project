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
        private readonly reconnectionService: ReconnectionService

    ) { }

    setupEventHandlers(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string
    ): void {
        this.setupQRHandler(client, clientId, emit);
        this.setupMessageHandler(client, clientId);
        this.setupAuthHandlers(client, clientId, emit);
        this.setupConnectionHandlers(client, clientId, emit, userId);
        this.setupErrorHandlers(client, clientId, emit);
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

    private setupMessageHandler(client: Client, clientId: string): void {
        client.on('message', (message: Message) => {
            setImmediate(() => this.messageHandler.handleIncomingMessage(message, clientId));
            this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });
        });
    }

    private setupAuthHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void): void {
        client.on('authenticated', () => {
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
        userId: string
    ): void {
        client.on('ready', async () => {
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
            await this.handleClientDisconnected(client, clientId, reason, emit);
        });
    }

    private setupErrorHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void): void {
        client.on('error', (error) => {
            this.logger.error(`🚫 Client ${clientId} error: ${error.message}`);
            if (this.isCriticalError(error)) {
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

        await this.accountService.handleAccountReady(phoneNumber, name, clientId, userId);

        this.sessionManager.updateClientState(clientId, {
            isReady: true,
            lastActivity: Date.now(),
            reconnectAttempts: 0,
        });

        emit('ready', {
            phoneNumber,
            name,
            clientId,
            status: 'active',
            message: 'WhatsApp client ready and account saved/updated.',
        });
    }

private async handleClientDisconnected(
    client: Client,
    clientId: string,
    reason: string,
    emit: (event: string, data: any) => void
): Promise<void> {
    this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);

    const isLogout = this.isLogoutReason(reason);

    if (isLogout) {
        await this.accountService.handleLogout(clientId, client); // Pass client
    } else {
        this.logger.log(`🔄 ${clientId} disconnected but not logged out, attempting reconnection`);
        emit('reconnecting', { clientId, reason });
        const account = await this.accountModel.findOne({ clientId }).exec();
        if (account) {
            await this.reconnectionService.handleReconnection(clientId)
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