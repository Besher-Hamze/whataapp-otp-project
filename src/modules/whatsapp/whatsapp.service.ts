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

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  private clients: Map<string, Client> = new Map();
  private socketClientMap: Map<string, string> = new Map();
  // Track ongoing message operations to prevent overlapping sends for the same client
  private sendingMessages: Map<string, boolean> = new Map();
  private messageHandlers: Array<(message: any, accountId: string) => Promise<void>> = [];

  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    private moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.loadClientsFromSessions();
  }

  /**
   * Register a message handler function to process incoming messages
   * @param handler Function that processes incoming messages
   */
  registerMessageHandler(handler: (message: any, accountId: string) => Promise<void>) {
    this.logger.log('Registering new message handler');
    this.messageHandlers.push(handler);
  }

  private async loadClientsFromSessions() {
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(authDir)) {
      this.logger.warn('.wwebjs_auth directory not found. No sessions loaded.');
      return;
    }

    const sessionFiles = fs.readdirSync(authDir).filter(file => file.startsWith('session-'));
    this.logger.log(`Found ${sessionFiles.length} session files.`);

    for (const file of sessionFiles) {
      const clientId = file.replace('session-', '');
      this.logger.log(`Loading client for session: ${file}, clientId: ${clientId}`);

      try {
        const sessionPath = path.join(authDir, file);
        
        if (!this.isValidSession(sessionPath)) {
          this.logger.warn(`Invalid session for ${clientId}. Skipping.`);
          continue;
        }

        const client = new Client({
          authStrategy: new LocalAuth({ clientId }),
          puppeteer: { headless: true, args: ['--no-sandbox'] },
        });

        // Set up message handler for incoming messages
        client.on('message', async (message) => {
          await this.handleIncomingMessage(message, clientId);
        });

        // Initialize client
        await client.initialize();

        // Store client
        this.clients.set(clientId, client);
        this.logger.log(`Client for ${clientId} loaded and initialized.`);

        client.on('ready', () => {
          this.logger.log(`[${clientId}] 🔔 WhatsApp client is ready`);
        });

        client.on('auth_failure', () => {
          this.logger.error(`[${clientId}] Authentication failed. Removing session.`);
          this.clients.delete(clientId);
          this.socketClientMap.delete(clientId);
          this.cleanupSession(sessionPath);
        });

        client.on('disconnected', async (reason) => {
          this.logger.warn(`[${clientId}] 🔌 Disconnected: ${reason}`);
          this.clients.delete(clientId);
          this.socketClientMap.delete(clientId);
          await this.accountModel.updateOne({ clientId }, { status: 'disconnected' }).exec();
          this.cleanupSession(sessionPath);
        });

      } catch (error) {
        this.logger.error(`Failed to load client for ${clientId}: ${error.message}`, error.stack);
        await this.cleanupSession(path.join(authDir, file));
      }
    }

    this.logger.log(`Loaded ${this.clients.size} clients from .wwebjs_auth.`);
  }

  // Helper to validate session directory
  private isValidSession(sessionPath: string): boolean {
    try {
      const defaultPath = path.join(sessionPath, 'Default');
      if (!fs.existsSync(defaultPath) || !fs.statSync(defaultPath).isDirectory()) {
        this.logger.warn(`Default folder not found in ${sessionPath}`);
        return false;
      }
      const files = fs.readdirSync(defaultPath);
      return files.includes('Cookies') && files.length > 0;
    } catch (error) {
      this.logger.error(`Error validating session ${sessionPath}: ${error.message}`);
      return false;
    }
  }

  // Helper to clean up corrupted session
  private async cleanupSession(sessionPath: string): Promise<void> {
    try {
      if (fs.existsSync(sessionPath)) {
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
        this.logger.log(`Cleaned up session directory: ${sessionPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to clean up session ${sessionPath}: ${error.message}`);
    }
  }

  async startSession(socketClientId: string, userId: string, emit: (event: string, data: any) => void) {
    // Check if a session already exists for this socket
    if (this.socketClientMap.has(socketClientId)) {
      const existingClientId = this.socketClientMap.get(socketClientId);
      this.logger.warn(`[${existingClientId}] Session already exists for socket: ${socketClientId}`);
      emit('error', { message: 'Session already started', clientId: existingClientId });
      return { clientId: existingClientId };
    }

    const clientId = uuidv4();
    this.logger.log(`[${clientId}] Starting new WhatsApp session for socket: ${socketClientId}`);
    this.socketClientMap.set(socketClientId, clientId);

    // Double-check if client already exists (race condition prevention)
    if (this.clients.has(clientId)) {
      this.logger.warn(`[${clientId}] Client already exists`);
      emit('error', { message: 'Session already started', clientId });
      return { clientId };
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId }),
      puppeteer: { headless: true, args: ['--no-sandbox'] },
    });

    // Set up message handler for incoming messages
    client.on('message', async (message) => {
      await this.handleIncomingMessage(message, clientId);
    });

    client.on('qr', async (qr) => {
      this.logger.log(`[${clientId}] QR Code received — sending to frontend`);
      try {
        const qrDataUrl = await QRCode.toDataURL(qr);
        qrcodeTerminal.generate(qr, { small: true });
        emit('qr', { clientId, qr: qrDataUrl });
      } catch (err) {
        this.logger.error(`[${clientId}] Failed to generate QR code: ${err.message}`);
        emit('error', { message: 'Failed to generate QR code', details: err.message });
      }
    });

    client.on('authenticated', () => {
      this.logger.log(`[${clientId}] Authenticated with WhatsApp`);
      emit('authenticated', { clientId });
    });

    client.on('ready', async () => {
      this.logger.log(`[${clientId}] WhatsApp client is ready`);
      const userInfo = client.info;
      const phoneNumber = userInfo?.wid?.user || 'Unknown';
      const name = userInfo?.pushname || 'Unknown';

      this.logger.log(`[${clientId}] Logged in as: ${name} (${phoneNumber})`);

      try {
        this.logger.log(`[${clientId}] Checking for existing account`);
        const existingAccount = await this.accountModel.findOne({ phone_number: phoneNumber }).exec();
        if (existingAccount) {
          this.logger.warn(`[${clientId}] Phone number already exists: ${phoneNumber}`);
          emit('error', { message: 'Phone number already exists', phoneNumber });
          throw new ConflictException('Phone number already exists');
        }

        this.logger.log(`[${clientId}] Saving account to database`);
        await this.accountModel.create({
          name,
          phone_number: phoneNumber,
          user: userId,
          clientId,
          status: 'active',
        });
        this.logger.log(`[${clientId}] Account saved to DB`);
        emit('ready', {
          phoneNumber,
          name,
          clientId,
          status: 'active',
          message: 'WhatsApp client ready and account saved.',
        });
      } catch (err) {
        this.logger.error(`[${clientId}] Failed to save account to DB: ${err.message}`);
        emit('error', {
          message: 'Failed to save account to DB.',
          details: err.message,
        });
      }
    });

    client.on('disconnected', (reason) => {
      this.logger.warn(`[${clientId}] Disconnected: ${reason}`);
      emit('disconnected', { clientId, reason });
    });

    this.logger.log(`[${clientId}] Initializing WhatsApp client...`);
    try {
      await client.initialize();
      this.logger.log(`[${clientId}] Client initialized and session started`);
      this.clients.set(clientId, client);
    } catch (err) {
      this.logger.error(`[${clientId}] Failed to initialize client: ${err.message}`);
      this.clients.delete(clientId);
      this.socketClientMap.delete(socketClientId);
      emit('error', { message: 'Failed to initialize WhatsApp client', details: err.message });
    }

    return { clientId };
  }

  /**
   * Handle incoming WhatsApp message and pass to registered handlers
   * @param message WhatsApp message object
   * @param clientId The client ID that received the message
   */
  private async handleIncomingMessage(message: Message, clientId: string) {
    try {
      if (message.fromMe) {
        // Skip messages sent by the current account
        return;
      }
      
      // Get the account associated with this client ID
      const account = await this.accountModel.findOne({ clientId }).exec();
      if (!account) {
        this.logger.warn(`No account found for client ${clientId}`);
        return;
      }
      
      const accountId = account._id.toString();
      const sender = message.from.split('@')[0]; // Extract phone number
      
      this.logger.log(`Received message from ${sender} to account ${accountId}: ${message.body.substring(0, 50)}${message.body.length > 50 ? '...' : ''}`);
      
      // Pass message to all registered handlers
      for (const handler of this.messageHandlers) {
        try {
          await handler(message, accountId);
        } catch (error) {
          this.logger.error(`Error in message handler: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error handling incoming message: ${error.message}`);
    }
  }

  /**
   * Send a message to one or more recipients with configurable delay between messages
   * @param clientId WhatsApp client ID
   * @param to Array of recipient phone numbers
   * @param message Message text to send
   * @param delayMs Delay in milliseconds between messages (default: 5000ms/5s)
   * @returns 
   */
  async sendMessage(
    clientId: string,
    to: string[],
    message: string,
    delayMs: number = 5000, // Default delay of 5 seconds between messages
  ) {
    // Check if client exists
    const client = this.clients.get(clientId);
    if (!client) {
      this.logger.error(`[${clientId}] Session not found`);
      throw new HttpException(
        'Session not found. Please start a new session.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Check if already sending messages from this client
    if (this.sendingMessages.get(clientId)) {
      this.logger.warn(`[${clientId}] Already sending messages. Please wait for completion.`);
      throw new HttpException(
        'Already sending messages from this account. Please wait for completion.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Lock this client for sending
    this.sendingMessages.set(clientId, true);

    try {
      this.logger.log(`[${clientId}] Starting to send message to ${to.length} recipients with ${delayMs}ms delay`);
      
      const results: MessageResult[] = [];

      // Send to each recipient with the specified delay
      for (let i = 0; i < to.length; i++) {
        const recipient = to[i];
        const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
        
        try {
          // Send the message
          await client.sendMessage(chatId, message);
          results.push({ recipient, status: 'sent' });
          this.logger.log(`[${clientId}] ✅ Message sent to ${chatId} (${i+1}/${to.length})`);
          
          // If not the last recipient, apply the delay
          if (i < to.length - 1) {
            this.logger.debug(`[${clientId}] Waiting ${delayMs}ms before sending next message`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } catch (error) {
          this.logger.error(`[${clientId}] Failed to send to ${chatId}: ${error.message}`);
          results.push({ recipient, status: 'failed', error: error.message });
        }
      }

      this.logger.log(`[${clientId}] Completed sending messages to all recipients`);
      return { message: 'Messages sent', results };
    } catch (error) {
      this.logger.error(`[${clientId}] Error in message sending process: ${error.message}`);
      throw new HttpException(
        `Failed to send messages: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      // Unlock this client
      this.sendingMessages.set(clientId, false);
    }
  }

  disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    if (!clientId) {
      this.logger.warn(`No client found for socket: ${socketClientId}`);
      return;
    }
    
    this.logger.log(`[${clientId}] Disconnect requested for socket: ${socketClientId}`);

    const client = this.clients.get(clientId);
    if (client) {
      // If currently sending messages, wait for completion
      if (this.sendingMessages.get(clientId)) {
        this.logger.log(`[${clientId}] Client is busy sending messages. Marking for delayed disconnect.`);
        setTimeout(() => this.performDisconnect(clientId, socketClientId), 5000);
        return;
      }
      
      this.performDisconnect(clientId, socketClientId);
    } else {
      this.socketClientMap.delete(socketClientId);
      this.logger.log(`[${clientId}] Socket mapping cleared (client not found)`);
    }
  }

  private async performDisconnect(clientId: string, socketClientId: string) {
    try {
      const client = this.clients.get(clientId);
      if (client) {
        await client.destroy();
        this.clients.delete(clientId);
        this.logger.log(`[${clientId}] WhatsApp client destroyed`);
      }
      
      this.socketClientMap.delete(socketClientId);
      this.sendingMessages.delete(clientId);
      this.logger.log(`[${clientId}] Session mapping cleared`);
      
      // Update account status in database
      await this.accountModel.updateOne({ clientId }, { status: 'disconnected' }).exec();
    } catch (error) {
      this.logger.error(`[${clientId}] Error during disconnect: ${error.message}`);
    }
  }

  getActiveSessionCount(): number {
    const count = this.clients.size;
    this.logger.log(`Active WhatsApp sessions: ${count}`);
    return count;
  }

  getAllSessions(): string[] {
    const sessions = Array.from(this.clients.keys());
    this.logger.log(`Current client session IDs: ${sessions.join(', ')}`);
    return sessions;
  }
  
  /**
   * Get all WhatsApp accounts for a specific user
   * @param userId User ID
   * @returns List of WhatsApp accounts
   */
  async getUserAccounts(userId: string) {
    return this.accountModel.find({ user: userId }).exec();
  }
  
  /**
   * Check if a specific client is connected and ready
   * @param clientId WhatsApp client ID
   * @returns boolean indicating if client is ready
   */
  isClientReady(clientId: string): boolean {
    return this.clients.has(clientId) && !this.sendingMessages.get(clientId);
  }
}
