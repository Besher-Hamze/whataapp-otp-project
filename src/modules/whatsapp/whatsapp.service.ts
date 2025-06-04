import { 
  ConflictException, 
  HttpException, 
  HttpStatus, 
  Injectable, 
  Logger, 
  NotFoundException, 
  OnModuleInit 
} from '@nestjs/common';
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

interface ClientState {
  client: Client;
  userId: string;
  isReady: boolean;
  isSending: boolean;
  lastActivity: number;
  reconnectAttempts: number;
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
  private readonly clientStates = new Map<string, ClientState>();
  private readonly socketClientMap = new Map<string, string>();
  private readonly messageHandlers: Array<(message: any, accountId: string) => Promise<void>> = [];
  private readonly qrCache = new Map<string, QRGenerationCache>();
  private readonly clientReadyPromises = new Map<string, Promise<void>>();
  private readonly initializationQueue = new Map<string, Promise<any>>();
  private readonly pendingCleanups = new Set<string>();
  
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 5000;
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly RECONNECT_INTERVAL = 5000; // 5 seconds
  private readonly QR_CACHE_DURATION = 30000; // 30 seconds
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

  async onModuleInit() {
    setTimeout(() => this.loadClientsFromSessions(), 5000);
    setInterval(() => this.cleanupInactiveSessions(), 600000); // Every 10 minutes
    
  }

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
          if (Array.isArray(group.contacts)) {
            for (const contactItem of group.contacts) {
              if (typeof contactItem === 'object' && contactItem !== null && 'phone_number' in contactItem && typeof contactItem.phone_number === 'string') {
                this.logger.log(`✅ Added contact phone number from group (object): ${contactItem.phone_number}`);
                resolvedNumbersSet.add(contactItem.phone_number);
              } else if (isValidObjectId(contactItem)) {
                const contactId = contactItem.toString();
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
          return message;
        }
        this.logger.error(`❌ Unexpected error resolving template ${message}: ${error.message}`);
        throw error;
      }
    }

