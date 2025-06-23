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
import mongoose, { Types } from 'mongoose';
import { verify } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  isAuthenticated?: boolean;
  lastActivity?: number;
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

  private readonly socketAuth = new Map<string, string>(); // socket.id -> userId
  private readonly userSockets = new Map<string, Set<string>>(); // userId -> socket.ids
  private readonly socketActivity = new Map<string, number>(); // socket.id -> lastActivity

  private readonly connectionStats = {
    total: 0,
    authenticated: 0,
    sessions: 0,
  };

  private readonly SOCKET_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(private readonly whatsappService: WhatsAppService) {}

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway initialized with enhanced session management');
    
    // Periodic cleanup tasks
    // setInterval(() => this.cleanupInactiveSockets(), 60000); // 1 minute
    // setInterval(() => this.updateConnectionStats(), 30000); // 30 seconds
  }

  handleConnection(client: AuthenticatedSocket) {
    this.connectionStats.total++;
    this.socketActivity.set(client.id, Date.now());
    
    this.logger.debug(`📱 Client connected: ${client.id} (Total: ${this.connectionStats.total})`);
    
    // Try to authenticate immediately if token is available
    this.authenticateSocket(client);
    
    // Send connection acknowledgment
    client.emit('connected', {
      socketId: client.id,
      timestamp: Date.now(),
      authenticated: client.isAuthenticated || false,
      serverTime: Date.now(),
    });

    // Set up activity tracking
    this.setupActivityTracking(client);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.connectionStats.total--;
    this.logger.debug(`📱 Client disconnected: ${client.id}`);
    
  }

