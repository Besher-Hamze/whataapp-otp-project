import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  BadRequestException,
  UseGuards,
  Query,
  Delete,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppGateway } from './whatsapp.gateway';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Account, AccountDocument } from '../accounts/schema/account.schema';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { GetUserId, GetWhatsappAccountId } from 'src/common/decorators';
import { NewMessageDto } from './dto/message.dto';
import { AccountsService } from '../accounts/accounts.service';

@UseGuards(JwtGuard)
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappGateway: WhatsAppGateway,
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
    private readonly accountsService: AccountsService,
  ) { }

  @Get('start')
  async startSession() {
    return {
      message: 'Use WebSocket connection to /whatsapp and emit "init" event to start a WhatsApp session.',
      websocket: {
        endpoint: '/whatsapp',
        events: {
          init: 'Start a new WhatsApp session',
          authenticate: 'Authenticate with JWT token',
          get_session_status: 'Get current session status',
          get_stats: 'Get system statistics',
        }
      },
      timestamp: Date.now(),
    };
  }

  @Post('send-message')
  async sendMessage(
    @Body() body: NewMessageDto,
    @GetUserId() userId: string,
    @GetWhatsappAccountId() accountId: string,
    @Query('delay') delay?: number,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`📤 Message send request from user ${userId} for account ${accountId}`);

      // Validate input
      if (!body.to || !Array.isArray(body.to) || body.to.length === 0) {
        throw new BadRequestException('Recipients (to) must be a non-empty array');
      }

      if (!body.message || typeof body.message !== 'string') {
        throw new BadRequestException('Message content is required and must be a string');
      }

      // Find client by account ID
      const client = await this.accountsService.findClientIdByAccountId(accountId, userId);
      if (!client) {
        throw new BadRequestException('Account not found or does not belong to user');
      }

      // Validate delay parameter
      let messageDelay = 5000; // Default 5 seconds
      if (delay !== undefined) {
        const parsedDelay = parseInt(delay.toString(), 10);
        if (isNaN(parsedDelay)) {
          throw new BadRequestException('Delay must be a valid number');
        }
        if (parsedDelay < 1000 || parsedDelay > 60000) {
          throw new BadRequestException('Delay must be between 1000ms and 60000ms (1-60 seconds)');
        }
        messageDelay = parsedDelay;
      }

      // Check if client is ready
      // if (!this.whatsappService.isClientReady(client.clientId)) {
      //   throw new HttpException(
      //     'WhatsApp client is not ready. Please ensure the session is connected.',
      //     HttpStatus.SERVICE_UNAVAILABLE
      //   );
      // }

      this.logger.log(`📤 Sending message via client ${client.clientId} with ${messageDelay}ms delay`);

      // Send the message
      const result = await this.whatsappService.sendMessage(
        client.clientId,
        body.to,
        body.message,
        messageDelay,
      );

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Message send completed in ${duration}ms`);

      // Broadcast success to user's sockets if needed
      this.whatsappGateway.broadcastToUser(userId, 'message_sent', {
        accountId,
        clientId: client.clientId,
        result,
        duration,
      });

      return {
        ...result,
        duration,
        timestamp: Date.now(),
        accountId,
        clientId: client.clientId,
      } as any;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Message send failed in ${duration}ms: ${error.message}`);

      // Broadcast error to user's sockets
      this.whatsappGateway.broadcastToUser(userId, 'message_send_error', {
        accountId,
        error: error.message,
        duration,
      });

      // Re-throw the error with additional context
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to send message: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('sessions')
  async getSessions(@GetUserId() userId: string) {
    try {
      const accounts = await this.whatsappService.getUserAccounts(userId);
      let sessionInfo: any[] = [];

      for (const account of accounts) {
        const clientInfo = account.clientId
          ? await this.whatsappService.getClientInfo(account.clientId)
          : null;

        sessionInfo.push({
          accountId: account._id,
          clientId: account.clientId,
          phoneNumber: account.phone_number,
          name: account.name,
          status: account.status,
          createdAt: (account as any).created_at,
          disconnectedAt: (account as any).disconnected_at,
          clientReady: clientInfo?.isReady || false,
          clientInfo,
        });
      }

      return {
        sessions: sessionInfo,
        total: sessionInfo.length,
        active: sessionInfo.filter(s => s.clientReady).length,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get sessions for user ${userId}: ${error.message}`);
      throw new HttpException(
        'Failed to retrieve sessions',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('session-count')
  getSessionCount(@GetUserId() userId: string) {
    try {
      const healthStatus = this.whatsappService.getHealthStatus() as any;
      const gatewayStats = this.whatsappGateway.getConnectionStats();

      return {
        service: {
          totalSessions: healthStatus.metrics.totalClients,
          readySessions: healthStatus.metrics.readyClients,
          sendingSessions: healthStatus.metrics.sendingClients,
        },
        gateway: gatewayStats.gateway,
        user: {
          isConnected: this.whatsappGateway.isUserConnected(userId),
          activeSockets: this.whatsappGateway.getUserSockets(userId).length,
        },
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get session count: ${error.message}`);
      throw new HttpException(
        'Failed to get session statistics',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('health')
  getHealth() {
    try {
      const serviceHealth = this.whatsappService.getHealthStatus();
      const gatewayStats = this.whatsappGateway.getConnectionStats();

      return {
        status: 'healthy',
        service: serviceHealth,
        gateway: gatewayStats,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  @Delete('account/:id')
  async deleteAccount(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    try {
      this.logger.log(`🗑️ Delete account request: ${id} by user ${userId}`);

      // Verify account belongs to user
      const account = await this.accountModel.findOne({
        _id: id,
        user: userId
      }).exec();

      if (!account) {
        throw new BadRequestException('Account not found or does not belong to user');
      }

      // Delete the account (this will also cleanup the WhatsApp client)
      const result = await this.whatsappService.deleteAccount(id);

      this.logger.log(`✅ Account ${id} deleted successfully`);

      // Broadcast deletion to user's sockets
      this.whatsappGateway.broadcastToUser(userId, 'account_deleted', {
        accountId: id,
        phoneNumber: account.phone_number,
        clientId: account.clientId,
      });

      return {
        ...result,
        accountId: id,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to delete account ${id}: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        `Failed to delete account: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('account/:id/force-cleanup')
  async forceCleanupAccount(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    try {
      this.logger.log(`🔨 Force cleanup request for account: ${id} by user ${userId}`);

      // Verify account belongs to user
      const account = await this.accountModel.findOne({
        _id: id,
        user: userId
      }).exec();

      if (!account) {
        throw new BadRequestException('Account not found or does not belong to user');
      }

      if (!account.clientId) {
        throw new BadRequestException('Account has no active client to cleanup');
      }

      // Force cleanup the client
      const success = await this.whatsappService.forceCleanupClient(account.clientId);

      this.logger.log(`${success ? '✅' : '❌'} Force cleanup ${success ? 'successful' : 'failed'} for account ${id}`);

      // Broadcast cleanup result to user's sockets
      this.whatsappGateway.broadcastToUser(userId, 'force_cleanup_result', {
        accountId: id,
        clientId: account.clientId,
        success,
      });

      return {
        success,
        message: success ? 'Cleanup initiated successfully' : 'Cleanup failed',
        accountId: id,
        clientId: account.clientId,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Force cleanup failed for account ${id}: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        `Force cleanup failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('accounts')
  async getAccounts(@GetUserId() userId: string) {
    try {
      const accounts = await this.accountModel
        .find({ user: userId })
        .sort({ created_at: -1 })
        .lean()
        .exec();

      // Enhance accounts with client status
      const enhancedAccounts = await Promise.all(
        accounts.map(async (account) => {
          let clientInfo = null;
          let clientReady = false;

          if (account.clientId) {
            clientInfo = await this.whatsappService.getClientInfo(account.clientId) as any;
            clientReady = this.whatsappService.isClientReady(account.clientId);
          }

          return {
            ...account,
            clientReady,
            clientInfo: clientInfo ? {
              isReady: (clientInfo as any).isReady,
              isSending: (clientInfo as any).isSending,
              lastActivity: (clientInfo as any).lastActivity,
              reconnectAttempts: (clientInfo as any).reconnectAttempts,
            } : null,
          };
        })
      );

      return {
        accounts: enhancedAccounts,
        total: enhancedAccounts.length,
        active: enhancedAccounts.filter(acc => acc.clientReady).length,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get accounts for user ${userId}: ${error.message}`);
      throw new HttpException(
        'Failed to retrieve accounts',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('accounts/:id')
  async getAccountById(
    @Param('id') id: string,
    @GetUserId() userId: string
  ) {
    try {
      const account = await this.accountModel.findOne({
        _id: id,
        user: userId
      }).lean().exec();

      if (!account) {
        throw new BadRequestException('Account not found or does not belong to user');
      }

      // Add client status information
      let clientInfo = null;
      let clientReady = false;

      if (account.clientId) {
        clientInfo = await this.whatsappService.getClientInfo(account.clientId) as any;
        clientReady = this.whatsappService.isClientReady(account.clientId);
      }

      return {
        ...account,
        clientReady,
        clientInfo,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get account ${id}: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve account',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('broadcast')
  async broadcastMessage(
    @Body() body: { event: string; data: any; userIds?: string[] },
    @GetUserId() userId: string
  ) {
    try {
      if (!body.event) {
        throw new BadRequestException('Event name is required');
      }

      if (body.userIds && Array.isArray(body.userIds)) {
        // Broadcast to specific users
        for (const targetUserId of body.userIds) {
          this.whatsappGateway.broadcastToUser(targetUserId, body.event, {
            ...body.data,
            fromUser: userId,
          });
        }
      } else {
        // Broadcast to all authenticated sockets
        this.whatsappGateway.broadcastToAll(body.event, {
          ...body.data,
          fromUser: userId,
        });
      }

      return {
        message: 'Broadcast sent successfully',
        event: body.event,
        targetUsers: body.userIds || 'all',
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Broadcast failed: ${error.message}`);
      throw new HttpException(
        `Broadcast failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('restore-session/:clientId')
  async restoreSession(
    @Param('clientId') clientId: string,
    @GetUserId() userId: string
  ) {
    try {
      this.logger.log(`🔄 Session restoration request for clientId: ${clientId} by user: ${userId}`);

      // Verify the client belongs to the user
      const account = await this.accountModel.findOne({
        clientId,
        user: userId
      }).exec();

      if (!account) {
        throw new BadRequestException('Session not found or does not belong to user');
      }

      // Check if session is already active
      if (this.whatsappService.isClientReady(clientId)) {
        return {
          message: 'Session is already active',
          clientId,
          isReady: true,
          timestamp: Date.now(),
        };
      }

      // Attempt to restore the session
      const success = await this.whatsappService.restoreSpecificSession(clientId, userId);

      this.logger.log(`${success ? '✅' : '❌'} Session restoration ${success ? 'successful' : 'failed'} for ${clientId}`);

      return {
        success,
        message: success ? 'Session restored successfully' : 'Failed to restore session',
        clientId,
        accountId: account._id,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Session restoration failed for ${clientId}: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        `Session restoration failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('restored-sessions')
  async getRestoredSessions(@GetUserId() userId: string) {
    try {
      const restoredSessions = this.whatsappService.getRestoredSessions();
      const userSessions: any = [];

      for (const clientId of restoredSessions) {
        const account = await this.accountModel.findOne({
          clientId,
          user: userId
        }).lean().exec();

        if (account) {
          const clientInfo = await this.whatsappService.getClientInfo(clientId);
          userSessions.push({
            clientId,
            accountId: account._id,
            phoneNumber: account.phone_number,
            name: account.name,
            status: account.status,
            clientInfo,
            restoredAt: account.sessionData?.lastConnected,
          });
        }
      }

      return {
        restoredSessions: userSessions,
        total: userSessions.length,
        active: userSessions.filter(s => s.clientInfo?.isReady).length,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get restored sessions for user ${userId}: ${error.message}`);
      throw new HttpException(
        'Failed to retrieve restored sessions',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('session-status/:clientId')
  async getSessionStatus(
    @Param('clientId') clientId: string,
    @GetUserId() userId: string
  ) {
    try {
      // Verify the client belongs to the user
      const account = await this.accountModel.findOne({
        clientId,
        user: userId
      }).lean().exec();

      if (!account) {
        throw new BadRequestException('Session not found or does not belong to user');
      }

      const clientInfo = await this.whatsappService.getClientInfo(clientId);
      const isReady = this.whatsappService.isClientReady(clientId);

      return {
        clientId,
        accountId: account._id,
        phoneNumber: account.phone_number,
        isReady,
        clientInfo,
        accountStatus: account.status,
        sessionData: account.sessionData,
        timestamp: Date.now(),
      };

    } catch (error) {
      this.logger.error(`❌ Failed to get session status for ${clientId}: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        'Failed to get session status',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}