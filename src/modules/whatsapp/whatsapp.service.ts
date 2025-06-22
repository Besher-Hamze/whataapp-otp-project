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
    setTimeout(() => this.sessionRestoration.loadClientsFromSessions(), 5000);
    setInterval(() => this.cleanupService.cleanupInactiveSessions(), 600000); // Every 10 minutes
  }

  async startSession(
    socketClientId: string,
    userId: string,
    emit: (event: string, data: any) => void,
    accountId?: string
  ) {
    this.logger.log(`🚀 Attempting to start session for userId: ${userId}, accountId: ${accountId || 'new'}`);

    // Check for existing session
    if (this.sessionManager.getClientIdBySocket(socketClientId)) {
      const existingClientId = this.sessionManager.getClientIdBySocket(socketClientId)!;
      if (this.sessionManager.isClientReady(existingClientId)) {
        this.logger.log(`✅ Reusing existing session: ${existingClientId}`);
        return { clientId: existingClientId };
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
    message: string,
    delayMs: number = 3000
  ): Promise<any> {
    return await this.messageSender.sendMessage(clientId, to, message, delayMs);
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

    return {
      clientId,
      isReady: clientState.isReady,
      isSending: clientState.isSending,
      lastActivity: clientState.lastActivity,
      reconnectAttempts: clientState.reconnectAttempts,
    };
  }

  getHealthStatus() {
    const allSessions = this.sessionManager.getAllSessions();
    return {
      status: 'healthy',
      metrics: {
        totalClients: allSessions.size,
        readyClients: Array.from(allSessions.values()).filter(c => c.isReady).length,
        sendingClients: Array.from(allSessions.values()).filter(c => c.isSending).length,
      },
      timestamp: Date.now(),
    };
  }
}
