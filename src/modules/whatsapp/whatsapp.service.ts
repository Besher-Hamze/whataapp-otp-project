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
  private socketClientMap: Map<string, string> = new Map(); // Maps socket clientId to WhatsApp clientId

  async startSession(
    socketClientId: string,
    emit: (event: string, data: any) => void,
  ) {
    const clientId = uuidv4();
    this.socketClientMap.set(socketClientId, clientId);

    if (this.clients.has(clientId)) {
      emit('error', { message: 'Session already started' });
      return { clientId };
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId }),
      puppeteer: { headless: true, args: ['--no-sandbox'] },
    });

    client.on('qr', async (qr) => {
      const qrDataUrl = await QRCode.toDataURL(qr);
      emit('qr', { clientId, qr: qrDataUrl });
    });

    client.on('authenticated', () => {
      emit('authenticated', { clientId });
    });

    client.on('ready', async () => {
      const userInfo = client.info; // Contains the authenticated user's info
      const phoneNumber = userInfo?.wid?.user; // e.g., '1234567890'
      const name = userInfo?.pushname || 'Unknown';

      // Save account to DB
      await this.accountModel.create({
        name,
        phone_number: phoneNumber,
        user: null, // Add actual user ID if applicable
      });

      emit('ready', {
        clientId,
        phoneNumber,
        name,
        message: 'WhatsApp client ready and account saved.',
      });
    });

    client.on('disconnected', () => {
      this.clients.delete(clientId);
      this.socketClientMap.delete(socketClientId);
      emit('disconnected', { clientId });
    });

    await client.initialize();
    this.clients.set(clientId, client);

    return { clientId };
  }

  async sendMessage(
    socketClientId: string,
    clientId: string,
    to: string,
    message: string,
  ) {
    const storedClientId = this.socketClientMap.get(socketClientId);
    if (!storedClientId || storedClientId !== clientId) {
      throw new HttpException(
        'Invalid or unauthorized session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let client = this.clients.get(clientId);

    if (!client) {
      throw new HttpException(
        'Session not found. Please start a new session.',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const chatId = to.includes('@') ? to : `${to}@c.us`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await client.sendMessage(chatId, message);
      return { message: 'Message sent successfully' };
    } catch (err) {
      console.error(`[${clientId}] Error sending message:`, err);
      throw new HttpException(
        `Failed to send message: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  disconnectClient(socketClientId: string) {
    const clientId = this.socketClientMap.get(socketClientId);
    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.destroy();
        this.clients.delete(clientId);
      }
      this.socketClientMap.delete(socketClientId);
    }
  }

  getActiveSessionCount(): number {
    return this.clients.size;
  }

  getAllSessions(): string[] {
    return Array.from(this.clients.keys());
  }
}
