import { ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { rmSync } from 'fs';
import { join } from 'path';
import * as fs from 'fs';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { Model, Types } from 'mongoose';
import { ModuleRef } from '@nestjs/core';
import { ContactsService } from '../contacts/contacts.service';
import { GroupsService } from '../groups/groups.service';
import { TemplatesService } from '../templates/templates.service';

interface MessageResult {
  recipient: string;
  status: string;
  error?: string;
}

interface QRGenerationCache {
  qr: string;
  dataUrl: string;
  timestamp: number;
}

function isValidObjectId(id: string | Types.ObjectId): boolean {
  if (id instanceof Types.ObjectId) return true;
  if (typeof id === 'string') return /^[a-fA-F0-9]{24}$/.test(id);
  return false;
}

function isPhoneNumber(value: string): boolean {
  return /^\+\d+$/.test(value);
}

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly clients = new Map<string, Client>();
  private readonly socketClientMap = new Map<string, string>();
  private readonly sendingMessages = new Map<string, boolean>();
  private readonly messageHandlers: Array<(message: any, accountId: string) => Promise<void>> = [];
  private readonly qrCache = new Map<string, QRGenerationCache>();
  private readonly clientReadyPromises = new Map<string, Promise<void>>();
  private readonly initializationQueue = new Map<string, Promise<any>>;

  private readonly puppeteerConfig = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI,VizDisplayCompositor',
      '--disable-ipc-flooding-protection',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--mute-audio',
      '--no-crash-upload',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-features=AudioServiceOutOfProcess',
      '--single-process',
      '--memory-pressure-off',
      '--max_old_space_size=4096',
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout: 60000,
    protocolTimeout: 60000,
  };

  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    private moduleRef: ModuleRef,
    private readonly groupsService: GroupsService,
    private readonly contactsService: ContactsService,
    private templatesService: TemplatesService,
  ) {}

  async resolveRecipients(to: string[], clientId: string): Promise<string[]> {
  this.logger.log(`🔍 Resolving recipients for clientId: ${clientId}, to: ${JSON.stringify(to)}`);

  const account = await this.accountModel.findOne({ clientId }).exec();
  if (!account) {
    this.logger.error(`❌ No account found for clientId: ${clientId}`);
    throw new NotFoundException(`No account found for clientId: ${clientId}`);
  }
  const accountId = account._id.toString();
  this.logger.log(`✅ Account found, accountId: ${accountId}`);

  const resolvedNumbersSet = new Set<string>();

  for (const item of to) {
    this.logger.log(`📋 Processing item: ${item}`);

    if (isValidObjectId(item)) {
      this.logger.log(`🔑 Item ${item} is a valid ObjectId, checking group or contact`);

      const group = await this.groupsService.findGroupById(item, accountId).catch((err) => {
        this.logger.error(`❌ Group lookup failed for ${item}: ${err.message}`);
        return null;
      });

      if (group) {
        this.logger.log(`✅ Found group for ${item}, processing contacts`);
        // Ensure group.contacts is an array to prevent iteration issues
        if (Array.isArray(group.contacts)) {
          for (const contactItem of group.contacts) { // Renamed 'contact' to 'contactItem' to avoid conflict
            // Check if contactItem is a full contact object (duck typing for phone_number)
            if (typeof contactItem === 'object' && contactItem !== null && 'phone_number' in contactItem && typeof contactItem.phone_number === 'string') {
              this.logger.log(`✅ Added contact phone number from group (object): ${contactItem.phone_number}`);
              resolvedNumbersSet.add(contactItem.phone_number);
            } else if (isValidObjectId(contactItem)) { // It's an ObjectId, so fetch the contact
              const contactId = contactItem.toString(); // Now contactItem is confirmed as an ObjectId or something that can be stringified.
              const foundContact = await this.contactsService.findContactById(contactId, accountId).catch((err) => {
                this.logger.error(`❌ Contact lookup failed for ${contactId}: ${err.message}`);
                return null;
              });
              if (foundContact) {
                this.logger.log(`✅ Added contact phone number from group (fetched): ${foundContact.phone_number}`);
                resolvedNumbersSet.add(foundContact.phone_number);
              } else {
                this.logger.warn(`⚠️ No contact found for ${contactId} in group`);
              }
            } else {
              this.logger.warn(`⚠️ Unexpected type for contact in group: ${JSON.stringify(contactItem)}`);
            }
          }
        }
        continue;
      }

      const contact = await this.contactsService.findContactById(item, accountId).catch((err) => {
        this.logger.error(`❌ Contact lookup failed for ${item}: ${err.message}`);
        return null;
      });
      if (contact) {
        this.logger.log(`✅ Found contact for ${item}, phone number: ${contact.phone_number}`);
        resolvedNumbersSet.add(contact.phone_number);
        continue;
      } else {
        this.logger.warn(`⚠️ No group or contact found for ObjectId ${item}`);
      }
    } else {
      this.logger.log(`📞 Item ${item} is not an ObjectId, treating as raw number`);
      resolvedNumbersSet.add(item);
    }
  }

  const resolvedNumbers = Array.from(resolvedNumbersSet);
  this.logger.log(`✅ Resolved numbers: ${JSON.stringify(resolvedNumbers)}`);
  return resolvedNumbers;
}

