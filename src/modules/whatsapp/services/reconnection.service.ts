import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';
import { SessionRecoveryService } from './session-recovery.service';

@Injectable()
export class ReconnectionService {
    private readonly logger = new Logger(ReconnectionService.name);
    private readonly MAX_SOFT_INIT_ATTEMPTS = 3;
    private readonly SOFT_RETRY_DELAY_MS = 5000;
    private readonly INIT_TIMEOUT_MS = 90_000;
    private readonly STATE_CHECK_TIMEOUT_MS = 12_000;

    private readonly reconnectInFlight = new Map<string, Promise<void>>();

    constructor(
        private readonly sessionManager: SessionManagerService,
        @Inject(forwardRef(() => SessionRecoveryService))
        private readonly sessionRecovery: SessionRecoveryService,
    ) { }

    async handleReconnection(clientId: string): Promise<void> {
        const existing = this.reconnectInFlight.get(clientId);
        if (existing) {
            return existing;
        }

        const job = this.runReconnection(clientId).finally(() => {
            this.reconnectInFlight.delete(clientId);
        });
        this.reconnectInFlight.set(clientId, job);
        return job;
    }

    private async runReconnection(clientId: string): Promise<void> {
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState) {
            this.logger.warn(`Cannot reconnect ${clientId}: client state not found`);
            return;
        }

        this.sessionManager.updateClientState(clientId, {
            isReady: false,
            lastActivity: Date.now(),
        });

        for (let attempt = 1; attempt <= this.MAX_SOFT_INIT_ATTEMPTS; attempt++) {
            const state = this.sessionManager.getClientState(clientId);
            if (!state?.client) {
                this.logger.warn(`Soft reconnect ${attempt}/${this.MAX_SOFT_INIT_ATTEMPTS}: no client for ${clientId}`);
                break;
            }

            this.logger.log(`🔄 Soft reconnect attempt ${attempt}/${this.MAX_SOFT_INIT_ATTEMPTS} for ${clientId}`);

            try {
                await this.withTimeout(
                    state.client.initialize(),
                    this.INIT_TIMEOUT_MS,
                    `initialize-${clientId}`,
                );

                const ws = await this.withTimeout(
                    state.client.getState(),
                    this.STATE_CHECK_TIMEOUT_MS,
                    `getState-${clientId}`,
                );

                if (ws === 'CONNECTED') {
                    this.sessionManager.updateClientState(clientId, {
                        isReady: true,
                        reconnectAttempts: 0,
                        lastActivity: Date.now(),
                    });
                    this.logger.log(`✅ Soft reconnect succeeded for ${clientId}`);
                    return;
                }

                this.logger.warn(`Soft reconnect ${clientId}: unexpected WhatsApp state "${ws}"`);
            } catch (error: any) {
                this.logger.warn(
                    `Soft reconnect attempt ${attempt} failed for ${clientId}: ${error?.message || error}`,
                );
            }

            if (attempt < this.MAX_SOFT_INIT_ATTEMPTS) {
                await new Promise(r => setTimeout(r, this.SOFT_RETRY_DELAY_MS));
            }
        }

        this.logger.warn(`🔁 Soft reconnect exhausted for ${clientId}, running full rebuild from auth`);
        const rebuilt = await this.sessionRecovery.recreateClientFromAuth(clientId);
        if (!rebuilt) {
            this.logger.error(`⛔ Full rebuild failed for ${clientId}`);
        }
    }

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }
}
