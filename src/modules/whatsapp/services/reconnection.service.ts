// src/whatsapp/services/reconnection.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';

@Injectable()
export class ReconnectionService {
    private readonly logger = new Logger(ReconnectionService.name);
    private readonly MAX_RECONNECT_ATTEMPTS = 3;
    private readonly RECONNECT_INTERVAL = 5000;

    constructor(private readonly sessionManager: SessionManagerService) { }

    async handleReconnection(clientId: string): Promise<void> {
        const clientState = this.sessionManager.getClientState(clientId);
        if (!clientState) {
            this.logger.warn(`🚫 Cannot reconnect ${clientId}: Client state not found`);
            return;
        }

        while (clientState.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            clientState.reconnectAttempts++;
            this.logger.log(`🔄 Reconnection attempt ${clientState.reconnectAttempts} for ${clientId}`);

            try {
                await clientState.client.initialize();
                this.logger.log(`✅ Reconnected successfully for ${clientId}`);

                this.sessionManager.updateClientState(clientId, {
                    isReady: true,
                    reconnectAttempts: 0,
                    lastActivity: Date.now(),
                });
                break;
            } catch (error) {
                this.logger.error(`❌ Reconnection attempt ${clientState.reconnectAttempts} failed for ${clientId}: ${error.message}`);

                if (clientState.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
                    this.logger.warn(`⛔ Max reconnection attempts reached for ${clientId}`);
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, this.RECONNECT_INTERVAL));
            }
        }
    }
}
