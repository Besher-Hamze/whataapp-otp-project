// src/whatsapp/services/session-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { ClientState } from '../interfaces/client-state.interface';
import { PuppeteerConfigService } from './puppeteer-config.service';

@Injectable()
export class SessionManagerService {
    private readonly logger = new Logger(SessionManagerService.name);
    private readonly clientStates = new Map<string, ClientState>();
    private readonly socketClientMap = new Map<string, string>();
    private readonly clientReadyPromises = new Map<string, Promise<void>>();
    private readonly initializationQueue = new Map<string, Promise<any>>();

    constructor(private readonly puppeteerConfig: PuppeteerConfigService) { }

    async createSession(clientId: string, userId: string): Promise<Client> {
        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: this.puppeteerConfig.getConfig(),
        });

        const clientState: ClientState = {
            client,
            userId,
            isReady: false,
            isSending: false,
            lastActivity: Date.now(),
            reconnectAttempts: 0,
        };

        this.clientStates.set(clientId, clientState);
        return client;
    }

    getClientState(clientId: string): ClientState | undefined {
        return this.clientStates.get(clientId);
    }

    updateClientState(clientId: string, updates: Partial<ClientState>): void {
        const state = this.clientStates.get(clientId);
        if (state) {
            Object.assign(state, updates);
        }
    }

    removeSession(clientId: string): void {
        this.clientStates.delete(clientId);
        this.clientReadyPromises.delete(clientId);

        // Remove from socket mapping
        for (const [socketId, mappedClientId] of this.socketClientMap.entries()) {
            if (mappedClientId === clientId) {
                this.socketClientMap.delete(socketId);
            }
        }
    }

    getAllSessions(): Map<string, ClientState> {
        return new Map(this.clientStates);
    }

    isClientReady(clientId: string): boolean {
        return this.clientStates.get(clientId)?.isReady || false;
    }

    getActiveSessionCount(): number {
        return this.clientStates.size;
    }

    mapSocketToClient(socketId: string, clientId: string): void {
        this.socketClientMap.set(socketId, clientId);
    }

    getClientIdBySocket(socketId: string): string | undefined {
        return this.socketClientMap.get(socketId);
    }
}
