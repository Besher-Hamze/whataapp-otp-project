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
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('WhatsAppGateway');
  private clientIdMap: Map<string, string> = new Map(); // Maps socket.id to WhatsApp clientId
  private socketClientMap: Map<string, string> = new Map();
  private userSockets: Map<string, Set<string>> = new Map(); // Maps userId to set of socket.ids

  constructor(private readonly whatsappService: WhatsAppService) { }

  async afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Attempt to get token and authenticate user on connection
    const token = client.handshake.headers.authorization?.split(' ')[1] ||
      client.handshake.auth?.token;

    if (token) {
      try {
        const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
        const userId = payload.sub;

        if (Types.ObjectId.isValid(userId)) {
          // Add socket to user's socket set
          if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
          }

          const userSocketSet = this.userSockets.get(userId);
          if (userSocketSet) {
            userSocketSet.add(client.id);
            this.logger.log(`Socket ${client.id} authenticated for user ${userId}`);
          }
        }
      } catch (err) {
        // Authentication failed, but we'll still allow connection
        // and properly authenticate when needed for specific operations
        this.logger.debug(`Socket ${client.id} connected without valid authentication`);
      }
    }
  }

  handleDisconnect(client: Socket) {
    const socketId = client.id;
    this.logger.log(`Client disconnected: ${socketId}`);

    // Remove from user sockets map
    for (const [userId, sockets] of this.userSockets.entries()) {
      if (sockets.has(socketId)) {
        sockets.delete(socketId);
        this.logger.debug(`Removed socket ${socketId} from user ${userId}`);

        // Clean up if no more sockets for this user
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }

        break;
      }
    }

    // Delay disconnection to allow WhatsApp client to reach 'ready'
    setTimeout(() => {
      this.whatsappService.disconnectClient(socketId);
    }, 3000);
  }

  @SubscribeMessage('init')
  async handleStartSession(client: Socket) {
    this.logger.log(`Starting WhatsApp session for client: ${client.id}`);
    const token = client.handshake.headers.authorization?.split(' ')[1] ||
      client.handshake.auth?.token;

    if (!token) {
      client.emit('error', {
        message: 'Missing or invalid Authorization header',
      });
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    this.logger.debug(`Token received for session initialization`);

    let userId: string;
    try {
      const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
      userId = payload.sub;
      if (!Types.ObjectId.isValid(userId)) {
        client.emit('error', {
          message: 'Invalid userId in token: must be a valid ObjectId',
        });
        throw new BadRequestException('Invalid userId in token');
      }

      // Add socket to user's socket set
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }

      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.add(client.id);
      }

    } catch (err) {
      client.emit('error', { message: 'Invalid or expired token' });
      throw new UnauthorizedException('Invalid or expired token');
    }

    try {
      const { clientId } = await this.whatsappService.startSession(
        client.id,
        userId,
        (event, data) => {
          if (this.clientIdMap.has(client.id)) {
            client.emit(event, data); // Emit to the specific client
          }
        },
      );

      if (clientId) {
        this.clientIdMap.set(client.id, clientId);
      }
      return { clientId };
    } catch (err) {
      client.emit('error', {
        message: 'Failed to start WhatsApp session',
        details: err.message,
      });
      throw new BadRequestException('Failed to start WhatsApp session');
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    client: Socket,
    payload: { clientId: string; to: string[]; message: string; delay?: number },
  ) {
    this.logger.log(`Sending message for client: ${client.id}`);
    const delay = payload.delay || 5000; // Default 5 seconds if not provided

    return await this.whatsappService.sendMessage(
      payload.clientId,
      payload.to,
      payload.message,
      delay,
    ) as any;
  }

  /**
   * Broadcast message status updates to all connected sockets of a specific user
   * @param userId User ID
   * @param event Event name
   * @param data Event data
   */
  broadcastToUser(userId: string, event: string, data: any) {
    const userSocketSet = this.userSockets.get(userId);
    if (!userSocketSet || userSocketSet.size === 0) {
      this.logger.debug(`No active sockets for user ${userId}`);
      return;
    }

    this.logger.debug(`Broadcasting ${event} to ${userSocketSet.size} sockets of user ${userId}`);
    for (const socketId of userSocketSet) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
      }
    }
  }
}