private async resolveMessageContent(message: string, clientId: string): Promise<string> {
    this.logger.debug(`🔍 Resolving message content for clientId: ${clientId}, input: ${message}`);

    // Check if message is a valid ObjectId (potential template ID)
    if (Types.ObjectId.isValid(message)) {
      this.logger.debug(`🔍 Input "${message}" is a valid ObjectId, checking as template ID`);

      try {
        const account = await this.accountModel.findOne({ clientId }).exec();
        if (!account) {
          this.logger.error(`❌ No account found for clientId: ${clientId}`);
          throw new NotFoundException(`No account found for clientId: ${clientId}`);
        }
        const accountId = account._id.toString();
        this.logger.debug(`🔍 Found accountId: ${accountId} for clientId: ${clientId}`);

        const template = await this.templatesService.findById(message, accountId);
        this.logger.debug(`🔍 Using template ${message} content: ${template.content}`);
        return template.content;
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.warn(`⚠️ Template "${message}" not found or doesn't belong to account, falling back to raw message`);
          return message; // Fallback to raw message
        }
        this.logger.error(`❌ Unexpected error resolving template ${message}: ${error.message}`);
        throw error; // Re-throw other errors (e.g., database issues)
      }
    }

    // Not a valid ObjectId, treat as raw message
    this.logger.debug(`🔍 Input "${message}" is not a valid ObjectId, treating as raw message`);
    return message;
  }

  async onModuleInit() {
    setImmediate(() => this.loadClientsFromSessions());
    setInterval(() => this.cleanupExpiredQRCodes(), 300000);
    setInterval(() => this.cleanupStaleConnections(), 600000);
  }

  registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>) {
    this.logger.log('📝 Registering new message handler');
    this.messageHandlers.push(handler);
  }

  async startSession(socketClientId: string, userId: string, emit: (event: string, data: any) => void) {
    if (this.socketClientMap.has(socketClientId)) {
      const existingClientId = this.socketClientMap.get(socketClientId)!;
      const client = this.clients.get(existingClientId);
      if (client) return { clientId: existingClientId };
    }
    if (this.initializationQueue.has(socketClientId)) {
      this.logger.warn(`🔄 Session initialization already in progress for: ${socketClientId}`);
      return this.initializationQueue.get(socketClientId)!;
    }

    const initPromise = this.doStartSession(socketClientId, userId, emit);
    this.initializationQueue.set(socketClientId, initPromise);
    try {
      const result = await initPromise;
      return result;
    } finally {
      this.initializationQueue.delete(socketClientId);
    }
  }

  private async doStartSession(socketClientId: string, userId: string, emit: (event: string, data: any) => void) {
    if (this.socketClientMap.has(socketClientId)) {
      const existingClientId = this.socketClientMap.get(socketClientId)!;
      this.logger.warn(`⚠️ Session exists for socket: ${socketClientId}`);
      emit('session_exists', { clientId: existingClientId });
      return { clientId: existingClientId };
    }

    const clientId = uuidv4();
    const startTime = Date.now();
    this.logger.log(`🚀 Starting session ${clientId} for socket: ${socketClientId}`);
    this.socketClientMap.set(socketClientId, clientId);

    try {
      const client = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: this.puppeteerConfig,
      });

      this.setupClientEventHandlers(client, clientId, emit, userId);
      this.clients.set(clientId, client);

      let readyResolve: () => void;
      const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });
      this.clientReadyPromises.set(clientId, readyPromise);
      client.once('ready', () => {
        const duration = Date.now() - startTime;
        this.logger.log(`✅ Client ${clientId} ready in ${duration}ms`);
        readyResolve();
      });

      const initTimeout = setTimeout(() => {
        this.logger.error(`⏰ Client ${clientId} initialization timeout`);
        emit('initialization_failed', { clientId });
      }, 120000);
      await client.initialize();
      clearTimeout(initTimeout);

      const duration = Date.now() - startTime;
      this.logger.log(`🎉 Session ${clientId} started in ${duration}ms`);
      return { clientId };
    } catch (error) {
      this.logger.error(`❌ Failed to start session ${clientId}: ${error.message}`);
      this.clients.delete(clientId);
      this.socketClientMap.delete(socketClientId);
      this.clientReadyPromises.delete(clientId);
      emit('initialization_failed', {
        clientId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  private setupClientEventHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, userId: string) {
    client.on('qr', async (qr) => {
      const qrStartTime = Date.now();
      this.logger.log(`📱 QR received for ${clientId} - generating...`);
      try {
        const cached = this.qrCache.get(qr);
        if (cached && Date.now() - cached.timestamp < 30000) {
          emit('qr', { clientId, qr: cached.dataUrl });
          return;
        }
        const qrDataUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.8,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' },
          width: 256,
        });
        this.qrCache.set(qr, { qr, dataUrl: qrDataUrl, timestamp: Date.now() });
        emit('qr', { clientId, qr: qrDataUrl });
        setImmediate(() => qrcodeTerminal.generate(qr, { small: true }));
        this.logger.log(`✅ QR generated and sent in ${Date.now() - qrStartTime}ms`);
      } catch (error) {
        this.logger.error(`❌ QR generation failed: ${error.message}`);
        emit('initialization_failed', { clientId, error: error.message });
      }
    });

    client.on('message', async (message) => setImmediate(() => this.handleIncomingMessage(message, clientId)));
    client.on('authenticated', () => {
      this.logger.log(`🔐 ${clientId} authenticated`);
      emit('authenticated', { clientId });
    });
    client.on('auth_failure', () => {
      this.logger.error(`🚫 ${clientId} authentication failed`);
      emit('auth_failure', { clientId });
      this.performCleanup(clientId);
    });
    client.on('ready', async () => {
      try {
        const userInfo = client.info;
        const phoneNumber = userInfo?.wid?.user || 'Unknown';
        const name = userInfo?.pushname || 'Unknown';
        this.logger.log(`📞 ${clientId} logged in as: ${name} (${phoneNumber})`);
        const existingAccount = await this.accountModel.findOne({ phone_number: phoneNumber }, { _id: 1, phone_number: 1 }).lean().exec();
        if (existingAccount) {
          this.logger.warn(`⚠️ Phone number already exists: ${phoneNumber}`);
          emit('phone_exists', { clientId, phoneNumber });
          return;
        }
        await this.accountModel.create({
          name,
          phone_number: phoneNumber,
          user: userId,
          clientId,
          status: 'active',
          created_at: new Date(),
        });
        emit('ready', {
          phoneNumber,
          name,
          clientId,
          status: 'active',
          message: 'WhatsApp client ready and account saved.',
        });
      } catch (error) {
        this.logger.error(`❌ Ready handler error: ${error.message}`);
        emit('initialization_failed', { clientId, error: error.message });
      }
    });
    client.on('disconnected', async (reason) => {
      this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);
      const account = await this.accountModel.findOne({ clientId }).exec();
      if (account) {
        if (reason && (reason.toLowerCase().includes('logout') || reason.toLowerCase().includes('conflict'))) {
          this.logger.log(`🔒 ${clientId} logged out or conflict detected, performing cleanup`);
          await this.accountModel.updateOne({ clientId }, { status: 'disconnected', disconnected_at: new Date() }).exec();
          this.performCleanup(clientId);
        } else {
          this.logger.log(`🔄 ${clientId} disconnected but not logged out, keeping session alive`);
          // Attempt to reconnect
          try {
            await client.initialize();
            const state = await client.getState();
            if (state === 'CONNECTED') {
              await this.accountModel.updateOne({ clientId }, { status: 'active', disconnected_at: null }).exec();
              this.logger.log(`✅ ${clientId} reconnected successfully`);
            }
          } catch (error) {
            this.logger.error(`❌ Reconnection failed for ${clientId}: ${error.message}`);
            await this.accountModel.updateOne({ clientId }, { status: 'disconnected', disconnected_at: new Date() }).exec();
            this.performCleanup(clientId);
          }
        }
      }
    });
  }

  private async handleIncomingMessage(message: Message, clientId: string) {
    try {
      if (message.from.endsWith('@broadcast') || message.fromMe) return;
      const account = await this.accountModel.findOne({ clientId }, { _id: 1, user: 1 }).lean().exec();
      if (!account) {
        this.logger.warn(`📱 No account found for client ${clientId}`);
        return;
      }
      const accountId = account._id.toString();
      const sender = message.from.split('@')[0];
      this.logger.debug(`📨 Message from ${sender} to ${accountId}`);
      await Promise.allSettled(this.messageHandlers.map(handler => handler(message, accountId).catch(err => this.logger.error(`Handler error: ${err.message}`))));
    } catch (error) {
      this.logger.error(`❌ Message handling error: ${error.message}`);
    }
  }

  async sendMessage(clientId: string, to: string[], message: string, delayMs: number = 3000) {
    const client = this.clients.get(clientId);
    if (!client) throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);

    // Check and reconnect if necessary
    let state = await client.getState();
    if (state !== 'CONNECTED') {
      this.logger.warn(`Client ${clientId} is not connected. Current state: ${state}. Attempting to reconnect...`);
      try {
        await client.destroy();
        await client.initialize();
        state = await client.getState();
        if (state !== 'CONNECTED') {
          this.logger.error(`Client ${clientId} failed to reconnect. State: ${state}`);
          throw new HttpException('Client could not reconnect to WhatsApp.', HttpStatus.UNAUTHORIZED);
        }
        this.logger.log(`✅ Client ${clientId} reconnected successfully`);
      } catch (error) {
        this.logger.error(`❌ Failed to reconnect client ${clientId}: ${error.message}`);
        throw new HttpException('Failed to reconnect client state.', HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    if (this.sendingMessages.get(clientId)) {
      throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
    }

    this.sendingMessages.set(clientId, true);
    try {
      this.logger.log(`📤 Starting message resolution and sending for clientId: ${clientId}`);
      const resolvedContent = await this.resolveMessageContent(message, clientId);
      this.logger.debug(`📤 Resolved content to send: ${resolvedContent}`);
      const results: MessageResult[] = [];
      const batchSize = 5;
      const resolvedTo = await this.resolveRecipients(to, clientId);
      this.logger.log(`📤 Sending to ${resolvedTo.length} recipients with ${delayMs}ms delay`);

      if (resolvedTo.length === 0) {
        this.logger.warn(`⚠️ No valid recipients found for clientId: ${clientId}, skipping send operation`);
        return { message: 'No valid recipients found', results: [] };
      }

      for (let i = 0; i < resolvedTo.length; i += batchSize) {
        const batch = resolvedTo.slice(i, i + batchSize);
        const batchPromises = batch.map(async (recipient, batchIndex) => {
          let cleanedRecipient = recipient.startsWith('+') ? recipient.slice(1) : recipient;
          cleanedRecipient = cleanedRecipient.split('@')[0];
          if (!/^\d+$/.test(cleanedRecipient)) {
            this.logger.error(`❌ Invalid phone number format: ${cleanedRecipient}`);
            results.push({ recipient, status: 'failed', error: 'Invalid phone number format: must contain only digits' });
            return;
          }
          const chatId = `${cleanedRecipient}@c.us`;
          const globalIndex = i + batchIndex;
          try {
            await client.sendMessage(chatId, resolvedContent);
            results.push({ recipient, status: 'sent' });
            this.logger.debug(`✅ Sent to ${chatId} (${globalIndex + 1}/${to.length})`);
          } catch (error) {
            this.logger.error(`❌ Failed to send to ${chatId}: ${error.message}`);
            if (error.message.includes('WidFactory')) {
              this.logger.warn(`⚠️ WidFactory error for ${chatId}. Attempting reinitialization...`);
              await client.destroy();
              await client.initialize();
              await client.sendMessage(chatId, resolvedContent); // Retry after reinitialization
              results.push({ recipient, status: 'sent' });
            } else {
              results.push({ recipient, status: 'failed', error: error.message });
            }
          }
        });
        await Promise.allSettled(batchPromises);
        if (i + batchSize < to.length) await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      this.logger.log(`✅ Completed sending to all recipients`);
      return { message: 'Messages sent', results };
    } finally {
      this.sendingMessages.set(clientId, false);
    }
  }

  private performCleanup(clientId: string) {
    this.clients.delete(clientId);
    this.sendingMessages.delete(clientId);
    this.clientReadyPromises.delete(clientId);
    for (const [socketId, mappedClientId] of this.socketClientMap.entries()) {
      if (mappedClientId === clientId) {
        this.socketClientMap.delete(socketId);
        break;
      }
    }
  }

  private cleanupExpiredQRCodes() {
    const now = Date.now();
    for (const [qr, cache] of this.qrCache.entries()) {
      if (now - cache.timestamp > 300000) this.qrCache.delete(qr);
    }
  }

  private cleanupStaleConnections() {
    this.logger.debug('🧹 Performing stale connection cleanup');
  }

  disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    if (!clientId) return;
    setImmediate(async () => {
      try {
        const client = this.clients.get(clientId);
        if (client) await client.destroy();
        await this.accountModel.updateOne(
          { clientId },
          { status: 'disconnected', disconnected_at: new Date() },
        ).exec();
        this.performCleanup(clientId);
        this.logger.log(`🗑️ Cleaned up client ${clientId}`);
      } catch (error) {
        this.logger.error(`❌ Cleanup error: ${error.message}`);
      }
    });
  }

  async deleteAccount(accountId: string) {
    const account = await this.accountModel.findById(accountId).exec();
    if (!account) throw new NotFoundException('Account not found');
    const clientId = account.clientId;
    if (clientId) {
      await this.forceCleanupClient(clientId);
    }
    await this.accountModel.findByIdAndDelete(accountId).exec();
    this.logger.log(`✅ Account ${accountId} and associated client deleted successfully`);
    return { message: 'Account deleted successfully' };
  }
  
  isClientReady(clientId: string): boolean {
    const client = this.clients.get(clientId);
    return client !== undefined && !this.sendingMessages.get(clientId);
  }

  getActiveSessionCount(): number {
    return this.clients.size;
  }

  getAllSessions(): string[] {
    return Array.from(this.clients.keys());
  }

  async getUserAccounts(userId: string) {
    return this.accountModel.find({ user: userId }).lean().exec();
  }

  private async loadClientsFromSessions() {
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(authDir)) {
      this.logger.warn('📁 .wwebjs_auth directory not found');
      return;
    }
    const sessionFiles = fs.readdirSync(authDir).filter(file => file.startsWith('session-'));
    this.logger.log(`📂 Found ${sessionFiles.length} session files to load`);
    const concurrencyLimit = 3;
    const semaphore = Array(concurrencyLimit).fill(null).map(() => Promise.resolve());
    const loadPromises = sessionFiles.map(async (file, index) => {
      const slot = index % concurrencyLimit;
      await semaphore[slot];
      const promise = this.loadSingleSession(file);
      semaphore[slot] = promise.catch(() => {});
      return promise;
    });
    const results = await Promise.allSettled(loadPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    this.logger.log(`✅ Loaded ${successful}/${sessionFiles.length} sessions successfully`);
  }

  private async loadSingleSession(file: string): Promise<void> {
    const clientId = file.replace('session-', '');
    const sessionPath = path.join(process.cwd(), '.wwebjs_auth', file);
    try {
      if (!this.isValidSession(sessionPath)) {
        this.logger.warn(`⚠️ Invalid session ${clientId}, cleaning up`);
        await this.cleanupSession(sessionPath);
        return;
      }
      this.logger.debug(`🔄 Loading session: ${clientId}`);
      const client = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: this.puppeteerConfig,
      });
      client.on('message', async (message) => setImmediate(() => this.handleIncomingMessage(message, clientId)));
      client.on('ready', () => this.logger.log(`✅ Loaded session ${clientId} is ready`));
      client.on('auth_failure', async () => {
        this.logger.error(`🚫 Loaded session ${clientId} auth failed`);
        await this.cleanupSession(sessionPath);
        this.clients.delete(clientId);
      });
      client.on('disconnected', async (reason) => {
        this.logger.warn(`🔌 Loaded session ${clientId} disconnected: ${reason}`);
        await this.accountModel.updateOne(
          { clientId },
          { status: 'disconnected', disconnected_at: new Date() },
        ).exec();
        await this.cleanupSession(sessionPath);
        this.clients.delete(clientId);
      });
      await client.initialize();
      this.clients.set(clientId, client);
      this.logger.debug(`✅ Session ${clientId} loaded successfully`);
    } catch (error) {
      this.logger.error(`❌ Failed to load session ${clientId}: ${error.message}`);
      await this.cleanupSession(sessionPath);
    }
  }

  private isValidSession(sessionPath: string): boolean {
    try {
      if (!fs.existsSync(sessionPath)) return false;
      const defaultPath = path.join(sessionPath, 'Default');
      if (!fs.existsSync(defaultPath)) return false;
      const cleanupFlag = path.join(sessionPath, '.cleanup_required');
      if (fs.existsSync(cleanupFlag)) return false;
      const stats = fs.statSync(defaultPath);
      if (!stats.isDirectory()) return false;
      const files = fs.readdirSync(defaultPath);
      const hasRequiredFiles = files.some(file =>
        file.includes('Cookies') || file.includes('Local State') || file.includes('Preferences'),
      );
      return hasRequiredFiles && files.length > 2;
    } catch (error) {
      this.logger.error(`❌ Session validation error: ${error.message}`);
      return false;
    }
  }

  private async cleanupMarkedSessions(): Promise<void> {
    try {
      const authDir = path.join(process.cwd(), '.wwebjs_auth');
      if (!fs.existsSync(authDir)) return;
      const sessionDirs = fs.readdirSync(authDir)
        .filter(dir => dir.startsWith('session-'))
        .map(dir => path.join(authDir, dir));
      for (const sessionPath of sessionDirs) {
        const flagFile = path.join(sessionPath, '.cleanup_required');
        if (fs.existsSync(flagFile)) {
          this.logger.log(`🧹 Attempting cleanup of marked session: ${sessionPath}`);
          await this.forceRemoveDirectory(sessionPath);
        }
      }
    } catch (error) {
      this.logger.error(`Error cleaning marked sessions: ${error.message}`);
    }
  }

  private async cleanupSession(sessionPath: string): Promise<void> {
    try {
      if (!fs.existsSync(sessionPath)) {
        this.logger.debug(`📁 Session path doesn't exist: ${sessionPath}`);
        return;
      }
      this.logger.debug(`🧹 Starting cleanup of session: ${sessionPath}`);
      await this.forceRemoveDirectory(sessionPath, 3);
      this.logger.debug(`✅ Successfully cleaned up session: ${sessionPath}`);
    } catch (error) {
      this.logger.error(`❌ Session cleanup failed: ${error.message}`);
      await this.alternativeCleanup(sessionPath);
    }
  }

  private async forceRemoveDirectory(dirPath: string, retries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (fs.promises.rm) {
          await fs.promises.rm(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          return;
        }
        await fs.promises.rmdir(dirPath, { recursive: true });
        return;
      } catch (error) {
        this.logger.warn(`🔄 Cleanup attempt ${attempt}/${retries} failed: ${error.message}`);
        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  private async alternativeCleanup(sessionPath: string): Promise<void> {
    try {
      this.logger.warn(`🔧 Attempting alternative cleanup for: ${sessionPath}`);
      try { await this.unlockDirectory(sessionPath); } catch {}
      await this.recursiveDelete(sessionPath);
    } catch (error) {
      this.logger.error(`💥 Alternative cleanup also failed: ${error.message}`);
      await this.systemCleanup(sessionPath);
    }
  }

  private async recursiveDelete(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;
    const stats = await fs.promises.lstat(dirPath);
    if (stats.isDirectory()) {
      const entries = await fs.promises.readdir(dirPath);
      await Promise.all(entries.map(entry => this.recursiveDelete(path.join(dirPath, entry))));
      await fs.promises.rmdir(dirPath);
    } else {
      await fs.promises.unlink(dirPath);
    }
  }

  private async unlockDirectory(dirPath: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    try {
      await execAsync(`chmod -R 755 "${dirPath}"`);
      this.logger.debug(`🔓 Changed permissions for: ${dirPath}`);
    } catch {}
  }

  private async systemCleanup(sessionPath: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    try {
      this.logger.warn(`🔨 Using system command to cleanup: ${sessionPath}`);
      if (process.platform !== 'win32') await execAsync(`rm -rf "${sessionPath}"`);
      else await execAsync(`rmdir /s /q "${sessionPath}"`);
      this.logger.log(`✅ System cleanup successful: ${sessionPath}`);
    } catch (error) {
      this.logger.error(`💀 System cleanup failed: ${error.message}`);
      this.markForManualCleanup(sessionPath);
    }
  }

  private markForManualCleanup(sessionPath: string): void {
    try {
      const flagFile = path.join(sessionPath, '.cleanup_required');
      fs.writeFileSync(flagFile, `Cleanup required at: ${new Date().toISOString()}`);
      this.logger.warn(`🏷️ Marked for manual cleanup: ${sessionPath}`);
    } catch (error) {
      this.logger.error(`Failed to mark for cleanup: ${error.message}`);
    }
  }

  async getClientInfo(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return null;
    try {
      const info = client.info;
      const account = await this.accountModel.findOne(
        { clientId },
        { name: 1, phone_number: 1, status: 1, created_at: 1 },
      ).lean().exec();
      return {
        clientId,
        isReady: this.isClientReady(clientId),
        isSending: this.sendingMessages.get(clientId) || false,
        whatsappInfo: {
          phoneNumber: info?.wid?.user || 'Unknown',
          name: info?.pushname || 'Unknown',
          platform: info?.platform || 'Unknown',
        },
        accountInfo: account,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(`❌ Error getting client info: ${error.message}`);
      return null;
    }
  }

  

  getHealthStatus() {
    const totalClients = this.clients.size;
    const activeSending = Array.from(this.sendingMessages.values()).filter(Boolean).length;
    const qrCacheSize = this.qrCache.size;
    return {
      status: 'healthy',
      metrics: { totalClients, activeSending, qrCacheSize, initializationQueue: this.initializationQueue.size, socketMappings: this.socketClientMap.size },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
      timestamp: Date.now(),
    };
  }

  async forceCleanupClient(clientId: string) {
  try {
    const client = this.clients.get(clientId);

    if (client) {
  try {
    await client.destroy();
    this.logger.log(`🔌 Client destroyed: ${clientId}`);
  } catch (err) {
    this.logger.warn(`⚠️ Failed to destroy client: ${err.message}`);
  }

  // Wait a short delay to allow Chrome to release file handles
  await new Promise(res => setTimeout(res, 1500));
}

    // 🧹 Delete auth session folder
    // const sessionPath = join(__dirname, '..', '..', '.wwebjs_auth', `session-${clientId}`);
    // try {
    //   rmSync(sessionPath, { recursive: true, force: true });
    //   this.logger.log(`🗑️ Deleted session folder for client: ${clientId}`);
    // } catch (fsErr) {
    //   this.logger.warn(`⚠️ Failed to delete session folder for client ${clientId}: ${fsErr.message}`);
    // }

    // Mark account as force-disconnected in DB
    await this.accountModel.updateOne(
      { clientId },
      { status: 'force_disconnected', disconnected_at: new Date() },
    ).exec();

    this.performCleanup(clientId);

    this.logger.log(`🔨 Force cleaned up client: ${clientId}`);
    return true;
  } catch (error) {
    this.logger.error(`❌ Force cleanup failed: ${error.message}`);
    return false;
  }
}

}