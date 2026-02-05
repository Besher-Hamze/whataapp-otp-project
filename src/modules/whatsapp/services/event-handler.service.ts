// src/whatsapp/services/event-handler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, Message, Contact } from 'whatsapp-web.js';
import * as libphonenumber from 'libphonenumber-js'; // Import libphonenumber-js
import { QRCodeService } from './qr-code.service';
import { MessageHandlerService } from './message-handler.service';
import { SessionManagerService } from './session-manager.service';
import { AccountService } from './account.service';
import { CleanupService } from './cleanup.service';
import { ReconnectionService } from './reconnection.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from 'src/modules/accounts/schema/account.schema';
import { ContactsService } from '../../contacts/contacts.service';
import { CreateContactDto } from 'src/modules/contacts/dto/create-contact.dto';
import { lengthLimits } from '../interfaces/numbers.interface';

interface SessionState {
    isHandlingLogout: boolean;
    isCleaningUp: boolean;
    startTime: number;
    messageCount: number;
    lastActivity: number;
}

@Injectable()
export class EventHandlerService {
    private readonly logger = new Logger(EventHandlerService.name);
    private readonly sessionStates = new Map<string, SessionState>();
    private readonly validCountryCodes = new Set(['+1', '+20', '+33', '+34', '+39', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52', '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94', '+95', '+98', '+212', '+213', '+216', '+218', '+220', '+221', '+222', '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232', '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242', '+243', '+244', '+245', '+246', '+247', '+248', '+249', '+250', '+251', '+252', '+253', '+254', '+255', '+256', '+257', '+258', '+260', '+261', '+262', '+263', '+264', '+265', '+266', '+267', '+268', '+269', '+290', '+291', '+297', '+298', '+299', '+350', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+376', '+377', '+378', '+379', '+380', '+381', '+382', '+383', '+385', '+386', '+387', '+389', '+420', '+421', '+423', '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508', '+509', '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597', '+598', '+599', '+670', '+671', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679', '+680', '+681', '+682', '+683', '+685', '+686', '+687', '+688', '+689', '+690', '+691', '+692', '+850', '+852', '+853', '+855', '+856', '+870', '+880', '+886', '+960', '+961', '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+971', '+972', '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996', '+998']);

    constructor(
        private readonly qrCodeService: QRCodeService,
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
        private readonly messageHandler: MessageHandlerService,
        private readonly sessionManager: SessionManagerService,
        private readonly accountService: AccountService,
        private readonly cleanupService: CleanupService,
        private readonly reconnectionService: ReconnectionService,
        private readonly contactService: ContactsService,
    ) { }

    setupEventHandlers(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string
    ): void {
        this.logger.log(`🔧 Setting up enhanced event handlers for client: ${clientId}`);

        // ✅ Initialize session state with start time
        const sessionState: SessionState = {
            isHandlingLogout: false,
            isCleaningUp: false,
            startTime: Date.now(),
            messageCount: 0,
            lastActivity: Date.now()
        };
        this.sessionStates.set(clientId, sessionState);

        // ✅ Mark session start time for message filtering
        this.messageHandler.markSessionStart(clientId);

        this.setupQRHandler(client, clientId, emit);
        this.setupMessageHandler(client, clientId, sessionState);
        this.setupAuthHandlers(client, clientId, emit, sessionState);
        this.setupConnectionHandlers(client, clientId, emit, userId, sessionState);
        this.setupErrorHandlers(client, clientId, emit, sessionState);

        this.logger.log(`✅ Enhanced event handlers setup completed for ${clientId} at ${new Date(sessionState.startTime).toISOString()}`);
    }

    private setupQRHandler(client: Client, clientId: string, emit: (event: string, data: any) => void): void {
        client.on('qr', async (qr) => {
            try {
                this.logger.log(`📱 QR code generated for ${clientId}`);
                const qrDataUrl = await this.qrCodeService.generateQR(qr);
                emit('qr', { clientId, qr: qrDataUrl });
            } catch (error) {
                this.logger.error(`❌ QR generation failed for ${clientId}: ${error.message}`);
                emit('initialization_failed', { clientId, error: error.message });
            }
        });

        client.on('qr_received', () => {
            this.logger.log(`📱 QR code scanned for ${clientId}, starting authentication...`);
            emit('loading_status', { clientId, loading: true, message: 'QR Code scanned, authenticating...' });
        });

        client.on('loading_screen', (percent, message) => {
            this.logger.log(`⏳ Loading ${percent}% for ${clientId}: ${message}`);
            emit('loading_status', { clientId, loading: true, percent, message });
        });
    }

    private setupMessageHandler(client: Client, clientId: string, sessionState: SessionState): void {
        this.logger.log(`📨 Setting up message handler for client: ${clientId}`);

        client.on('message', async (message: Message) => {
            try {
                // ✅ Check session state first
                if (sessionState.isHandlingLogout || sessionState.isCleaningUp) {
                    this.logger.debug(`⏭️ Skipping message for ${clientId} - session is cleaning up`);
                    return;
                }

                // ✅ Update session state
                sessionState.messageCount++;
                sessionState.lastActivity = Date.now();

                this.logger.log(`🎯 Message #${sessionState.messageCount} received for client ${clientId}`);
                this.logger.debug(`📨 Message: ID=${message.id.id}, From=${message.from}, Body="${message.body?.substring(0, 50)}"`);

                // ✅ Process through message handler pipeline
                await this.messageHandler.handleIncomingMessage(message, clientId);

                // ✅ Update session manager
                this.sessionManager.updateClientState(clientId, { lastActivity: Date.now() });

                this.logger.debug(`✅ Message processing completed for client ${clientId}`);

            } catch (error) {
                this.logger.error(`❌ Error in message handler for ${clientId}: ${error.message}`, error.stack);
            }
        });

        // ✅ Track message creation (including sent messages)
        client.on('message_create', (message) => {
            if (!sessionState.isHandlingLogout && !sessionState.isCleaningUp) {
                this.logger.debug(`📝 Message created for ${clientId}: ${message.id.id} (fromMe: ${message.fromMe})`);
                sessionState.lastActivity = Date.now();
            }
        });

        // ✅ Track message acknowledgments
        client.on('message_ack', (message, ack) => {
            if (!sessionState.isHandlingLogout && !sessionState.isCleaningUp) {
                this.logger.debug(`✅ Message ACK for ${clientId}: ${message.id.id}, status: ${ack}`);
            }
        });

        this.logger.log(`✅ Message handler setup completed for client: ${clientId}`);
    }

    private setupAuthHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, sessionState: SessionState): void {
        client.on('authenticated', () => {
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) return;

            this.logger.log(`🔐 ${clientId} authenticated`);
            sessionState.lastActivity = Date.now();

            emit('authenticated', {
                clientId,
                timestamp: sessionState.lastActivity,
                sessionStartTime: sessionState.startTime
            });

            this.sessionManager.updateClientState(clientId, { lastActivity: sessionState.lastActivity });
        });

        client.on('auth_failure', (msg) => {
            this.logger.error(`🚫 ${clientId} authentication failed: ${msg}`);
            emit('auth_failure', { clientId, message: msg });
            emit('loading_status', { clientId, loading: false });
        });
    }