    this.logger.debug(`🔍 Input "${message}" is not a valid ObjectId, treating as raw message`);
    return message;
  }

  registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>) {
    this.logger.log('📝 Registering new message handler');
    this.messageHandlers.push(handler);
  }

 private async loadClientsFromSessions() {
  const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    const sessionFolders = fs.readdirSync(sessionDir);

    for (const folder of sessionFolders) {
      if (!folder.startsWith('session-')) continue;
      const clientId = folder.replace('session-', '');
      const sessionPath = path.join(sessionDir, folder);

      if (!this.isValidSession(sessionPath)) {
        this.cleanupSessionFiles(clientId);
        continue;
      }

      const account = await this.accountModel.findOne({ clientId }).lean().exec();
      if (!account || account.status !== 'active') continue; // Only restore active accounts

      const client = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: this.puppeteerConfig,
      });

      const clientState: ClientState = {
        client,
        userId: account.user.toString(),
        isReady: false,
        isSending: false,
        lastActivity: Date.now(),
        reconnectAttempts: 0,
      };

      this.clientStates.set(clientId, clientState);
      this.setupClientEventHandlers(client, clientId, () => {}, clientState.userId);

      try {
        client.initialize();
        this.logger.log(`✅ Restored session ${clientId} for user ${clientState.userId}`);
      } catch (error) {
        this.logger.error(`❌ Failed to restore session ${clientId}: ${error.message}`);
        this.cleanupSessionFiles(clientId);
        this.clientStates.delete(clientId);
      }
    }
  } catch (error) {
    this.logger.error(`❌ Failed to load sessions: ${error.message}`);
  }
}
  
  async startSession(socketClientId: string, userId: string,  emit: (event: string, data: any) => void, accountId?: string) {
  this.logger.log(`🚀 Attempting to start or reuse session for userId: ${userId}, accountId: ${accountId || 'new'}, socket: ${socketClientId}`);

  if (this.socketClientMap.has(socketClientId)) {
    const existingClientId = this.socketClientMap.get(socketClientId)!;
    const clientState = this.clientStates.get(existingClientId);
    if (clientState?.client && clientState.isReady) {
      this.logger.log(`✅ Reusing existing session for socket: ${socketClientId}, clientId: ${existingClientId}`);
      return { clientId: existingClientId };
    }
  }

  if (this.initializationQueue.has(socketClientId)) {
    this.logger.warn(`🔄 Session initialization already in progress for: ${socketClientId}`);
    return this.initializationQueue.get(socketClientId)!;
  }

  // Generate a default accountId if not provided
  const finalAccountId = accountId || uuidv4();
  const initPromise = this.doStartSession(socketClientId, userId, finalAccountId, emit);
  this.initializationQueue.set(socketClientId, initPromise);

  try {
    const result = await initPromise;
    return result;
  } finally {
    this.initializationQueue.delete(socketClientId);
  }
}

  private async doStartSession(socketClientId: string, userId: string, accountId: string, emit: (event: string, data: any) => void) {
  // Rest of the method remains the same
  const startTime = Date.now();
  this.logger.log(`🚀 Starting session for socket: ${socketClientId}, accountId: ${accountId}`);
  this.socketClientMap.set(socketClientId, accountId); // Using accountId as clientId for simplicity

  try {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: accountId }),
      puppeteer: this.puppeteerConfig,
    });

    const clientState: ClientState = {
      client,
      userId,
      isReady: false,
      isSending: false,
      lastActivity: Date.now(),
      reconnectAttempts: 0,
    };

    this.clientStates.set(accountId, clientState);
    this.setupClientEventHandlers(client, accountId, emit, userId);

    let readyResolve: () => void;
    const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });
    this.clientReadyPromises.set(accountId, readyPromise);

    client.once('ready', async () => {
      const duration = Date.now() - startTime;
      this.logger.log(`✅ Client ${accountId} ready in ${duration}ms`);
      clientState.isReady = true;
      clientState.lastActivity = Date.now();
      readyResolve!();
    });

    const initTimeout = setTimeout(() => {
      this.logger.error(`⏰ Client ${accountId} initialization timeout`);
      emit('initialization_failed', { clientId: accountId });
    }, 120000);

    await client.initialize();
    clearTimeout(initTimeout);

    const duration = Date.now() - startTime;
    this.logger.log(`🎉 Session ${accountId} started in ${duration}ms`);
    return { clientId: accountId };
  } catch (error) {
    this.logger.error(`❌ Failed to start session ${accountId}: ${error.message}`);
    this.clientStates.delete(accountId);
    this.socketClientMap.delete(socketClientId);
    this.clientReadyPromises.delete(accountId);
    emit('initialization_failed', {
      clientId: accountId,
      error: error.message,
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

private setupClientEventHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, userId: string) {
  const clientState = this.clientStates.get(clientId);
  if (!clientState) return;

  client.on('qr', (qr) => {
    const qrStartTime = Date.now();
    this.logger.log(`📱 QR received for ${clientId} - generating...`);

    try {
      const cached = this.qrCache.get(qr);
      if (cached && Date.now() - cached.timestamp < this.QR_CACHE_DURATION) {
        emit('qr', { clientId, qr: cached.dataUrl });
        return;
      }

      QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
        width: 256,
      }, (err, qrDataUrl) => {
        if (err) {
          this.logger.error(`❌ QR generation failed: ${err.message}`);
          emit('initialization_failed', { clientId, error: err.message });
          return;
        }

        this.qrCache.set(qr, { qr, dataUrl: qrDataUrl, timestamp: Date.now() });
        emit('qr', { clientId, qr: qrDataUrl });
        qrcodeTerminal.generate(qr, { small: true });
        this.logger.log(`✅ QR generated and sent in ${Date.now() - qrStartTime}ms`);
      });
    } catch (error) {
      this.logger.error(`❌ QR generation failed: ${error.message}`);
      emit('initialization_failed', { clientId, error: error.message });
    }
  });

  client.on('message', (message) => {
    setImmediate(() => this.handleIncomingMessage(message, clientId));
    clientState.lastActivity = Date.now();
  });

  client.on('authenticated', () => {
    this.logger.log(`🔐 ${clientId} authenticated`);
    emit('authenticated', { clientId });
    clientState.lastActivity = Date.now();
  });

  client.on('auth_failure', () => {
    this.logger.error(`🚫 ${clientId} authentication failed`);
    emit('auth_failure', { clientId });
  });

  client.on('ready', async () => {
    try {
      const userInfo = client.info;
      const phoneNumber = userInfo?.wid?.user || 'Unknown';
      const name = userInfo?.pushname || 'Unknown';

      this.logger.log(`📞 ${clientId} logged in as: ${name} (${phoneNumber})`);

      // Check if an account with this phone number already exists
      const existingAccount = await this.accountModel.findOne({
        phone_number: phoneNumber,
      }).lean().exec();

      if (existingAccount) {
        // Check if the phone number is associated with a different user
        if (existingAccount.user.toString() !== userId) {
          this.logger.error(`🚫 Phone number ${phoneNumber} is already associated with user ${existingAccount.user}`);
          emit('initialization_failed', {
            clientId,
            error: `Phone number ${phoneNumber} is already in use by another user.`,
          });
          await this.destroyClientSafely(client, clientId); // Destroy the client to prevent further use
          return;
        }

        // If it's the same user, update clientId if changed
        if (existingAccount.clientId !== clientId) {
          await this.accountModel.updateOne(
            { _id: existingAccount._id },
            { clientId, status: 'active' }
          ).exec();
          this.logger.log(`🔄 Updated clientId for account ${existingAccount._id} to ${clientId}`);
        }
      } else {
        // Create a new account with the single user
        await this.accountModel.create({
          name,
          phone_number: phoneNumber,
          user: userId, // Use single user field
          clientId,
          status: 'active',
          created_at: new Date(),
        });
        this.logger.log(`✅ Created new account for ${phoneNumber} with clientId ${clientId} and user ${userId}`);
      }

      clientState.isReady = true;
      clientState.lastActivity = Date.now();
      clientState.reconnectAttempts = 0;

      emit('ready', {
        phoneNumber,
        name,
        clientId,
        status: 'active',
        message: 'WhatsApp client ready and account saved/updated.',
      });
    } catch (error) {
      this.logger.error(`❌ Ready handler error: ${error.message}`);
      emit('initialization_failed', { clientId, error: error.message });
    }
  });

  client.on('disconnected', async (reason) => {
    this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);

    try {
      const clientState = this.clientStates.get(clientId);
      if (!clientState) return;

      const isLogout = reason && (
        reason.toLowerCase().includes('logout') ||
        reason.toLowerCase().includes('conflict') ||
        reason.toLowerCase().includes('logged out')
      );

      if (isLogout) {
        this.logger.log(`🔒 ${clientId} detected as logged out due to: ${reason}`);

        // Remove event listeners to prevent further activity
        client.removeAllListeners();

        // Destroy the client to release resources
        try {
          await this.destroyClientSafely(clientState.client, clientId);
          this.logger.log(`✅ Client ${clientId} destroyed successfully`);
        } catch (destroyError) {
          this.logger.error(`❌ Failed to destroy client ${clientId}: ${destroyError.message}`);
        }

        // Schedule cleanup with a delay to ensure file handles are released
        await this.accountModel.updateOne(
          { clientId },
          { status: 'disconnected', disconnected_at: new Date(), clientId: null }
        ).exec();
        this.scheduleCleanup(clientId, `Logged out: ${reason}`, 5000); // 5-second delay
      } else {
        this.logger.log(`🔄 ${clientId} disconnected but not logged out, attempting reconnection`);
        emit('reconnecting', { clientId, reason });
        const account = await this.accountModel.findOne({ clientId }).exec();
        if (account) {
          await this.handleReconnection(clientId, account._id.toString());
        }
      }
    } catch (error) {
      this.logger.error(`❌ Disconnect handler error for ${clientId}: ${error.message}`);
    }
  });

  client.on('destroy', () => {
    this.logger.log(`💥 Client ${clientId} destroyed`);
    if (clientState) {
      clientState.isReady = false;
    }
  });

  client.on('error', (error) => {
    this.logger.error(`🚫 Client ${clientId} error: ${error.message}`);
    if (error.message.includes('Session closed') ||
        error.message.includes('Protocol error') ||
        error.message.includes('Target closed')) {
      this.logger.warn(`🔧 Critical error detected for ${clientId}`);
      emit('error', { clientId, error: error.message });
    }
  });
}
  private async handleReconnection(clientId: string, accountId: string) {
    const clientState = this.clientStates.get(clientId);
    if (!clientState) {
      this.logger.warn(`🚫 Cannot reconnect ${clientId}: Client state not found`);
      return;
    }

    while (true) {
      clientState.reconnectAttempts++;
      this.logger.log(`🔄 Reconnection attempt ${clientState.reconnectAttempts} for ${clientId}`);

      try {
        await clientState.client.initialize();
        this.logger.log(`✅ Reconnected successfully for ${clientId}`);
        clientState.isReady = true;
        clientState.reconnectAttempts = 0;
        clientState.lastActivity = Date.now();
        break;
      } catch (error) {
        this.logger.error(`❌ Reconnection attempt ${clientState.reconnectAttempts} failed for ${clientId}: ${error.message}`);
        if (clientState.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
          this.logger.warn(`⛔ Max reconnection attempts reached for ${clientId}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, this.RECONNECT_INTERVAL));
      }
    }
  }

  async disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    if (!clientId) {
      this.logger.debug(`No client mapped to socket ${socketClientId}`);
      return;
    }

    const clientState = this.clientStates.get(clientId);
    if (!clientState) {
      this.logger.warn(`Client state for ${clientId} not found during disconnect`);
      this.socketClientMap.delete(socketClientId);
      return;
    }

    this.logger.log(`🔌 Disconnecting client ${clientId} due to socket ${socketClientId} disconnect`);
    await this.cleanupClient(clientId, `Socket ${socketClientId} disconnected`);
  }

  async forceCleanupClient(clientId: string): Promise<boolean> {
    try {
      this.logger.log(`🔨 Initiating force cleanup for client ${clientId}`);
      await this.cleanupClient(clientId, 'Force cleanup requested', true); // Force cache cleanup
      return true;
    } catch (error) {
      this.logger.error(`❌ Force cleanup failed for ${clientId}: ${error.message}`);
      return false;
    }
  }
  
private async scheduleCleanup(clientId: string, reason: string, delayMs: number = 5000) {
  if (this.pendingCleanups.has(clientId)) return;
  this.pendingCleanups.add(clientId);

  this.logger.log(`🕒 Scheduling cleanup for ${clientId} in ${delayMs}ms: ${reason}`);
  setTimeout(async () => {
    try {
      await this.cleanupClient(clientId, reason, true); // Force cleanup
    } catch (error) {
      this.logger.error(`❌ Cleanup failed for ${clientId}: ${error.message}`);
    } finally {
      this.pendingCleanups.delete(clientId);
    }
  }, delayMs);
}

private async cleanupClient(clientId: string, reason: string, forceCacheCleanup: boolean = false) {
  const clientState = this.clientStates.get(clientId);
  if (!clientState) {
    this.logger.warn(`Client state for ${clientId} not found during cleanup`);
    return;
  }

  this.logger.log(`🧹 Cleaning up client ${clientId}: ${reason}`);
  clientState.isReady = false;
  clientState.isSending = false;

  try {
    await clientState.client.destroy().catch(err => this.logger.warn(`Error destroying client: ${err.message}`));
  } catch (error) {
    this.logger.error(`❌ Error destroying client ${clientId}: ${error.message}`);
  }

  const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);
  for (let attempt = 1; attempt <= 3; attempt++) { // Retry up to 3 times
    try {
      if (fs.existsSync(sessionPath)) {
        rmSync(sessionPath, { recursive: true, force: true });
        this.logger.log(`🗑️ Session files deleted for ${clientId} on attempt ${attempt}`);
        break;
      }
    } catch (error) {
      this.logger.error(`❌ Attempt ${attempt} failed to delete session files for ${clientId}: ${error.message}`);
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
    }
  }

  if (forceCacheCleanup || this.clientStates.size === 1) {
    await this.cleanupCacheFiles().catch(err => this.logger.warn(`Error cleaning cache files: ${err.message}`));
  }

  this.clientStates.delete(clientId);
  this.clientReadyPromises.delete(clientId);

  for (const [socketId, mappedClientId] of this.socketClientMap.entries()) {
    if (mappedClientId === clientId) {
      this.socketClientMap.delete(socketId);
    }
  }

  this.logger.log(`✅ Cleanup completed for ${clientId}`);
}

  private async cleanupSessionFiles(clientId: string) {
    const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${clientId}`);
    try {
      if (fs.existsSync(sessionPath)) {
        rmSync(sessionPath, { recursive: true, force: true });
        this.logger.log(`🗑️ Session files deleted for ${clientId}`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to delete session files for ${clientId}: ${error.message}`);
    }
  }

  private async cleanupCacheFiles() {
    const cachePath = path.join(process.cwd(), '.wwebjs_cache');
    try {
      if (fs.existsSync(cachePath)) {
        rmSync(cachePath, { recursive: true, force: true });
        this.logger.log(`🗑️ Cache files deleted for ${cachePath}`);
        fs.mkdirSync(cachePath, { recursive: true });
      }
    } catch (error) {
      this.logger.error(`❌ Failed to delete cache files for ${cachePath}: ${error.message}`);
    }
  }

 private isValidSession(sessionPath: string): boolean { // Remove async
  try {
    const stats = fs.statSync(sessionPath);
    if (!stats.isDirectory()) return false;

    const files = fs.readdirSync(sessionPath);
    return files.length > 0 && files.some(file => file === 'session.json');
  } catch (error) {
    return false;
  }
}

  private cleanupOrphanedSessions() {
    const sessionDir = path.join(process.cwd(), '.wwebjs_auth');
    try {
      if (!fs.existsSync(sessionDir)) return;

      const sessionFolders = fs.readdirSync(sessionDir);
      const accounts = this.accountModel.find({ clientId: { $ne: null } }).lean().exec();

      let cleanedCount = 0;
      for (const folder of sessionFolders) {
        if (!folder.startsWith('session-')) continue;
        const clientId = folder.replace('session-', '');
        const sessionPath = path.join(sessionDir, folder);

        if (!this.clientStates.has(clientId) || !this.isValidSession(sessionPath)) {
          this.cleanupSessionFiles(clientId);
          this.clientStates.delete(clientId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`🧹 Cleaned up ${cleanedCount} orphaned sessions`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to cleanup orphaned sessions: ${error.message}`);
    }
  }

  private cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveClientIds: string[] = [];

    for (const [clientId, clientState] of this.clientStates) {
      if (now - clientState.lastActivity > this.SESSION_TIMEOUT && !clientState.isSending) {
        inactiveClientIds.push(clientId);
      }
    }

    inactiveClientIds.forEach(clientId => {
      this.logger.log(`🕒 Cleaning up inactive session ${clientId}`);
      this.scheduleCleanup(clientId, 'Inactive session timeout');
    });

    if (inactiveClientIds.length > 0) {
      this.logger.log(`🧹 Cleaned up ${inactiveClientIds.length} inactive sessions`);
    }
  }

  async getClientInfo(clientId: string) {
    const clientState = this.clientStates.get(clientId);
    if (!clientState) return null;

    return {
      clientId,
      isReady: clientState.isReady,
      isSending: clientState.isSending,
      lastActivity: clientState.lastActivity,
      reconnectAttempts: clientState.reconnectAttempts,
    };
  }

  isClientReady(clientId: string): boolean {
    const clientState = this.clientStates.get(clientId);
    return clientState?.isReady || false;
  }

  async getUserAccounts(userId: string) {
    return await this.accountModel.find({ user: userId }).lean().exec();
  }

  async deleteAccount(accountId: string) {
    const account = await this.accountModel.findById(accountId).exec();
    if (!account) {
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }

    if (account.clientId) {
      this.scheduleCleanup(account.clientId, `Account ${accountId} deleted`);
    }

    await this.accountModel.deleteOne({ _id: accountId }).exec();
    return { message: 'Account deleted successfully' };
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      metrics: {
        totalClients: this.clientStates.size,
        readyClients: Array.from(this.clientStates.values()).filter(c => c.isReady).length,
        sendingClients: Array.from(this.clientStates.values()).filter(c => c.isSending).length,
      },
      timestamp: Date.now(),
    };
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
    
    this.logger.debug(`📨 Message from ${sender} to account ${accountId} (user: ${account.user})`);
    
    // Update last activity
    const clientState = this.clientStates.get(clientId);
    if (clientState) {
      clientState.lastActivity = Date.now();
    }

    // Process message handlers
    await Promise.allSettled(
      this.messageHandlers.map(handler => 
        handler(message, accountId).catch(err => 
          this.logger.error(`Handler error: ${err.message}`)
        )
      )
    );
  } catch (error) {
    this.logger.error(`❌ Message handling error: ${error.message}`);
  }
}

  async sendMessage(clientId: string, to: string[], message: string, delayMs: number = 3000) {
    const clientState = this.clientStates.get(clientId);
    if (!clientState?.client) {
      throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
    }

    if (clientState.isSending) {
      throw new HttpException('Already sending messages from this account. Please wait.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Check client state before proceeding
    if (!clientState.isReady) {
      throw new HttpException('WhatsApp client is not ready. Please wait for initialization.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Check and ensure client is connected
    let state;
    try {
      state = await clientState.client.getState();
    } catch (error) {
      this.logger.error(`❌ Failed to get client state for ${clientId}: ${error.message}`);
      throw new HttpException('Client state unavailable. Session may be disconnected.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (state !== 'CONNECTED') {
      this.logger.warn(`Client ${clientId} is not connected. Current state: ${state}. Attempting to reconnect...`);
      
      try {
        // Try to reinitialize the client
        await this.reinitializeClient(clientState, clientId);
        
        // Wait a bit and check state again
        await new Promise(resolve => setTimeout(resolve, 2000));
        state = await clientState.client.getState();
        
        if (state !== 'CONNECTED') {
          throw new Error(`Client failed to reconnect. State: ${state}`);
        }
        
        this.logger.log(`✅ Client ${clientId} reconnected successfully`);
      } catch (error) {
        this.logger.error(`❌ Failed to reconnect client ${clientId}: ${error.message}`);
        throw new HttpException('Client could not reconnect to WhatsApp.', HttpStatus.UNAUTHORIZED);
      }
    }

    clientState.isSending = true;
    clientState.lastActivity = Date.now();

    try {
      this.logger.log(`📤 Starting message resolution and sending for clientId: ${clientId}`);
      
      const resolvedContent = await this.resolveMessageContent(message, clientId);
      this.logger.debug(`📤 Resolved content to send: ${resolvedContent}`);
      
      const resolvedTo = await this.resolveRecipients(to, clientId);
      this.logger.log(`📤 Sending to ${resolvedTo.length} recipients with ${delayMs}ms delay`);

      if (resolvedTo.length === 0) {
        this.logger.warn(`⚠️ No valid recipients found for clientId: ${clientId}, skipping send operation`);
        return { message: 'No valid recipients found', results: [] };
      }

      const results: MessageResult[] = [];
      const batchSize = 5;

      for (let i = 0; i < resolvedTo.length; i += batchSize) {
        const batch = resolvedTo.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (recipient, batchIndex) => {
          let cleanedRecipient = recipient.startsWith('+') ? recipient.slice(1) : recipient;
          cleanedRecipient = cleanedRecipient.split('@')[0];
          
          if (!/^\d+$/.test(cleanedRecipient)) {
            this.logger.error(`❌ Invalid phone number format: ${cleanedRecipient}`);
            results.push({ 
              recipient, 
              status: 'failed', 
              error: 'Invalid phone number format: must contain only digits' 
            });
            return;
          }

          const chatId = `${cleanedRecipient}@c.us`;
          const globalIndex = i + batchIndex;

          try {
            await clientState.client.sendMessage(chatId, resolvedContent);
            results.push({ recipient, status: 'sent' });
            this.logger.debug(`✅ Sent to ${chatId} (${globalIndex + 1}/${resolvedTo.length})`);
            
            // Update last activity
            clientState.lastActivity = Date.now();
            
          } catch (error) {
            this.logger.error(`❌ Failed to send to ${chatId}: ${error.message}`);
            
            // Check for critical errors that indicate session issues
            if (error.message.includes('Session closed') || 
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed') ||
                error.message.includes('WidFactory')) {
              
              this.logger.warn(`⚠️ Critical error detected for ${chatId}. Session may be compromised.`);
              results.push({ 
                recipient, 
                status: 'failed', 
                error: 'Session error - client may need reinitialization' 
              });
              
              // Stop sending to prevent further errors
              // break;
            } else {
              results.push({ recipient, status: 'failed', error: error.message });
            }
          }
        });

        await Promise.allSettled(batchPromises);
        
        // Add delay between batches
        if (i + batchSize < resolvedTo.length) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      this.logger.log(`✅ Completed sending to all recipients`);
      return { message: 'Messages sent', results };
      
    } finally {
      clientState.isSending = false;
    }
  }

  private async reinitializeClient(clientState: ClientState, clientId: string) {
    this.logger.log(`🔄 Reinitializing client ${clientId}`);
    
    try {
      // Remove all listeners first
      clientState.client.removeAllListeners();
      
      // Destroy the old client instance
      await this.destroyClientSafely(clientState.client, clientId);
      
      // Create a new client instance
      const newClient = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: this.puppeteerConfig,
      });
      
      // Update the client state
      clientState.client = newClient;
      clientState.isReady = false;
      clientState.reconnectAttempts++;
      
      // Set up basic event handlers
      this.setupBasicEventHandlers(newClient, clientId, clientState);
      
      // Initialize the new client
      await newClient.initialize();
      
      // Wait for ready state
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Reinitialization timeout'));
        }, 30000);
        
        newClient.once('ready', () => {
          clearTimeout(timeout);
          clientState.isReady = true;
          clientState.lastActivity = Date.now();
          resolve(undefined);
        });
        
        newClient.once('auth_failure', () => {
          clearTimeout(timeout);
          reject(new Error('Authentication failed during reinitialization'));
        });
      });
      
      this.logger.log(`✅ Client ${clientId} reinitialized successfully`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to reinitialize client ${clientId}: ${error.message}`);
      throw error;
    }
  }

 private setupBasicEventHandlers(client: Client, clientId: string, clientState: ClientState) {
  client.on('message', async (message) => {
    setImmediate(() => this.handleIncomingMessage(message, clientId));
    clientState.lastActivity = Date.now();
  });

  client.on('disconnected', async (reason) => {
    this.logger.warn(`🔌 Reinitialized client ${clientId} disconnected: ${reason}`);

    try {
      const isLogout = reason && (
        reason.toLowerCase().includes('logout') ||
        reason.toLowerCase().includes('conflict') ||
        reason.toLowerCase().includes('logged out')
      );

      if (isLogout) {
        this.logger.log(`🔒 Reinitialized client ${clientId} detected as logged out due to: ${reason}`);

        // Remove event listeners to prevent further activity
        client.removeAllListeners();

        // Destroy the client to release resources
        try {
          await this.destroyClientSafely(client, clientId);
          this.logger.log(`✅ Reinitialized client ${clientId} destroyed successfully`);
        } catch (destroyError) {
          this.logger.error(`❌ Failed to destroy reinitialized client ${clientId}: ${destroyError.message}`);
        }

        // Schedule cleanup with a delay to ensure file handles are released
        this.scheduleCleanup(clientId, `Reinitialized client logged out: ${reason}`, 5000); // 5-second delay
      }
    } catch (error) {
      this.logger.error(`❌ Disconnect handler error for reinitialized client ${clientId}: ${error.message}`);
    }
  });

  client.on('error', (error) => {
    this.logger.error(`🚫 Reinitialized client ${clientId} error: ${error.message}`);
  });
}

  private async destroyClientSafely(client: Client, clientId: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const destroyTimeout = setTimeout(() => {
      this.logger.warn(`⏰ Client destruction timeout for ${clientId}, forcing completion`);
      resolve(); // Continue even if timeout occurs
    }, 10000); // 10-second timeout

    try {
      // Get the Puppeteer browser instance
      const browser = (client as any).pupBrowser;
      if (browser) {
        try {
          const pages = await browser.pages().catch(() => []);
          await Promise.all(
            pages.map((page: any) => page.close().catch(err => this.logger.debug(`Error closing page: ${err.message}`)))
          );
          await browser.close().catch(err => this.logger.warn(`Error closing browser: ${err.message}`));
          this.logger.debug(`🌐 Browser closed manually for ${clientId}`);
        } catch (browserError) {
          this.logger.warn(`⚠️ Error closing browser manually: ${browserError.message}`);
        }
      }

      // Destroy the client
      await client.destroy().catch(err => this.logger.warn(`Error destroying client: ${err.message}`));
      clearTimeout(destroyTimeout);
      resolve();
    } catch (error) {
      clearTimeout(destroyTimeout);
      this.logger.warn(`⚠️ Client destroy error (continuing): ${error.message}`);
      resolve(); // Continue cleanup even if destroy fails
    }
  });
}

  getActiveSessionCount(): number {
    return this.clientStates.size;
  }

  getAllSessions(): string[] {
    return Array.from(this.clientStates.keys());
  }
}