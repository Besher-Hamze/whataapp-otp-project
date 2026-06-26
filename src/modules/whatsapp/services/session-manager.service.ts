// src/whatsapp/services/session-manager.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { PuppeteerConfigService } from './puppeteer-config.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Account, AccountDocument } from '../../accounts/schema/account.schema';
import { ClientState } from '../interfaces/client-state.interface';

@Injectable()
export class SessionManagerService implements OnModuleInit {
    private readonly logger = new Logger(SessionManagerService.name);
    private readonly clientStates = new Map<string, ClientState>();
    private readonly socketClientMap = new Map<string, string>();
    private readonly clientReadyPromises = new Map<string, Promise<void>>();
    private readonly initializationQueue = new Map<string, Promise<any>>();
    private readonly restoredSessions = new Set<string>();

    constructor(
        private readonly puppeteerConfig: PuppeteerConfigService,
        @InjectModel(Account.name) private accountModel: Model<AccountDocument>
    ) { }

    onModuleInit() {
        this.logger.log('🚀 SessionManager initialized');
    }

    async createSession(clientId: string, userId: string, isRestore: boolean = false): Promise<Client> {
        const existing = this.clientStates.get(clientId);
        if (existing?.client) {
            this.logger.log(`♻️ Reusing existing in-memory session for ${clientId}`);
            return existing.client;
        }

        this.logger.log(`🚀 Creating ${isRestore ? 'restored' : 'new'} session for clientId: ${clientId}`);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: this.puppeteerConfig.getConfig(),
        });

        const clientState: ClientState = {
            client,
            userId,
            isReady: false, // Start as false, set to true when ready
            isSending: false,
            lastActivity: Date.now(),
            reconnectAttempts: 0,
        };

        this.clientStates.set(clientId, clientState);

        if (isRestore) {
            this.restoredSessions.add(clientId);
        }

        return client;
    }

    async saveSessionState(clientId: string): Promise<void> {
        try {
            const client: ClientState | undefined = await this.getClientState(clientId);
            let phoneNumber = "Unknown"
            if (client) {
                phoneNumber = client.client.info.wid.user
            }
            await this.accountModel.updateOne(
                { clientId },
                {
                    $set: {
                        'sessionData.isAuthenticated': true,
                        'sessionData.lastConnected': new Date(),
                        'sessionData.authState': 'authenticated',
                        'sessionData.sessionValid': true,
                        status: 'ready',
                        phone_number: phoneNumber
                    }
                }
            );
            this.logger.log(`💾 Session state saved for ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Failed to save session state for ${clientId}: ${error.message}`);
        }
    }

    async loadSessionState(clientId: string): Promise<any> {
        try {
            const account = await this.accountModel.findOne({ clientId }).lean();
            return account?.sessionData || null;
        } catch (error) {
            this.logger.error(`❌ Failed to load session state for ${clientId}: ${error.message}`);
            return null;
        }
    }

    async markSessionAsDisconnected(clientId: string): Promise<void> {
        try {
            await this.accountModel.updateOne(
                { clientId },
                {
                    $set: {
                        'sessionData.isAuthenticated': false,
                        'sessionData.authState': 'disconnected',
                        'sessionData.sessionValid': false,
                        status: 'disconnected'
                    }
                }
            );
            this.logger.log(`📤 Session marked as disconnected for ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Failed to mark session as disconnected for ${clientId}: ${error.message}`);
        }
    }

    isRestoredSession(clientId: string): boolean {
        return this.restoredSessions.has(clientId);
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

    removeSession(clientId: string, options?: { preserveSocketMappings?: boolean }): void {
        this.clientStates.delete(clientId);
        this.clientReadyPromises.delete(clientId);
        this.restoredSessions.delete(clientId);

        if (!options?.preserveSocketMappings) {
            for (const [socketId, mappedClientId] of this.socketClientMap.entries()) {
                if (mappedClientId === clientId) {
                    this.socketClientMap.delete(socketId);
                }
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
        return Array.from(this.clientStates.values()).filter(state => state.isReady).length;
    }

    getTotalSessionCount(): number {
        return this.clientStates.size;
    }

    getSessionsForUser(userId: string): string[] {
        return Array.from(this.clientStates.entries())
            .filter(([_, state]) => state.userId === userId)
            .map(([clientId]) => clientId);
    }

    async getSessionStatus(clientId: string): Promise<any> {
        const state = this.clientStates.get(clientId);
        if (!state) return null;

        const dbState = await this.loadSessionState(clientId);

        return {
            clientId,
            isReady: state.isReady,
            isSending: state.isSending,
            lastActivity: state.lastActivity,
            reconnectAttempts: state.reconnectAttempts,
            isRestored: this.isRestoredSession(clientId),
            dbSessionData: dbState
        };
    }

    mapSocketToClient(socketId: string, clientId: string): void {
        this.socketClientMap.set(socketId, clientId);
    }

    unmapSocket(socketId: string): void {
        this.socketClientMap.delete(socketId);
    }

    getClientIdBySocket(socketId: string): string | undefined {
        return this.socketClientMap.get(socketId);
    }
}