    private setupConnectionHandlers(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string,
        sessionState: SessionState
    ): void {
        client.on('ready', async () => {
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) return;

            try {
                this.logger.log(`🎉 Client ${clientId} is ready! Session started at ${new Date(sessionState.startTime).toISOString()}`);
                await this.handleClientReady(client, clientId, emit, userId, sessionState);
            } catch (error) {
                this.logger.error(`❌ Ready handler error for ${clientId}: ${error.message}`);
                emit('initialization_failed', { clientId, error: error.message });
                emit('loading_status', { clientId, loading: false });
            }
        });

        client.on('disconnected', async (reason) => {
            this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);
            await this.handleClientDisconnected(client, clientId, reason, emit, sessionState);
        });
    }

    private setupErrorHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, sessionState: SessionState): void {
        client.on('error', (error) => {
            // ✅ Ignore expected errors during logout
            if (sessionState.isHandlingLogout || sessionState.isCleaningUp) {
                if (error.message.includes('Protocol error') && error.message.includes('Session closed')) {
                    this.logger.debug(`Ignoring expected protocol error during logout for ${clientId}: ${error.message}`);
                    return;
                }
            }

            this.logger.error(`🚫 Client ${clientId} error: ${error.message}`);

            if (this.isCriticalError(error) && !sessionState.isHandlingLogout) {
                emit('error', { clientId, error: error.message, timestamp: Date.now() });
                emit('loading_status', { clientId, loading: false });
            }
        });
    }

    private async handleClientReady(
        client: Client,
        clientId: string,
        emit: (event: string, data: any) => void,
        userId: string,
        sessionState: SessionState
    ): Promise<void> {
        // ✅ Stop loading when client is ready
        emit('loading_status', { clientId, loading: false });

        const userInfo = client.info;
        const phoneNumber = userInfo?.wid?.user || 'Unknown';
        const name = userInfo?.pushname || 'Unknown';

        // ✅ Save account and update session
        const account = await this.accountService.handleAccountReady(phoneNumber, name, clientId, userId);
        const accountId = account._id.toString();

        this.sessionManager.updateClientState(clientId, {
            isReady: true,
            lastActivity: Date.now(),
            reconnectAttempts: 0,
        });

        await this.sessionManager.saveSessionState(clientId);
        const isRestored = this.sessionManager.isRestoredSession(clientId);
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            const allContacts = await client.getContacts();

            const savedContacts = allContacts.filter((contact: Contact) => {
                if (!contact.id || !contact.id._serialized || !contact.id.user) return false;

                const jid = contact.id._serialized;
                const rawNumber = contact.id.user;

                // Basic checks
                if (!contact.isMyContact || !contact.isUser || contact.isGroup || jid.includes('@broadcast')) {
                    return false;
                }

                // Validate phone number using libphonenumber
                try {
                    const phoneNumber = libphonenumber.parsePhoneNumberFromString(`+${rawNumber}`);
                    if (!phoneNumber) return false;

                    const countryCode = `+${phoneNumber.countryCallingCode}`;
                    if (!this.validCountryCodes.has(countryCode)) return false;

                    // Enforce country-specific length limits
                    const nationalNumber = phoneNumber.nationalNumber.toString();

                    const limits = lengthLimits[countryCode];
                    if (nationalNumber.length < limits[0] || nationalNumber.length > limits[1]) {
                        this.logger.debug(`Rejected ${rawNumber}: National number length ${nationalNumber.length} outside ${limits[0]}-${limits[1]}`);
                        return false;
                    }


                    return phoneNumber.isValid();
                } catch (e) {
                    this.logger.debug(`Rejected ${rawNumber}: Invalid format - ${e.message}`);
                    return false;
                }
            });

            // Deduplicate and save contacts
            const seenNumbers = new Set<string>();
            for (const contact of savedContacts) {
                const rawNumber = contact.id.user;
                const phoneNumber = `+${rawNumber}`;
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
                    this.logger.log(`[EventHandlerService] Created new contact: ${displayName} (${phoneNumber}) for account ${accountId}`);
                } catch (err) {
                    this.logger.warn(`⚠️ Skipped contact ${phoneNumber}: ${err.message}`);
                }
            }
        } catch (err) {
            this.logger.warn(`⚠️ Skipped loading/saving contacts for ${clientId}: ${err?.message ?? err}`);
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
        sessionState: SessionState
    ): Promise<void> {
        // ✅ Update session state immediately
        this.sessionManager.updateClientState(clientId, { isReady: false });
        await this.sessionManager.markSessionAsDisconnected(clientId);

        const isLogout = this.isLogoutReason(reason);

        if (isLogout) {
            // ✅ Set logout state
            sessionState.isHandlingLogout = true;
            sessionState.isCleaningUp = true;

            this.logger.log(`🔒 ${clientId} detected as logged out due to: ${reason}`);

            // ✅ Clean up session state
            this.sessionStates.delete(clientId);
            this.messageHandler.resetClientStats(clientId);

            // ✅ Remove all listeners immediately
            try {
                client.removeAllListeners();
            } catch (error) {
                this.logger.debug(`Could not remove listeners for ${clientId}: ${error.message}`);
            }

            emit('logged_out', { clientId, reason, timestamp: Date.now() });

            // ✅ Schedule cleanup
            setTimeout(async () => {
                try {
                    await this.accountService.handleLogout(clientId, client);
                } catch (error) {
                    this.logger.error(`❌ Account logout handling failed for ${clientId}: ${error.message}`);
                }
            }, 1000);
        } else {
            this.logger.log(`🔄 ${clientId} disconnected but not logged out, attempting reconnection`);
            emit('disconnected', { clientId, reason, timestamp: Date.now() });

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
        const logoutReasons = ['logout', 'conflict', 'logged out', 'navigation', 'replaced'];
        return logoutReasons.some(lr => reason.toLowerCase().includes(lr));
    }

    private isCriticalError(error: Error): boolean {
        const criticalErrors = ['Session closed', 'Protocol error', 'Target closed', 'Navigation timeout'];
        return criticalErrors.some(ce => error.message.includes(ce));
    }

    // ✅ PUBLIC METHODS FOR DEBUGGING

    getSessionState(clientId: string): SessionState | undefined {
        return this.sessionStates.get(clientId);
    }

    getAllSessionStates(): Map<string, SessionState> {
        return new Map(this.sessionStates);
    }

    getSessionStats(clientId: string) {
        const sessionState = this.sessionStates.get(clientId);
        if (!sessionState) return null;

        const uptime = Date.now() - sessionState.startTime;
        return {
            clientId,
            startTime: new Date(sessionState.startTime).toISOString(),
            uptime: `${Math.round(uptime / 1000)}s`,
            messageCount: sessionState.messageCount,
            lastActivity: new Date(sessionState.lastActivity).toISOString(),
            status: sessionState.isHandlingLogout ? 'logging_out' :
                sessionState.isCleaningUp ? 'cleaning_up' : 'active',
        };
    }

    getAllSessionStats() {
        return Array.from(this.sessionStates.entries()).map(([clientId, _]) =>
            this.getSessionStats(clientId)
        ).filter(Boolean);
    }
}