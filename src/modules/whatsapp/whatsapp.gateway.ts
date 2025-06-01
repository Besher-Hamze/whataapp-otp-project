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

interface AuthenticatedSocket extends Socket {
  userId?: string;
  isAuthenticated?: boolean;
}

@WebSocketGateway({
  cors: { origin: '*' },
  path: '',
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class WhatsAppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('WhatsAppGateway');

  private readonly clientIdMap = new Map<string, string>(); // socket.id -> WhatsApp clientId
  private readonly userSockets = new Map<string, Set<string>>(); // userId -> socket.ids
  private readonly socketAuth = new Map<string, string>(); // socket.id -> userId

  private readonly connectionStats = {
    total: 0,
    authenticated: 0,
    sessions: 0,
  };

  constructor(private readonly whatsappService: WhatsAppService) {}

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway initialized with optimizations');
    setInterval(() => this.cleanupDisconnectedSockets(), 30000);
  }

  handleConnection(client: AuthenticatedSocket) {
    this.connectionStats.total++;
    this.logger.debug(`📱 Client connected: ${client.id} (Total: ${this.connectionStats.total})`);
    this.authenticateSocket(client);
    client.emit('connected', {
      socketId: client.id,
      timestamp: Date.now(),
      authenticated: client.isAuthenticated,
    });
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.connectionStats.total--;
    this.logger.debug(`📱 Client disconnected: ${client.id}`);
    this.cleanupSocketData(client.id);
    // No disconnectClient call—client persists across WebSocket disconnect
  }

  @SubscribeMessage('authenticate')
  async handleAuthenticate(client: AuthenticatedSocket, data: { token: string }) {
    try {
      const userId = await this.validateToken(data.token);
      this.setSocketAuthentication(client, userId);
      client.emit('authenticated', {
        userId,
        socketId: client.id,
        timestamp: Date.now(),
      });
      return { success: true, userId };
    } catch (error) {
      client.emit('auth_error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('init')
  async handleStartSession(client: AuthenticatedSocket, data?: { token?: string }) {
    const startTime = Date.now();
    this.logger.log(`🔄 Starting WhatsApp session for: ${client.id}`);

    try {
      let userId = client.userId;
      if (!userId && data?.token) {
        userId = await this.validateToken(data.token);
        this.setSocketAuthentication(client, userId);
      }
      if (!userId) throw new UnauthorizedException('Authentication required');

      client.emit('session_starting', { socketId: client.id, timestamp: Date.now() });

      const { clientId } = await this.whatsappService.startSession(
        client.id,
        userId,
        (event, data) => this.emitToSocket(client.id, event, data),
      );

      if (clientId) {
        this.clientIdMap.set(client.id, clientId);
        this.connectionStats.sessions++;
      }

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Session started in ${duration}ms for ${client.id}`);
      return { success: true, clientId, duration, timestamp: Date.now() };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Session failed in ${duration}ms: ${error.message}`);
      client.emit('initialization_failed', {
        message: 'Failed to start WhatsApp session',
        details: error.message,
        duration,
      });
      throw new BadRequestException(error.message);
    }
  }

  @SubscribeMessage('get_session_status')
  async handleGetSessionStatus(client: AuthenticatedSocket) {
    const clientId = this.clientIdMap.get(client.id);
    const isReady = clientId ? this.whatsappService.isClientReady(clientId) : false;
    return {
      socketId: client.id,
      clientId: clientId || null,
      isReady,
      isAuthenticated: client.isAuthenticated,
      timestamp: Date.now(),
    };
  }

  @SubscribeMessage('get_stats')
  async handleGetStats(client: AuthenticatedSocket) {
    return {
      ...this.connectionStats,
      activeClients: this.whatsappService.getActiveSessionCount(),
      timestamp: Date.now(),
    };
  }

  private authenticateSocket(client: AuthenticatedSocket) {
    const token = client.handshake.headers.authorization?.split(' ')[1] ||
      client.handshake.auth?.token ||
      client.handshake.query?.token;
    if (token) {
      try {
        const userId = this.validateTokenSync(token);
        this.setSocketAuthentication(client, userId);
      } catch (error) {
        this.logger.debug(`Socket ${client.id} auth failed: ${error.message}`);
      }
    }
  }

  private async validateToken(token: string): Promise<string> {
    if (!token) throw new UnauthorizedException('Token required');
    const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
    const userId = payload.sub;
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid userId format');
    return userId;
  }

  private validateTokenSync(token: string): string {
    const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
    const userId = payload.sub;
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid userId format');
    return userId;
  }

  private setSocketAuthentication(client: AuthenticatedSocket, userId: string) {
    client.userId = userId;
    client.isAuthenticated = true;
    this.socketAuth.set(client.id, userId);
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId)!.add(client.id);
    this.connectionStats.authenticated++;
    this.logger.debug(`✅ Socket ${client.id} authenticated for user ${userId}`);
  }

  private cleanupSocketData(socketId: string) {
    this.clientIdMap.delete(socketId);
    const userId = this.socketAuth.get(socketId);
    if (userId) {
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socketId);
        if (userSocketSet.size === 0) this.userSockets.delete(userId);
      }
      this.socketAuth.delete(socketId);
      this.connectionStats.authenticated--;
    }
  }

  private cleanupDisconnectedSockets() {
    const connectedSockets = new Set(this.server.sockets.sockets.keys());
    for (const [socketId] of this.socketAuth) {
      if (!connectedSockets.has(socketId)) this.cleanupSocketData(socketId);
    }
  }

  private emitToSocket(socketId: string, event: string, data: any) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket) socket.emit(event, { ...data, timestamp: Date.now() });
  }

  broadcastToUser(userId: string, event: string, data: any) {
    const userSocketSet = this.userSockets.get(userId);
    if (!userSocketSet?.size) return;
    const payload = { ...data, timestamp: Date.now() };
    const socketsToEmit = Array.from(userSocketSet)
      .map(id => this.server.sockets.sockets.get(id))
      .filter(Boolean);
    if (socketsToEmit.length > 0) {
      this.logger.debug(`📡 Broadcasting ${event} to ${socketsToEmit.length} sockets`);
      socketsToEmit.forEach(socket => socket!.emit(event, payload));
    }
  }

  getConnectionStats() {
    return {
      ...this.connectionStats,
      activeConnections: this.server.sockets.sockets.size,
      authenticatedUsers: this.userSockets.size,
      timestamp: Date.now(),
    };
  }
}