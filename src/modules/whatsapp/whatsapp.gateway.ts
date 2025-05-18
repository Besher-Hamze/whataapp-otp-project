import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhatsAppService } from './whatsapp.service';
import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { verify } from 'jsonwebtoken';
@WebSocketGateway({ cors: { origin: '*' }, path: '' })
export class WhatsAppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
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
    const socketId = client.id;
    console.log(`[WhatsAppGateway] Client disconnected: ${socketId}`);
    // Delay disconnection to allow WhatsApp client to reach 'ready'
    setTimeout(() => {
      this.whatsappService.disconnectClient(socketId);
    }, 3000);
  }

  @SubscribeMessage('init')
  async handleStartSession(client: Socket) {
    this.logger.log(`Starting WhatsApp session for client: ${client.id}`);

    const authHeader = client.handshake.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      client.emit('error', {
        message: 'Missing or invalid Authorization header',
      });
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.split(' ')[1];
    this.logger.log(`Token received: ${token}`);

    let userId: string;
    try {
      const payload = verify(token, process.env.JWT_SECRET!) as {
        sub: string;
      }; // Adjust secret and payload type
      userId = payload.sub;
      if (!Types.ObjectId.isValid(userId)) {
        client.emit('error', {
          message: 'Invalid userId in token: must be a valid ObjectId',
        });
        throw new BadRequestException('Invalid userId in token');
      }
    } catch (err) {
      client.emit('error', { message: 'Invalid or expired token' });
      throw new UnauthorizedException('Invalid or expired token');
    }
    const { clientId } = await this.whatsappService.startSession(
      client.id,// client id from socket
      (event, data) => {
        if (this.clientIdMap.has(client.id)) {
          client.emit(event, data); // Emit to the specific client
        }
      },
    );
    this.clientIdMap.set(client.id, clientId);
    return { clientId };
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    client: Socket,
    payload: { clientId: string; to: string; message: string },
  ) {
    this.logger.log(`Sending message for client: ${client.id}`);
    return await this.whatsappService.sendMessage(
      client.id,
      payload.clientId,
      payload.to,
      payload.message,
    );
  }
}
