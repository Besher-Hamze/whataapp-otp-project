import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhatsAppService } from './whatsapp.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' , path: '/whatsapp/start'} })
export class WhatsAppGateway {
  @WebSocketServer() server: Server
  private logger: Logger = new Logger('WhatsAppGateway');
  private clientIdMap: Map<string, string> = new Map(); // Maps socket.id to WhatsApp clientId

  constructor(private readonly whatsappService: WhatsAppService) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const clientId = this.clientIdMap.get(client.id);
    if (clientId) {
      this.whatsappService.disconnectClient(client.id);
      this.clientIdMap.delete(client.id);
    }
  }

  @SubscribeMessage('start-session')
  async handleStartSession(client: Socket) {
    this.logger.log(`Starting WhatsApp session for client: ${client.id}`);
    const { clientId } = await this.whatsappService.startSession(client.id, (event, data) => {
      if (this.clientIdMap.has(client.id)) {
        client.emit(event, data); // Emit to the specific client
      }
    });
    this.clientIdMap.set(client.id, clientId);
    return { clientId };
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(client: Socket, payload: { clientId: string; to: string; message: string }) {
    this.logger.log(`Sending message for client: ${client.id}`);
    return await this.whatsappService.sendMessage(client.id, payload.clientId, payload.to, payload.message);
  }
}