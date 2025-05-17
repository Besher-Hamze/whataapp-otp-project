// src/gateways/whatsapp.gateway.ts

import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhatsAppService } from './whatsapp.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/whatsapp/start',
})
export class WhatsAppGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly whatsappService: WhatsAppService) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.whatsappService.disconnectClient(client.id);
  }

  @SubscribeMessage('start-session')
  async handleStartSession(@MessageBody() data: any, client: Socket) {
    const socketClientId = client.id;
    const emit = (event: string, payload: any) => {
      client.emit(event, payload);
    };

    const session = await this.whatsappService.startSession(
      socketClientId,
      emit,
    );
    return session; // Returns clientId
  }
}
