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
      if (readySession) {
        this.logger.log(`✅ Found existing ready session for user: ${readySession}`);
        this.sessionManager.mapSocketToClient(socketClientId, readySession);
        return { clientId: readySession };
      }
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
    delayMs: number = 3000,
    photo?: Express.Multer.File
  ): Promise<any> {
    return await this.messageSender.sendMessage(clientId, to, message, delayMs, photo);
  }

 async sendMessageExcel(
        clientId: string,
        data: { messages: { number: string; message: string }[] },
        delayMs: number = 3000
    ): Promise<any> {
        try {
            // Delegate to MessageSenderService with the full data object
            const result = await this.messageSender.sendMessageExcel(clientId, data, delayMs);
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
    const account = await this.accountService.findAccountByClientId(accountId);
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
