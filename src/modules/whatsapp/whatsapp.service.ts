import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
export class WhatsAppService {
  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
  ) {}

  private clients: Map<string, Client> = new Map();
  private socketClientMap: Map<string, string> = new Map();

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
      console.log(`[${clientId}] 💾 Saving account to database`);
      await this.accountModel.create({
        name,
        phone_number: phoneNumber,
        user: userId,
      });
      console.log(`[${clientId}] ✅ Account saved to DB`);
      emit('ready', {
        phoneNumber,
        name,
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
    this.clients.delete(clientId);
    this.socketClientMap.delete(socketClientId);
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
    socketClientId: string,
    clientId: string,
    to: string,
    message: string,
  ) {
    const storedClientId = this.socketClientMap.get(socketClientId);
    console.log(`[${clientId}] 📨 Attempting to send message to ${to}`);

    if (!storedClientId || storedClientId !== clientId) {
      console.warn(`[${clientId}] 🚫 Unauthorized session`);
      throw new HttpException(
        'Invalid or unauthorized session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const client = this.clients.get(clientId);

    if (!client) {
      console.error(`[${clientId}] ❌ Session not found`);
      throw new HttpException(
        'Session not found. Please start a new session.',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const chatId = to.includes('@') ? to : `${to}@c.us`;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay before sending
      await client.sendMessage(chatId, message);
      console.log(`[${clientId}] ✅ Message sent to ${chatId}`);
      return { message: 'Message sent successfully' };
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
