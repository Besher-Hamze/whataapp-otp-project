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
  path: '/whatsapp',
  transports: ['websocket'], // Use only websocket for better performance
  pingTimeout: 60000,
  pingInterval: 25000
})
export class WhatsAppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer() server: Server;
  private readonly logger = new Logger('WhatsAppGateway');

  // Optimized data structures
  private readonly clientIdMap = new Map<string, string>(); // socket.id -> WhatsApp clientId
  private readonly userSockets = new Map<string, Set<string>>(); // userId -> socket.ids
  private readonly socketAuth = new Map<string, string>(); // socket.id -> userId

  // Performance tracking
  private readonly connectionStats = {
    total: 0,
    authenticated: 0,
    sessions: 0
  };

  constructor(private readonly whatsappService: WhatsAppService) { }

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway initialized with optimizations');

    // Setup periodic cleanup
    setInterval(() => this.cleanupDisconnectedSockets(), 30000);
  }

  handleConnection(client: AuthenticatedSocket) {
    this.connectionStats.total++;
    this.logger.debug(`📱 Client connected: ${client.id} (Total: ${this.connectionStats.total})`);

    // Immediate authentication attempt
    this.authenticateSocket(client);

    // Send immediate acknowledgment
    client.emit('connected', {
      socketId: client.id,
      timestamp: Date.now(),
      authenticated: client.isAuthenticated
    });
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const socketId = client.id;
    this.connectionStats.total--;

    this.logger.debug(`📱 Client disconnected: ${socketId}`);

    // Quick cleanup
    this.cleanupSocketData(socketId);

    // Async WhatsApp client disconnect (non-blocking)
    setImmediate(() => {
      this.whatsappService.disconnectClient(socketId);
    });
  }

  @SubscribeMessage('authenticate')
  async handleAuthenticate(client: AuthenticatedSocket, data: { token: string }) {
    try {
      const userId = await this.validateToken(data.token);
      this.setSocketAuthentication(client, userId);

      client.emit('authenticated', {
        userId,
        socketId: client.id,
        timestamp: Date.now()
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
      // Fast authentication check
      let userId = client.userId;

      if (!userId && data?.token) {
        userId = await this.validateToken(data.token);
        this.setSocketAuthentication(client, userId);
      }

      if (!userId) {
        throw new UnauthorizedException('Authentication required');
      }

      // Emit session starting immediately
      client.emit('session_starting', {
        socketId: client.id,
        timestamp: Date.now()
      });

      // Start session with optimized callback
      const { clientId } = await this.whatsappService.startSession(
        client.id,
        userId,
        (event, data) => this.emitToSocket(client.id, event, data)
      );

      if (clientId) {
        this.clientIdMap.set(client.id, clientId);
        this.connectionStats.sessions++;
      }

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Session started in ${duration}ms for ${client.id}`);

      return {
        success: true,
        clientId,
        duration,
        timestamp: Date.now()
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Session failed in ${duration}ms: ${error.message}`);

      client.emit('session_error', {
        message: 'Failed to start WhatsApp session',
        details: error.message,
        duration
      });

      throw new BadRequestException(error.message);
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    client: AuthenticatedSocket,
    payload: {
      clientId: string;
      to: string[];
      message: string;
      delay?: number;
      batchSize?: number;
    }
  ) {
    const startTime = Date.now();
    this.logger.log(`📤 Sending message for client: ${client.id}`);

    try {
      // Validate payload
      if (!payload.clientId || !payload.to?.length || !payload.message?.trim()) {
        throw new BadRequestException('Invalid message payload');
      }

      // Set reasonable defaults
      const delay = Math.max(payload.delay || 3000, 1000); // Min 1 second
      const batchSize = Math.min(payload.batchSize || 50, 100); // Max 100 per batch

      // Emit sending started
      client.emit('message_sending_started', {
        clientId: payload.clientId,
        recipientCount: payload.to.length,
        timestamp: Date.now()
      });

      const result = await this.whatsappService.sendMessage(
        payload.clientId,
        payload.to,
        payload.message,
        delay
      );

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Message sent in ${duration}ms`);

      // Emit completion
      client.emit('message_sending_completed', {
        ...result,
        duration,
        timestamp: Date.now()
      });

      return result as any;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Message failed in ${duration}ms: ${error.message}`);

      client.emit('message_sending_failed', {
        error: error.message,
        duration,
        timestamp: Date.now()
      });

      throw error;
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
      timestamp: Date.now()
    };
  }

  @SubscribeMessage('get_stats')
  async handleGetStats(client: AuthenticatedSocket) {
    return {
      ...this.connectionStats,
      activeClients: this.whatsappService.getActiveSessionCount(),
      timestamp: Date.now()
    };
  }

  // ================== PRIVATE METHODS ==================

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
    if (!token) {
      throw new UnauthorizedException('Token required');
    }

    try {
      const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
      const userId = payload.sub;

      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid userId format');
      }

      return userId;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private validateTokenSync(token: string): string {
    const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
    const userId = payload.sub;

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId format');
    }

    return userId;
  }

  private setSocketAuthentication(client: AuthenticatedSocket, userId: string) {
    client.userId = userId;
    client.isAuthenticated = true;

    // Update tracking maps
    this.socketAuth.set(client.id, userId);

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);

    this.connectionStats.authenticated++;
    this.logger.debug(`✅ Socket ${client.id} authenticated for user ${userId}`);
  }

  private cleanupSocketData(socketId: string) {
    // Remove from clientId map
    this.clientIdMap.delete(socketId);

    // Remove from user sockets
    const userId = this.socketAuth.get(socketId);
    if (userId) {
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socketId);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.socketAuth.delete(socketId);
      this.connectionStats.authenticated--;
    }
  }

  private cleanupDisconnectedSockets() {
    const connectedSockets = new Set(this.server.sockets.sockets.keys());

    for (const [socketId] of this.socketAuth) {
      if (!connectedSockets.has(socketId)) {
        this.cleanupSocketData(socketId);
      }
    }
  }

  private emitToSocket(socketId: string, event: string, data: any) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, { ...data, timestamp: Date.now() });
    }
  }

  /**
   * Optimized method to broadcast to all user sockets
   */
  broadcastToUser(userId: string, event: string, data: any) {
    const userSocketSet = this.userSockets.get(userId);
    if (!userSocketSet?.size) {
      return;
    }

    const payload = { ...data, timestamp: Date.now() };

    // Use batch emit for better performance
    const socketsToEmit = Array.from(userSocketSet)
      .map(id => this.server.sockets.sockets.get(id))
      .filter(Boolean);

    if (socketsToEmit.length > 0) {
      this.logger.debug(`📡 Broadcasting ${event} to ${socketsToEmit.length} sockets`);
      socketsToEmit.forEach(socket => socket!.emit(event, payload));
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    return {
      ...this.connectionStats,
      activeConnections: this.server.sockets.sockets.size,
      authenticatedUsers: this.userSockets.size,
      timestamp: Date.now()
    };
  }
}