@SubscribeMessage('init')
async handleStartSession(client: AuthenticatedSocket, data?: { token?: string; accountId?: string }) {
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

    // Validate accountId if passed
    let accountId = data?.accountId;
    if (accountId && !mongoose.isValidObjectId(accountId)) {
      throw new BadRequestException('Invalid accountId format');
    }

    const { clientId } = await this.whatsappService.startSession(
      client.id,  // socketClientId
      userId,     // userId
      (event, data) => this.emitToSocket(client.id, event, data), // emit
      accountId // accountId
    );

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
    try {
      this.updateSocketActivity(client.id);
      
      if (!client.isAuthenticated) {
        throw new UnauthorizedException('Authentication required');
      }

      // Get detailed client info from the service
      const clientInfo = await this.whatsappService.getClientInfo(client.id);
      
      return {
        socketId: client.id,
        isAuthenticated: client.isAuthenticated,
        clientInfo,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get session status for ${client.id}: ${error.message}`);
      return {
        socketId: client.id,
        isAuthenticated: client.isAuthenticated || false,
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage('get_stats')
  async handleGetStats(client: AuthenticatedSocket) {
    try {
      this.updateSocketActivity(client.id);
      
      const serviceHealth = this.whatsappService.getHealthStatus();
      
      return {
        gateway: {
          ...this.connectionStats,
          activeConnections: this.server.sockets.sockets.size,
          authenticatedUsers: this.userSockets.size,
        },
        service: serviceHealth,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get stats: ${error.message}`);
      return {
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage('ping')
  handlePing(client: AuthenticatedSocket) {
    this.updateSocketActivity(client.id);
    return {
      pong: true,
      timestamp: Date.now(),
      socketId: client.id,
    };
  }

  @SubscribeMessage('force_cleanup')
  async handleForceCleanup(client: AuthenticatedSocket, data: { clientId?: string }) {
    try {
      this.updateSocketActivity(client.id);
      
      if (!client.isAuthenticated) {
        throw new UnauthorizedException('Authentication required');
      }

      const clientId = data?.clientId || client.id;
      this.logger.log(`🔨 Force cleanup requested for client: ${clientId} by socket: ${client.id}`);
      
      const success = await this.whatsappService.forceCleanupClient(clientId);
      
      client.emit('cleanup_result', {
        success,
        clientId,
        timestamp: Date.now(),
        message: success ? 'Cleanup initiated successfully' : 'Cleanup failed',
      });

      return { success, clientId, timestamp: Date.now() };
    } catch (error) {
      this.logger.error(`❌ Force cleanup failed: ${error.message}`);
      return { success: false, error: error.message, timestamp: Date.now() };
    }
  }

  private setupActivityTracking(client: AuthenticatedSocket) {
    // Track activity on any message
    const originalEmit = client.emit;
    client.emit = (...args) => {
      this.updateSocketActivity(client.id);
      return originalEmit.apply(client, args);
    };

    // Track activity on message reception
    client.onAny(() => {
      this.updateSocketActivity(client.id);
    });
  }

  private updateSocketActivity(socketId: string) {
    this.socketActivity.set(socketId, Date.now());
  }

  private authenticateSocket(client: AuthenticatedSocket) {
    try {
      // Try different token sources
      const token = 
        client.handshake.headers.authorization?.split(' ')[1] ||
        client.handshake.auth?.token ||
        client.handshake.query?.token as string;

      if (token) {
        const userId = this.validateTokenSync(token);
        this.setSocketAuthentication(client, userId);
        this.logger.debug(`🔐 Auto-authenticated socket ${client.id} for user ${userId}`);
      }
    } catch (error) {
      this.logger.debug(`🚫 Auto-authentication failed for socket ${client.id}: ${error.message}`);
    }
  }

  private async validateToken(token: string): Promise<string> {
    if (!token) {
      throw new UnauthorizedException('Token required');
    }

    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable not configured');
    }

    try {
      const payload = verify(token, process.env.JWT_SECRET) as { sub: string };
      const userId = payload.sub;
      
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid userId format in token');
      }
      
      return userId;
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token');
      } else if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token expired');
      }
      throw error;
    }
  }

  private validateTokenSync(token: string): string {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable not configured');
    }

    const payload = verify(token, process.env.JWT_SECRET) as { sub: string };
    const userId = payload.sub;
    
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId format in token');
    }
    
    return userId;
  }

  private setSocketAuthentication(client: AuthenticatedSocket, userId: string) {
    // Set client properties
    client.userId = userId;
    client.isAuthenticated = true;
    client.lastActivity = Date.now();
    
    // Update mappings
    this.socketAuth.set(client.id, userId);
    this.updateSocketActivity(client.id);
    
    // Add to user sockets set
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);
    
    this.connectionStats.authenticated++;
    
    this.logger.debug(`✅ Socket ${client.id} authenticated for user ${userId}`);
  }

  private cleanupSocketData(socketId: string) {
    // Remove from activity tracking
    this.socketActivity.delete(socketId);
    
    // Get user ID before cleanup
    const userId = this.socketAuth.get(socketId);
    
    if (userId) {
      // Remove from user sockets
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socketId);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      
      // Remove from auth mapping
      this.socketAuth.delete(socketId);
      this.connectionStats.authenticated--;
    }
    
    this.logger.debug(`🧹 Cleaned up socket data for ${socketId}`);
  }

  private cleanupInactiveSockets() {
    const now = Date.now();
    const inactiveSockets: string[] = [];
    
    for (const [socketId, lastActivity] of this.socketActivity.entries()) {
      if (now - lastActivity > this.SOCKET_TIMEOUT) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          this.logger.log(`🕐 Disconnecting inactive socket: ${socketId} (inactive for ${Math.round((now - lastActivity) / 60000)} minutes)`);
          socket.disconnect(true);
          inactiveSockets.push(socketId);
        } else {
          // Socket doesn't exist, clean up our tracking
          this.cleanupSocketData(socketId);
          inactiveSockets.push(socketId);
        }
      }
    }

    // Also check for sockets that exist but aren't in our activity map
    for (const [socketId] of this.socketAuth) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) {
        this.logger.debug(`🧹 Cleaning up orphaned socket data: ${socketId}`);
        this.cleanupSocketData(socketId);
      }
    }

    if (inactiveSockets.length > 0) {
      this.logger.log(`🧹 Cleaned up ${inactiveSockets.length} inactive sockets`);
    }
  }

  private updateConnectionStats() {
    // Update stats to reflect current state
    this.connectionStats.total = this.server.sockets.sockets.size;
    this.connectionStats.authenticated = this.socketAuth.size;
    
    // Log stats periodically for monitoring
    if (this.connectionStats.total > 0) {
      this.logger.debug(`📊 Stats - Total: ${this.connectionStats.total}, Auth: ${this.connectionStats.authenticated}, Sessions: ${this.connectionStats.sessions}`);
    }
  }

  private emitToSocket(socketId: string, event: string, data: any) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket) {
      const payload = { 
        ...data, 
        timestamp: Date.now(),
        socketId,
      };
      
      socket.emit(event, payload);
      this.updateSocketActivity(socketId);
      
      this.logger.debug(`📤 Emitted '${event}' to socket ${socketId}`);
    } else {
      this.logger.warn(`⚠️ Attempted to emit to non-existent socket: ${socketId}`);
    }
  }

  // Public method for broadcasting to user's sockets
  broadcastToUser(userId: string, event: string, data: any) {
    const userSocketSet = this.userSockets.get(userId);
    if (!userSocketSet?.size) {
      this.logger.debug(`👤 No active sockets found for user ${userId}`);
      return;
    }

    const payload = { 
      ...data, 
      timestamp: Date.now(),
      userId,
    };
    
    const socketsToEmit = Array.from(userSocketSet)
      .map(id => this.server.sockets.sockets.get(id))
      .filter(Boolean);

    if (socketsToEmit.length > 0) {
      this.logger.debug(`📡 Broadcasting '${event}' to ${socketsToEmit.length} sockets for user ${userId}`);
      
      socketsToEmit.forEach(socket => {
        socket!.emit(event, payload);
        this.updateSocketActivity(socket!.id);
      });
    } else {
      // Clean up orphaned user socket mappings
      this.userSockets.delete(userId);
      this.logger.debug(`🧹 Cleaned up orphaned user socket mapping for ${userId}`);
    }
  }

  // Public method for broadcasting to all authenticated sockets
  broadcastToAll(event: string, data: any) {
    const payload = {
      ...data,
      timestamp: Date.now(),
    };

    let broadcastCount = 0;
    for (const [socketId] of this.socketAuth) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, payload);
        this.updateSocketActivity(socketId);
        broadcastCount++;
      }
    }

    this.logger.debug(`📡 Broadcasted '${event}' to ${broadcastCount} authenticated sockets`);
  }

  // Get connection statistics
  getConnectionStats() {
    const activeConnections = this.server.sockets.sockets.size;
    const authenticatedUsers = this.userSockets.size;
    const totalSockets = this.socketAuth.size;

    return {
      gateway: {
        ...this.connectionStats,
        activeConnections,
        authenticatedUsers,
        totalSockets,
        socketActivity: this.socketActivity.size,
      },
      timestamp: Date.now(),
    };
  }

  // Get user's active sockets
  getUserSockets(userId: string): string[] {
    const userSocketSet = this.userSockets.get(userId);
    return userSocketSet ? Array.from(userSocketSet) : [];
  }

  // Check if user has active connections
  isUserConnected(userId: string): boolean {
    const userSockets = this.userSockets.get(userId);
    if (!userSockets?.size) return false;

    // Verify at least one socket is actually connected
    for (const socketId of userSockets) {
      if (this.server.sockets.sockets.has(socketId)) {
        return true;
      }
    }

    // Clean up if no valid sockets found
    this.userSockets.delete(userId);
    return false;
  }

  // Force disconnect user's sockets
  disconnectUser(userId: string, reason?: string) {
    const userSocketSet = this.userSockets.get(userId);
    if (!userSocketSet?.size) return;

    this.logger.log(`🚫 Disconnecting all sockets for user ${userId}${reason ? `: ${reason}` : ''}`);

    const sockets = Array.from(userSocketSet)
      .map(id => this.server.sockets.sockets.get(id))
      .filter(Boolean);

    sockets.forEach(socket => {
      if (reason) {
        socket!.emit('force_disconnect', {
          reason,
          timestamp: Date.now(),
        });
      }
      socket!.disconnect(true);
    });

    this.logger.log(`🚫 Disconnected ${sockets.length} sockets for user ${userId}`);
  }

  // Emergency cleanup - use with caution
  async emergencyCleanup() {
    this.logger.warn('🚨 Emergency cleanup initiated');

    // Disconnect all sockets
    this.server.disconnectSockets(true);

    // Clear all mappings
    this.socketAuth.clear();
    this.userSockets.clear();
    this.socketActivity.clear();

    // Reset stats
    this.connectionStats.total = 0;
    this.connectionStats.authenticated = 0;

    this.logger.warn('🚨 Emergency cleanup completed');
  }
}