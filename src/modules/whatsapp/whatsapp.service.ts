import { ConflictException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { Model } from 'mongoose';
import { ModuleRef } from '@nestjs/core';

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

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly clients = new Map<string, Client>();
  private readonly socketClientMap = new Map<string, string>();
  private readonly sendingMessages = new Map<string, boolean>();
  private readonly messageHandlers: Array<(message: any, accountId: string) => Promise<void>> = [];

  // Performance optimizations
  private readonly qrCache = new Map<string, QRGenerationCache>();
  private readonly clientReadyPromises = new Map<string, Promise<void>>();
  private readonly initializationQueue = new Map<string, Promise<any>>();

  // Enhanced Puppeteer configuration
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
      '--single-process', // Critical for VPS environments
      '--memory-pressure-off',
      '--max_old_space_size=4096'
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout: 60000, // Increase timeout for slow VPS
    protocolTimeout: 60000
  };

  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    private moduleRef: ModuleRef,
  ) { }

  async onModuleInit() {
    // Load existing sessions in background
    setImmediate(() => this.loadClientsFromSessions());

    // Setup cleanup intervals
    setInterval(() => this.cleanupExpiredQRCodes(), 300000); // Every 5 minutes
    setInterval(() => this.cleanupStaleConnections(), 600000); // Every 10 minutes
  }

  registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>) {
    this.logger.log('📝 Registering new message handler');
    this.messageHandlers.push(handler);
  }

  async startSession(socketClientId: string, userId: string, emit: (event: string, data: any) => void) {
    // Prevent duplicate initialization
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
    // Check for existing session
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

      // Setup event handlers BEFORE initialization
      this.setupClientEventHandlers(client, clientId, emit, userId);

      // Store client immediately to prevent race conditions
      this.clients.set(clientId, client);

      // Create ready promise for tracking
      let readyResolve: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
      this.clientReadyPromises.set(clientId, readyPromise);

      // Enhanced ready handler
      client.once('ready', () => {
        const duration = Date.now() - startTime;
        this.logger.log(`✅ Client ${clientId} ready in ${duration}ms`);
        readyResolve();
      });

      // Initialize with timeout
      const initTimeout = setTimeout(() => {
        this.logger.error(`⏰ Client ${clientId} initialization timeout`);
        emit('initialization_timeout', { clientId });
      }, 120000); // 2 minutes

      await client.initialize();
      clearTimeout(initTimeout);

      const duration = Date.now() - startTime;
      this.logger.log(`🎉 Session ${clientId} started in ${duration}ms`);

      return { clientId };

    } catch (error) {
      this.logger.error(`❌ Failed to start session ${clientId}: ${error.message}`);

      // Cleanup on failure
      this.clients.delete(clientId);
      this.socketClientMap.delete(socketClientId);
      this.clientReadyPromises.delete(clientId);

      emit('initialization_failed', {
        clientId,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  private setupClientEventHandlers(client: Client, clientId: string, emit: (event: string, data: any) => void, userId: string) {
    // QR Code handler with caching and optimization
    client.on('qr', async (qr) => {
      const qrStartTime = Date.now();
      this.logger.log(`📱 QR received for ${clientId} - generating...`);

      try {
        // Check cache first
        const cached = this.qrCache.get(qr);
        if (cached && Date.now() - cached.timestamp < 30000) { // 30 second cache
          emit('qr', { clientId, qr: cached.dataUrl });
          this.logger.debug(`⚡ QR served from cache in ${Date.now() - qrStartTime}ms`);
          return;
        }

        // Generate QR with optimized settings
        const qrDataUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M', // Medium error correction (faster)
          type: 'image/png',
          quality: 0.8, // Reduce quality for speed
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256 // Fixed width for consistency
        });

        // Cache the result
        this.qrCache.set(qr, {
          qr,
          dataUrl: qrDataUrl,
          timestamp: Date.now()
        });

        // Emit to frontend
        emit('qr', { clientId, qr: qrDataUrl });

        // Optional: Show in terminal (async to not block)
        setImmediate(() => {
          qrcodeTerminal.generate(qr, { small: true });
        });

        const qrDuration = Date.now() - qrStartTime;
        this.logger.log(`✅ QR generated and sent in ${qrDuration}ms`);

      } catch (error) {
        this.logger.error(`❌ QR generation failed: ${error.message}`);
        emit('qr_error', { clientId, error: error.message });
      }
    });

    // Optimized message handler
    client.on('message', async (message) => {
      // Process in background to not block other operations
      setImmediate(() => this.handleIncomingMessage(message, clientId));
    });

    // Authentication events
    client.on('authenticated', () => {
      this.logger.log(`🔐 ${clientId} authenticated`);
      emit('authenticated', { clientId });
    });

    client.on('auth_failure', () => {
      this.logger.error(`🚫 ${clientId} authentication failed`);
      emit('auth_failure', { clientId });
      this.performCleanup(clientId);
    });

    // Ready event with account creation
    client.on('ready', async () => {
      try {
        const userInfo = client.info;
        const phoneNumber = userInfo?.wid?.user || 'Unknown';
        const name = userInfo?.pushname || 'Unknown';

        this.logger.log(`📞 ${clientId} logged in as: ${name} (${phoneNumber})`);

        // Check for existing account (optimized query)
        const existingAccount = await this.accountModel.findOne(
          { phone_number: phoneNumber },
          { _id: 1, phone_number: 1 }
        ).lean().exec();

        if (existingAccount) {
          this.logger.warn(`⚠️ Phone number already exists: ${phoneNumber}`);
          emit('phone_exists', { clientId, phoneNumber });
          return;
        }

        // Create account
        await this.accountModel.create({
          name,
          phone_number: phoneNumber,
          user: userId,
          clientId,
          status: 'active',
          created_at: new Date()
        });

        emit('ready', {
          phoneNumber,
          name,
          clientId,
          status: 'active',
          message: 'WhatsApp client ready and account saved.'
        });

      } catch (error) {
        this.logger.error(`❌ Ready handler error: ${error.message}`);
        emit('ready_error', { clientId, error: error.message });
      }
    });

    // Disconnection handler
    client.on('disconnected', async (reason) => {
      this.logger.warn(`🔌 ${clientId} disconnected: ${reason}`);
      emit('disconnected', { clientId, reason });

      // Update database status
      await this.accountModel.updateOne(
        { clientId },
        { status: 'disconnected', disconnected_at: new Date() }
      ).exec();

      this.performCleanup(clientId);
    });
  }

  private async handleIncomingMessage(message: Message, clientId: string) {
    try {
      if (message.fromMe) return;

      // Optimized account lookup
      const account = await this.accountModel.findOne(
        { clientId },
        { _id: 1, user: 1 }
      ).lean().exec();

      if (!account) {
        this.logger.warn(`📱 No account found for client ${clientId}`);
        return;
      }

      const accountId = account._id.toString();
      const sender = message.from.split('@')[0];

      this.logger.debug(`📨 Message from ${sender} to ${accountId}`);

      // Process handlers in parallel
      const handlerPromises = this.messageHandlers.map(handler =>
        handler(message, accountId).catch(error =>
          this.logger.error(`Handler error: ${error.message}`)
        )
      );

      await Promise.allSettled(handlerPromises);

    } catch (error) {
      this.logger.error(`❌ Message handling error: ${error.message}`);
    }
  }

  async sendMessage(clientId: string, to: string[], message: string, delayMs: number = 3000) {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
    }

    // Check if client is ready
    if (!this.isClientReady(clientId)) {
      // Wait for ready state with timeout
      const readyPromise = this.clientReadyPromises.get(clientId);
      if (readyPromise) {
        await Promise.race([
          readyPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Client ready timeout')), 30000)
          )
        ]);
      }
    }

    // Prevent overlapping sends
    if (this.sendingMessages.get(clientId)) {
      throw new HttpException(
        'Already sending messages from this account. Please wait.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    this.sendingMessages.set(clientId, true);

    try {
      const results: MessageResult[] = [];
      const batchSize = 5; // Process in small batches

      this.logger.log(`📤 Sending to ${to.length} recipients with ${delayMs}ms delay`);

      for (let i = 0; i < to.length; i += batchSize) {
        const batch = to.slice(i, i + batchSize);

        const batchPromises = batch.map(async (recipient, batchIndex) => {
          const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
          const globalIndex = i + batchIndex;

          try {
            await client.sendMessage(chatId, message);
            results.push({ recipient, status: 'sent' });
            this.logger.debug(`✅ Sent to ${chatId} (${globalIndex + 1}/${to.length})`);
          } catch (error) {
            this.logger.error(`❌ Failed to send to ${chatId}: ${error.message}`);
            results.push({ recipient, status: 'failed', error: error.message });
          }
        });

        await Promise.allSettled(batchPromises);

        // Apply delay between batches (except for last batch)
        if (i + batchSize < to.length) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
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

    // Find and remove socket mapping
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
      if (now - cache.timestamp > 300000) { // 5 minutes
        this.qrCache.delete(qr);
      }
    }
  }

  private cleanupStaleConnections() {
    // Implementation for cleaning up stale connections
    this.logger.debug('🧹 Performing stale connection cleanup');
  }

  // ... Rest of the existing methods with minor optimizations ...

  disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    if (!clientId) return;

    // Immediate cleanup for better responsiveness
    setImmediate(async () => {
      try {
        const client = this.clients.get(clientId);
        if (client) {
          await client.destroy();
        }

        await this.accountModel.updateOne(
          { clientId },
          { status: 'disconnected', disconnected_at: new Date() }
        ).exec();

        this.performCleanup(clientId);
        this.logger.log(`🗑️ Cleaned up client ${clientId}`);
      } catch (error) {
        this.logger.error(`❌ Cleanup error: ${error.message}`);
      }
    });
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

    // Load sessions in parallel with concurrency limit
    const concurrencyLimit = 3;
    const semaphore = Array(concurrencyLimit).fill(null).map(() => Promise.resolve());

    const loadPromises = sessionFiles.map(async (file, index) => {
      // Wait for available slot
      const slot = index % concurrencyLimit;
      await semaphore[slot];

      const promise = this.loadSingleSession(file);
      semaphore[slot] = promise.catch(() => { }); // Don't let failures block other slots
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

      // Setup minimal handlers for loaded sessions
      client.on('message', async (message) => {
        setImmediate(() => this.handleIncomingMessage(message, clientId));
      });

      client.on('ready', () => {
        this.logger.log(`✅ Loaded session ${clientId} is ready`);
      });

      client.on('auth_failure', async () => {
        this.logger.error(`🚫 Loaded session ${clientId} auth failed`);
        await this.cleanupSession(sessionPath);
        this.clients.delete(clientId);
      });

      client.on('disconnected', async (reason) => {
        this.logger.warn(`🔌 Loaded session ${clientId} disconnected: ${reason}`);
        await this.accountModel.updateOne(
          { clientId },
          { status: 'disconnected', disconnected_at: new Date() }
        ).exec();
        await this.cleanupSession(sessionPath);
        this.clients.delete(clientId);
      });

      // Initialize and store
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
      if (!fs.existsSync(sessionPath)) {
        return false;
      }

      const defaultPath = path.join(sessionPath, 'Default');
      if (!fs.existsSync(defaultPath)) {
        return false;
      }

      // Check if marked for cleanup
      const cleanupFlag = path.join(sessionPath, '.cleanup_required');
      if (fs.existsSync(cleanupFlag)) {
        this.logger.warn(`Session marked for cleanup: ${sessionPath}`);
        return false;
      }

      const stats = fs.statSync(defaultPath);
      if (!stats.isDirectory()) {
        return false;
      }

      const files = fs.readdirSync(defaultPath);
      const hasRequiredFiles = files.some(file =>
        file.includes('Cookies') ||
        file.includes('Local State') ||
        file.includes('Preferences')
      );

      // Check for minimum file count and required files
      const isValid = hasRequiredFiles && files.length > 2;

      if (!isValid) {
        this.logger.debug(`Invalid session detected: ${sessionPath} (${files.length} files)`);
      }

      return isValid;
    } catch (error) {
      this.logger.error(`❌ Session validation error: ${error.message}`);
      return false;
    }
  }
  private async cleanupMarkedSessions(): Promise<void> {
    try {
      const authDir = path.join(process.cwd(), '.wwebjs_auth');
      if (!fs.existsSync(authDir)) {
        return;
      }

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

      // Force remove with retry logic
      await this.forceRemoveDirectory(sessionPath, 3);

      this.logger.debug(`✅ Successfully cleaned up session: ${sessionPath}`);
    } catch (error) {
      this.logger.error(`❌ Session cleanup failed: ${error.message}`);

      // Try alternative cleanup methods
      await this.alternativeCleanup(sessionPath);
    }
  }
  private async forceRemoveDirectory(dirPath: string, retries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Method 1: Use fs.rm with force and recursive (Node.js 14.14+)
        if (fs.promises.rm) {
          await fs.promises.rm(dirPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100
          });
          return;
        }

        // Method 2: Fallback to rmdir with recursive
        await fs.promises.rmdir(dirPath, { recursive: true });
        return;

      } catch (error) {
        this.logger.warn(`🔄 Cleanup attempt ${attempt}/${retries} failed: ${error.message}`);

        if (attempt === retries) {
          throw error;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  private async alternativeCleanup(sessionPath: string): Promise<void> {
    try {
      this.logger.warn(`🔧 Attempting alternative cleanup for: ${sessionPath}`);

      // First, try to unlock files by changing permissions
      try {
        await this.unlockDirectory(sessionPath);
      } catch (permError) {
        this.logger.debug(`Permission change failed: ${permError.message}`);
      }

      // Method 1: Manual recursive deletion
      await this.recursiveDelete(sessionPath);

    } catch (error) {
      this.logger.error(`💥 Alternative cleanup also failed: ${error.message}`);

      // Last resort: Use system command
      await this.systemCleanup(sessionPath);
    }
  }
  private async recursiveDelete(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const stats = await fs.promises.lstat(dirPath);

    if (stats.isDirectory()) {
      const entries = await fs.promises.readdir(dirPath);

      // Delete all contents first
      await Promise.all(
        entries.map(entry =>
          this.recursiveDelete(path.join(dirPath, entry))
        )
      );

      // Then delete the directory itself
      await fs.promises.rmdir(dirPath);
    } else {
      // Delete file
      await fs.promises.unlink(dirPath);
    }
  }

  private async unlockDirectory(dirPath: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      // Change permissions to allow deletion (Linux/Unix)
      await execAsync(`chmod -R 755 "${dirPath}"`);
      this.logger.debug(`🔓 Changed permissions for: ${dirPath}`);
    } catch (error) {
      // Ignore permission errors on systems where this doesn't work
      this.logger.debug(`Permission change not supported: ${error.message}`);
    }
  }
  private async systemCleanup(sessionPath: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      this.logger.warn(`🔨 Using system command to cleanup: ${sessionPath}`);

      // Use rm -rf on Unix systems
      if (process.platform !== 'win32') {
        await execAsync(`rm -rf "${sessionPath}"`);
      } else {
        // Use rmdir /s on Windows
        await execAsync(`rmdir /s /q "${sessionPath}"`);
      }

      this.logger.log(`✅ System cleanup successful: ${sessionPath}`);
    } catch (error) {
      this.logger.error(`💀 System cleanup failed: ${error.message}`);

      // Mark for manual cleanup
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


  /**
   * Get detailed client information
   */
  async getClientInfo(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) {
      return null;
    }

    try {
      const info = client.info;
      const account = await this.accountModel.findOne(
        { clientId },
        { name: 1, phone_number: 1, status: 1, created_at: 1 }
      ).lean().exec();

      return {
        clientId,
        isReady: this.isClientReady(clientId),
        isSending: this.sendingMessages.get(clientId) || false,
        whatsappInfo: {
          phoneNumber: info?.wid?.user || 'Unknown',
          name: info?.pushname || 'Unknown',
          platform: info?.platform || 'Unknown'
        },
        accountInfo: account,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(`❌ Error getting client info: ${error.message}`);
      return null;
    }
  }

  /**
   * Health check for the service
   */
  getHealthStatus() {
    const totalClients = this.clients.size;
    const activeSending = Array.from(this.sendingMessages.values()).filter(Boolean).length;
    const qrCacheSize = this.qrCache.size;

    return {
      status: 'healthy',
      metrics: {
        totalClients,
        activeSending,
        qrCacheSize,
        initializationQueue: this.initializationQueue.size,
        socketMappings: this.socketClientMap.size
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      timestamp: Date.now()
    };
  }

  /**
   * Force cleanup of a specific client
   */
  async forceCleanupClient(clientId: string) {
    try {
      const client = this.clients.get(clientId);
      if (client) {
        await client.destroy();
      }

      this.performCleanup(clientId);

      // Update database
      await this.accountModel.updateOne(
        { clientId },
        { status: 'force_disconnected', disconnected_at: new Date() }
      ).exec();

      this.logger.log(`🔨 Force cleaned up client: ${clientId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Force cleanup failed: ${error.message}`);
      return false;
    }
  }
}