import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcodeTerminal from 'qrcode-terminal';

@Injectable()
export class WhatsAppService {
  private clients: Map<string, Client> = new Map();

  async startSession(clientId: string) {
    const sessionName = `${clientId}`;

    if (this.clients.has(clientId)) {
      return { message: 'Session already started' };
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName }),
      puppeteer: { headless: true, args: ['--no-sandbox'] },
    });

    client.on('qr', (qr) => {
      console.log(`[${clientId}] QR code ready. Please scan:`);
      qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('authenticated', () => {
      console.log(`[${clientId}] Authenticated`);
    });

    client.on('ready', () => {
      console.log(`[${clientId}] WhatsApp ready`);
    });

    client.on('disconnected', () => {
      console.log(`[${clientId}] Disconnected`);
      this.clients.delete(clientId);
    });

    await client.initialize();
    this.clients.set(clientId, client);

    return {
      message: 'Session started. Scan QR to authenticate',
    };
  }

  async sendMessage(clientId: string, to: string, message: string) {
    const sessionName = `${clientId}`;

    let client = this.clients.get(clientId);

    // 🟡 If client not running, try starting
    if (!client) {
      console.log(`[${clientId}] No session. Initializing...`);

      client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionName }),
        puppeteer: { headless: true, args: ['--no-sandbox'] },
      });

      client.on('qr', (qr) => {
        console.log(`[${clientId}] QR ready`);
        qrcodeTerminal.generate(qr, { small: true });
      });

      client.on('authenticated', () => {
        console.log(`[${clientId}] Authenticated`);
      });

      client.on('ready', () => {
        console.log(`[${clientId}] WhatsApp ready`);
      });

      client.on('disconnected', () => {
        console.log(`[${clientId}] Disconnected`);
        this.clients.delete(clientId);
      });

      await client.initialize();

      // ✅ Wait until WhatsApp is really ready
      await new Promise<void>((resolve) => {
        client!.once('ready', () => resolve());
      });

      this.clients.set(clientId, client);
    }

    try {
      const chatId = to.includes('@') ? to : `${to}@c.us`;

      // ✅ Slight delay still helps stabilize Puppeteer internal script
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

  getActiveSessionCount(): number {
    return this.clients.size;
  }

  getAllSessions(): string[] {
    return Array.from(this.clients.keys());
  }
}
