import { Injectable, Logger, OnModuleInit, HttpException, HttpStatus } from '@nestjs/common';
import { SessionManagerService } from './services/session-manager.service';
import { EventHandlerService } from './services/event-handler.service';
import { MessageSenderService } from './services/message-sender.service';
import { MessageHandlerService } from './services/message-handler.service';
import { FileManagerService } from './services/file-manager.service';
import { AccountService } from './services/account.service';
import { SessionRestorationService } from './services/session-restoration.service';
import { CleanupService } from './services/cleanup.service';
import { v4 as uuidv4 } from 'uuid';
import { ContactsService } from '../contacts/contacts.service';

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly initializationQueue = new Map<string, Promise<any>>();

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly eventHandler: EventHandlerService,
    private readonly messageSender: MessageSenderService,
    private readonly messageHandler: MessageHandlerService,
    private readonly fileManager: FileManagerService,
    private readonly accountService: AccountService,
    private readonly sessionRestoration: SessionRestorationService,
    private readonly cleanupService: CleanupService,
    private readonly contactsService: ContactsService,
  ) { }

  async onModuleInit() {
    this.logger.log('🚀 WhatsApp Service initializing...');

    // Restore existing sessions after a delay to ensure all services are ready
    setTimeout(async () => {
      this.logger.log('🔄 Starting session restoration...');
      await this.sessionRestoration.loadClientsFromSessions();
      this.logger.log(`✅ Session restoration completed. Active sessions: ${this.getActiveSessionCount()}`);
    }, 5000);

    // Cleanup inactive sessions every 10 minutes
    setInterval(() => {
      this.cleanupService.cleanupInactiveSessions();
    }, 600000);

    this.logger.log('✅ WhatsApp Service initialized successfully');
  }

  async startSession(
    socketClientId: string,
    userId: string,
    emit: (event: string, data: any) => void,
    accountId?: string
  ) {
    this.logger.log(`🚀 Attempting to start session for userId: ${userId}, accountId: ${accountId || 'new'}`);

    // Check for existing socket mapping
    if (this.sessionManager.getClientIdBySocket(socketClientId)) {
      const existingClientId = this.sessionManager.getClientIdBySocket(socketClientId)!;
      if (this.sessionManager.isClientReady(existingClientId)) {
        this.logger.log(`✅ Reusing existing session: ${existingClientId}`);
        return { clientId: existingClientId };
      }
    }

    // Check for existing user sessions that can be reused
    if (accountId) {
      const existingSession = this.sessionManager.getClientState(accountId);
      if (existingSession && existingSession.isReady) {
        this.logger.log(`✅ Found existing ready session for account: ${accountId}`);
        this.sessionManager.mapSocketToClient(socketClientId, accountId);
        return { clientId: accountId };
      }
    }

    // Check for any existing sessions for this user
    const userSessions = this.sessionManager.getSessionsForUser(userId);
    if (userSessions.length > 0 && !accountId) {
      const readySession = userSessions.find(sessionId => this.sessionManager.isClientReady(sessionId));
      // if (readySession) {
      //   this.logger.log(`✅ Found existing ready session for user: ${readySession}`);
      //   this.sessionManager.mapSocketToClient(socketClientId, readySession);
      //   return { clientId: readySession };
      // }
    }

    // Prevent duplicate initialization
    if (this.initializationQueue.has(socketClientId)) {
      this.logger.warn(`🔄 Session initialization already in progress for: ${socketClientId}`);
      return this.initializationQueue.get(socketClientId)!;
    }

    const finalAccountId = accountId || uuidv4();
    const initPromise = this.doStartSession(socketClientId, userId, finalAccountId, emit);
    this.initializationQueue.set(socketClientId, initPromise);

    try {
      return await initPromise;
    } finally {
      this.initializationQueue.delete(socketClientId);
    }
  }

  private async doStartSession(
    socketClientId: string,
    userId: string,
    accountId: string,
    emit: (event: string, data: any) => void
  ) {
    const startTime = Date.now();
    this.logger.log(`🚀 Starting session for socket: ${socketClientId}, accountId: ${accountId}`);

    this.sessionManager.mapSocketToClient(socketClientId, accountId);

    try {
      const client = await this.sessionManager.createSession(accountId, userId);
      this.eventHandler.setupEventHandlers(client, accountId, emit, userId);

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
      this.sessionManager.removeSession(accountId);
      emit('initialization_failed', {
        clientId: accountId,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  async sendMessage(
    clientId: string,
    to: string[],
    message?: string,
    delayMs: number = 30000,
    photo?: Express.Multer.File,
    userId?: string
  ): Promise<any> {
    return await this.messageSender.sendMessage(clientId, to, message, delayMs, photo, userId!);
  }

  async sendMessageExcel(
    clientId: string,
    data: { messages: { number: string; message: string }[] },
    delayMs: number = 3000,
    userId?: string
  ): Promise<any> {
    try {
      // Delegate to MessageSenderService with the full data object
      const result = await this.messageSender.sendMessageExcel(clientId, data, delayMs, userId!);
      return result;
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to process bulk message request',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async disconnectClient(socketClientId: string) {
    const clientId = this.sessionManager.getClientIdBySocket(socketClientId);
    if (!clientId) {
      this.logger.debug(`No client mapped to socket ${socketClientId}`);
      return;
    }

    this.logger.log(`🔌 Disconnecting client ${clientId} due to socket ${socketClientId} disconnect`);
    await this.cleanupService.cleanupClient(clientId, `Socket ${socketClientId} disconnected`);
  }

  async forceCleanupClient(clientId: string): Promise<boolean> {
    try {
      this.logger.log(`🔨 Initiating force cleanup for client ${clientId}`);
      await this.cleanupService.cleanupClient(clientId, 'Force cleanup requested', true);
      return true;
    } catch (error) {
      this.logger.error(`❌ Force cleanup failed for ${clientId}: ${error.message}`);
      return false;
    }
  }

  async deleteAccount(accountId: string) {
    const account = await this.accountService.findAccountById(accountId);
    if (!account) {
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }

    if (account.clientId) {
      this.cleanupService.scheduleCleanup(account.clientId, `Account ${accountId} deleted`);
    }

    await this.accountService.deleteAccountOnLogout(accountId);
    return { message: 'Account deleted successfully' };
  }

  // Delegate methods
  registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>) {
    this.messageHandler.registerMessageHandler(handler);
  }

  isClientReady(clientId: string): boolean {
    return this.sessionManager.isClientReady(clientId);
  }

  async getUserAccounts(userId: string) {
    return await this.accountService.getUserAccounts(userId);
  }

  getActiveSessionCount(): number {
    return this.sessionManager.getActiveSessionCount();
  }

  getAllSessions(): string[] {
    return Array.from(this.sessionManager.getAllSessions().keys());
  }

  async getClientInfo(clientId: string) {
    const clientState = this.sessionManager.getClientState(clientId);
    if (!clientState) return null;

    const sessionStatus = await this.sessionManager.getSessionStatus(clientId);

    return {
      clientId,
      isReady: clientState.isReady,
      isSending: clientState.isSending,
      lastActivity: clientState.lastActivity,
      reconnectAttempts: clientState.reconnectAttempts,
      isRestored: this.sessionManager.isRestoredSession(clientId),
      sessionStatus
    };
  }

  async restoreSpecificSession(clientId: string, userId: string, emit?: (event: string, data: any) => void): Promise<boolean> {
    this.logger.log(`🔄 Attempting to restore specific session: ${clientId}`);
    return await this.sessionRestoration.restoreSpecificSession(clientId, userId, emit);
  }

  getRestoredSessions(): string[] {
    return Array.from(this.sessionManager.getAllSessions().entries())
      .filter(([clientId]) => this.sessionManager.isRestoredSession(clientId))
      .map(([clientId]) => clientId);
  }

  async getUnsavedChatNumbers(accountId: string, clientId?: string): Promise<string[]> {
    const account = await this.accountService.findAccountById(accountId);
    if (!account) {
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }

    const resolvedClientId = clientId ?? account.clientId;
    if (!resolvedClientId) {
      throw new HttpException(
        'No active WhatsApp session found for this account',
        HttpStatus.BAD_REQUEST,
      );
    }

    const clientState = this.sessionManager.getClientState(resolvedClientId);
    if (!clientState || !clientState.client) {
      throw new HttpException(
        'WhatsApp client not initialized for this account',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!clientState.isReady) {
      throw new HttpException(
        'WhatsApp client is not ready. Please wait for initialization.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const chats = await clientState.client.getChats();
    const { contacts } = await this.contactsService.findAllContacts(accountId);

    const savedNumbers = new Set(
      contacts
        .map((contact) => this.normalizeNumber(contact.phone_number))
        .filter((value): value is string => Boolean(value)),
    );

    const accountNumber = this.normalizeNumber(account.phone_number);
    const unsavedNumbers = new Set<string>();

    for (const chat of chats) {
      const chatId = (chat as any)?.id;
      if (!chatId) {
        continue;
      }

      const serializedId: string = chatId._serialized || '';
      if (serializedId.includes('status') || serializedId.includes('broadcast')) {
        continue;
      }

      if ((chat as any)?.isGroup) {
        continue;
      }

      const rawUser: string | undefined = chatId.user;
      const normalized = this.normalizeNumber(rawUser);
      if (!normalized) {
        continue;
      }

      if (accountNumber && normalized === accountNumber) {
        continue;
      }

      if (savedNumbers.has(normalized)) {
        continue;
      }

      const contactInfo = (chat as any)?.contact;
      if (contactInfo?.isMyContact) {
        continue;
      }

      unsavedNumbers.add(`+${normalized}`);
    }

    return Array.from(unsavedNumbers);
  }

  private normalizeNumber(value?: string): string {
    if (!value) {
      return '';
    }

    const digitsOnly = value.replace(/[^0-9]/g, '');
    return digitsOnly;
  }

  getHealthStatus() {
    const allSessions = this.sessionManager.getAllSessions();
    const readySessions = Array.from(allSessions.values()).filter(c => c.isReady);
    const restoredSessions = this.getRestoredSessions();

    return {
      status: 'healthy',
      metrics: {
        totalSessions: allSessions.size,
        readySessions: readySessions.length,
        sendingSessions: Array.from(allSessions.values()).filter(c => c.isSending).length,
        restoredSessions: restoredSessions.length,
        activeSessions: this.sessionManager.getActiveSessionCount(),
        totalSessionsCount: this.sessionManager.getTotalSessionCount()
      },
      sessions: {
        restored: restoredSessions,
        ready: readySessions.map((_, index) => Array.from(allSessions.keys())[index]).filter(id => this.sessionManager.isClientReady(id))
      },
      timestamp: Date.now(),
    };
  }
}
