import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WhatsAppService {
  private clients: Map<string, Client> = new Map();
  private socketClientMap: Map<string, string> = new Map(); // Maps socket clientId to WhatsApp clientId

  async startSession(socketClientId: string, emit: (event: string, data: any) => void) {
    // Generate a unique clientId for the WhatsApp session
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
      console.log(`[${clientId}] QR code ready. Please scan:`);
      qrcodeTerminal.generate(qr, { small: true });

      try {
        const qrDataUrl = await QRCode.toDataURL(qr); // Generate base64 QR code
        emit('qr', { clientId, qr: qrDataUrl });
      } catch (err) {
        console.error(`[${clientId}] Failed to generate QR code:`, err);
        emit('error', { message: 'Failed to generate QR code' });
      }
    });

    client.on('authenticated', () => {
      console.log(`[${clientId}] Authenticated`);
      emit('authenticated', { clientId });
    });

    client.on('ready', () => {
      console.log(`[${clientId}] WhatsApp ready`);
      emit('ready', { clientId });
    });

    client.on('disconnected', () => {
      console.log(`[${clientId}] Disconnected`);
      this.clients.delete(clientId);
      this.socketClientMap.delete(socketClientId);
      emit('disconnected', { clientId });
    });

    await client.initialize();
    this.clients.set(clientId, client);

    return { clientId };
  }
  async sendMessage(socketClientId: string, clientId: string, to: string, message: string) {
    const storedClientId = this.socketClientMap.get(socketClientId);
    if (!storedClientId || storedClientId !== clientId) {
      throw new HttpException('Invalid or unauthorized session', HttpStatus.UNAUTHORIZED);
    }

    let client = this.clients.get(clientId);

    if (!client) {
      throw new HttpException('Session not found. Please start a new session.', HttpStatus.NOT_FOUND);
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


