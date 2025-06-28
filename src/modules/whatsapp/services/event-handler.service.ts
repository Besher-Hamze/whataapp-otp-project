// src/whatsapp/services/event-handler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, Message , Contact} from 'whatsapp-web.js';
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
import { ContactsService } from '../../contacts/contacts.service'; // Adjust the path as needed
import { CreateContactDto } from 'src/modules/contacts/dto/create-contact.dto';
import { lengthLimits } from '../interfaces/numbers.interface';


@Injectable()
export class EventHandlerService {
        private readonly logger = new Logger(EventHandlerService.name);
        private readonly validCountryCodes = new Set(['+1', '+20', '+33', '+34', '+39', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52', '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94', '+95', '+98', '+212', '+213', '+216', '+218', '+220', '+221', '+222', '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232', '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242', '+243', '+244', '+245', '+246', '+247', '+248', '+249', '+250', '+251', '+252', '+253', '+254', '+255', '+256', '+257', '+258', '+260', '+261', '+262', '+263', '+264', '+265', '+266', '+267', '+268', '+269', '+290', '+291', '+297', '+298', '+299', '+350', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+376', '+377', '+378', '+379', '+380', '+381', '+382', '+383', '+385', '+386', '+387', '+389', '+420', '+421', '+423', '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508', '+509', '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597', '+598', '+599', '+670', '+671', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679', '+680', '+681', '+682', '+683', '+685', '+686', '+687', '+688', '+689', '+690', '+691', '+692', '+850', '+852', '+853', '+855', '+856', '+870', '+880', '+886', '+960', '+961', '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+971', '+972', '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996', '+998']);
    
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