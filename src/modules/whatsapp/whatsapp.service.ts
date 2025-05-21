import { ConflictException, HttpException, HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { Model } from 'mongoose';

@Injectable()
export class WhatsAppService implements OnModuleInit {
  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
  ) {}

  private clients: Map<string, Client> = new Map();
  private socketClientMap: Map<string, string> = new Map();

  async onModuleInit() {
    this.loadClientsFromSessions(); // Load mappings on module initialization
  }

private async loadClientsFromSessions() {
  const authDir = path.join(process.cwd(), '.wwebjs_auth');
  if (!fs.existsSync(authDir)) {
    console.warn('[WhatsAppService] .wwebjs_auth directory not found. No sessions loaded.');
    return;
  }

  const sessionFiles = fs.readdirSync(authDir).filter(file => file.startsWith('session-'));
  console.log(`[WhatsAppService] Found ${sessionFiles.length} session files.`);

  for (const file of sessionFiles) {
    const clientId = file.replace('session-', '');
    console.log(`[WhatsAppService] Loading client for session: ${file}, clientId: ${clientId}`);

    try {
      // Validate session directory (unchanged as per your request)
      const sessionPath = path.join(authDir, file);
      console.log(sessionPath);
      
      if (!this.isValidSession(sessionPath)) {
        console.warn(`[WhatsAppService] Invalid session for ${clientId}. Skipping.`);
        // await this.cleanupSession(sessionPath);
        continue;
      }

      const client = new Client({
        authStrategy: new LocalAuth({ clientId }),
        puppeteer: { headless: true, args: ['--no-sandbox'] },
      });

      // Initialize client
      await client.initialize();

      // Store client (remove socketClientMap setting)
      this.clients.set(clientId, client);
      console.log(`[WhatsAppService] Client for ${clientId} loaded and initialized.`);

      client.on('ready', () => {
        console.log(`[${clientId}] 🔔 WhatsApp client is ready`);
      });

      client.on('auth_failure', () => {
        console.error(`[${clientId}] Authentication failed. Removing session.`);
        this.clients.delete(clientId);
        this.socketClientMap.delete(clientId);
        this.cleanupSession(sessionPath);
      });

      client.on('disconnected', async (reason) => {
        console.warn(`[${clientId}] 🔌 Disconnected: ${reason}`);
        this.clients.delete(clientId);
        this.socketClientMap.delete(clientId);
        await this.accountModel.updateOne({ clientId }, { status: 'disconnected' }).exec();
        this.cleanupSession(sessionPath);
      });

    } catch (error) {
      console.error(`[WhatsAppService] Failed to load client for ${clientId}:`, error);
      await this.cleanupSession(path.join(authDir, file));
    }
  }

  console.log(`[WhatsAppService] Loaded ${this.clients.size} clients from .wwebjs_auth.`);
}

// Helper to validate session directory
private isValidSession(sessionPath: string): boolean {
  try {
    const defaultPath = path.join(sessionPath, 'Default');
    if (!fs.existsSync(defaultPath) || !fs.statSync(defaultPath).isDirectory()) {
      console.warn(`[WhatsAppService] Default folder not found in ${sessionPath}`);
      return false;
    }
    const files = fs.readdirSync(defaultPath);
    return files.includes('Cookies') && files.length > 0;
  } catch (error) {
    console.error(`[WhatsAppService] Error validating session ${sessionPath}:`, error);
    return false;
  }
}

// Helper to clean up corrupted session
private async cleanupSession(sessionPath: string): Promise<void> {
  // try {
  //   await fs.promises.rm(sessionPath, { recursive: true, force: true });
  //   console.log(`[WhatsAppService] Cleaned up session directory: ${sessionPath}`);
  // } catch (error) {
  //   console.error(`[WhatsAppService] Failed to clean up session ${sessionPath}:`, error);
  // }
}
async startSession(socketClientId: string, userId : string ,emit: (event: string, data: any) => void) {
  // Check if a session already exists for this socket
  if (this.socketClientMap.has(socketClientId)) {
    const existingClientId = this.socketClientMap.get(socketClientId);
    console.warn(`[${existingClientId}] ⚠️ Session already exists for socket: ${socketClientId}`);
    emit('error', { message: 'Session already started', clientId: existingClientId });
    return { clientId: existingClientId };
  }

  const clientId = uuidv4();
  console.log(`[${clientId}] 🟢 Starting new WhatsApp session for socket: ${socketClientId}`);
  this.socketClientMap.set(socketClientId, clientId);

  // Double-check if client already exists (race condition prevention)
  if (this.clients.has(clientId)) {
    console.warn(`[${clientId}] ⚠️ Client already exists`);
    emit('error', { message: 'Session already started', clientId });
    return { clientId };
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });

  client.on('qr', async (qr) => {
    console.log(`[${clientId}] 🧾 QR Code received — sending to frontend`);
    try {
      const qrDataUrl = await QRCode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
      emit('qr', { clientId, qr: qrDataUrl });
    } catch (err) {
      console.error(`[${clientId}] ❌ Failed to generate QR code:`, err);
      emit('error', { message: 'Failed to generate QR code', details: err.message });
    }
  });

  client.on('authenticated', () => {
    console.log(`[${clientId}] 🔐 Authenticated with WhatsApp`);
    emit('authenticated', { clientId });
  });

  client.on('ready', async () => {
    console.log(`[${clientId}] 🔔 WhatsApp client is ready`);
    const userInfo = client.info;
    const phoneNumber = userInfo?.wid?.user || 'Unknown';
    const name = userInfo?.pushname || 'Unknown';

    console.log(`[${clientId}] 👤 Logged in as: ${name} (${phoneNumber})`);

    try {
      console.log(`[${clientId}] 💾 Checking for existing account`);
        const existingAccount = await this.accountModel.findOne({ phone_number: phoneNumber }).exec();
        if (existingAccount) {
          console.warn(`[${clientId}] 🚫 Phone number already exists: ${phoneNumber}`);
          emit('error', { message: 'Phone number already exists', phoneNumber });
          throw new ConflictException('Phone number already exists');
        }

      console.log(`[${clientId}] 💾 Saving account to database`);
      await this.accountModel.create({
          name,
          phone_number: phoneNumber,
          user: userId,
          clientId,
          status: 'active',
      });
      console.log(`[${clientId}] ✅ Account saved to DB`);
      emit('ready', {
          phoneNumber,
          name,
          clientId,
          status: 'active',
          message: 'WhatsApp client ready and account saved.',
      });
    } catch (err) {
      console.error(`[${clientId}] ❌ Failed to save account to DB:`, err);
      emit('error', {
        message: 'Failed to save account to DB.',
        details: err.message,
      });
    }
  });

  client.on('disconnected', (reason) => {
    console.warn(`[${clientId}] 🔌 Disconnected: ${reason}`);
    // this.clients.delete(clientId);
    // this.socketClientMap.delete(socketClientId);
    emit('disconnected', { clientId, reason });
  });

  console.log(`[${clientId}] ⚙️ Initializing WhatsApp client...`);
  try {
    await client.initialize();
    console.log(`[${clientId}] ✅ Client initialized and session started`);
    this.clients.set(clientId, client);
  } catch (err) {
    console.error(`[${clientId}] ❌ Failed to initialize client:`, err);
    this.clients.delete(clientId);
    this.socketClientMap.delete(socketClientId);
    emit('error', { message: 'Failed to initialize WhatsApp client', details: err.message });
  }

  return { clientId };
}

  async sendMessage(
    clientId: string,
    to: string[], // Change to string[]
    message: string,
  ) {
    const client = this.clients.get(clientId);

    if (!client) {
      console.error(`[${clientId}] ❌ Session not found`);
      throw new HttpException(
        'Session not found. Please start a new session.',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      //  Iterate over the 'to' array and send the message to each recipient
     for (const recipient of to) {
    const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
    await new Promise(resolve => setTimeout(resolve, 1000));
    await client.sendMessage(chatId, message);
    console.log(`[${clientId}] ✅ Message sent to ${chatId}`);
  }
      return { message: 'Messages sent successfully' };
    } catch (err) {
      console.error(`[${clientId}] ❌ Error sending message:`, err);
      throw new HttpException(
        `Failed to send message: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    console.log(
      `[${clientId}] 📴 Disconnect requested for socket: ${socketClientId}`,
    );

    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.destroy();
        this.clients.delete(clientId);
        console.log(`[${clientId}] 🔚 WhatsApp client destroyed`);
      }
      this.socketClientMap.delete(socketClientId);
      console.log(`[${clientId}] ❎ Session mapping cleared`);
    }
  }

  getActiveSessionCount(): number {
    const count = this.clients.size;
    console.log(`📊 Active WhatsApp sessions: ${count}`);
    return count;
  }

  getAllSessions(): string[] {
    const sessions = Array.from(this.clients.keys());
    console.log(`📋 Current client session IDs: ${sessions.join(', ')}`);
    return sessions;
  }
}
