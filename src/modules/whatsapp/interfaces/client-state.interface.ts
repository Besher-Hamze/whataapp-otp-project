import { Client } from 'whatsapp-web.js';

export interface ClientState {
    client: Client;
    userId: string;
    isReady: boolean;
    isSending: boolean;
    lastActivity: number;
    reconnectAttempts: number;
}
