import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AutoResponderService } from './auto-responder.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

interface MessageAnalytics {
  totalMessages: number;
  processedMessages: number;
  skippedMessages: number;
  autoResponses: number;
  errors: number;
  startTime: string;
}

@Injectable()
export class AutoResponderInitializer implements OnModuleInit {
  private readonly logger = new Logger(AutoResponderInitializer.name);
  private analytics: MessageAnalytics = {
    totalMessages: 0,
    processedMessages: 0,
    skippedMessages: 0,
    autoResponses: 0,
    errors: 0,
    startTime: new Date().toISOString()
  };

  constructor(
    private readonly autoResponderService: AutoResponderService,
    private readonly whatsAppService: WhatsAppService,
  ) { }

  async onModuleInit() {
    this.logger.log('🚀 Initializing enhanced auto-responder with message listener...');

    // ✅ Register the message handler with improved processing
    this.whatsAppService.registerMessageHandler(async (message, accountId) => {
      await this.processMessage(message, accountId);
    });

    // ✅ Set up periodic analytics logging
    setInterval(() => {
      this.logAnalytics();
    }, 300000); // Every 5 minutes

    this.logger.log('✅ Enhanced auto-responder initialized successfully');
  }

  /**
   * Process incoming message with comprehensive handling
   */
  private async processMessage(message: any, accountId: string): Promise<void> {
    try {
      this.analytics.totalMessages++;

      // ✅ Enhanced logging for debugging
      this.logger.log(`📨 INCOMING MESSAGE #${this.analytics.totalMessages}`);
      this.logger.log(`   From: ${message.from} | Account: ${accountId}`);
      this.logger.log(`   Type: ${message.type || 'text'} | HasMedia: ${message.hasMedia || false}`);
      this.logger.log(`   Body: "${(message.body || '[No text content]').substring(0, 100)}"`);
      this.logger.log(`   Timestamp: ${message.timestamp ? new Date(message.timestamp).toISOString() : 'Unknown'}`);

      // ✅ Comprehensive message analysis
      await this.analyzeMessage(message, accountId);

      // ✅ Validate message for auto-response processing
      const validation = this.validateMessageForAutoResponse(message);
      if (!validation.isValid) {
        this.analytics.skippedMessages++;
        this.logger.debug(`⏭️ Skipping message: ${validation.reason}`);
        return;
      }

      // ✅ Process auto-response
      this.analytics.processedMessages++;
      this.logger.log(`🤖 Processing auto-response for message from ${message.from}`);

      const responded = await this.autoResponderService.handleIncomingMessage(
        message.body.trim(),
        message.from, // Already processed sender
        accountId
      );

      if (responded) {
        this.analytics.autoResponses++;
        this.logger.log(`✅ Auto-response sent to ${message.from} (Total responses: ${this.analytics.autoResponses})`);
      } else {
        this.logger.debug(`❌ No auto-response sent to ${message.from}`);
      }

    } catch (error) {
      this.analytics.errors++;
      this.logger.error(`❌ Error processing message for auto-response: ${error.message}`, error.stack);
    }
  }

  /**
   * Validate if message should be processed for auto-response
   */
  private validateMessageForAutoResponse(message: any): { isValid: boolean; reason?: string } {
    // ✅ Check if message has text content
    if (!message.body || typeof message.body !== 'string' || !message.body.trim()) {
      return { isValid: false, reason: 'No text content' };
    }

    // ✅ Skip group messages (if enabled)
    if (message.isGroupMsg) {
      return { isValid: false, reason: 'Group message' };
    }

    // ✅ Skip forwarded messages (optional - you can enable this)
    if (message.isForwarded) {
      // return { isValid: false, reason: 'Forwarded message' };
    }

    // ✅ Skip very short messages (optional)
    if (message.body.trim().length < 2) {
      return { isValid: false, reason: 'Message too short' };
    }

    // ✅ Skip messages that look like automated responses
    const lowerBody = message.body.toLowerCase();
    const automatedKeywords = ['delivered', 'read receipt', 'typing', 'online', 'auto-reply'];
    if (automatedKeywords.some(keyword => lowerBody.includes(keyword))) {
      return { isValid: false, reason: 'Automated message detected' };
    }

    return { isValid: true };
  }

  /**
   * Analyze message content and patterns
   */
  private async analyzeMessage(message: any, accountId: string): Promise<void> {
    try {
      if (!message.body) return;

      const content = message.body.toLowerCase().trim();
      const sender = message.from;

      // ✅ Detect message patterns
      const patterns = {
        isQuestion: content.includes('?') || content.startsWith('what') || content.startsWith('how') || content.startsWith('when'),
        isGreeting: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'].some(g => content.includes(g)),
        isUrgent: ['urgent', 'emergency', 'asap', 'immediately'].some(u => content.includes(u)),
        isInquiry: ['price', 'cost', 'buy', 'purchase', 'order', 'service'].some(i => content.includes(i)),
        isPotentialSpam: content.includes('click here') || content.includes('www.') || /\d{10,}/.test(content),
        hasEmojis: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u.test(content)
      };

      // ✅ Log interesting patterns
      const detectedPatterns = Object.entries(patterns).filter(([_, detected]) => detected).map(([pattern]) => pattern);
      if (detectedPatterns.length > 0) {
        this.logger.log(`🔍 Detected patterns from ${sender}: ${detectedPatterns.join(', ')}`);
      }

      // ✅ Special handling for urgent messages
      if (patterns.isUrgent) {
        this.logger.warn(`🚨 URGENT MESSAGE from ${sender}: "${content.substring(0, 100)}"`);
      }

      // ✅ Log potential business inquiries
      if (patterns.isInquiry) {
        this.logger.log(`💼 BUSINESS INQUIRY from ${sender}: "${content.substring(0, 100)}"`);
      }

      // ✅ Flag potential spam
      if (patterns.isPotentialSpam) {
        this.logger.warn(`⚠️ POTENTIAL SPAM from ${sender}: "${content.substring(0, 100)}"`);
      }

    } catch (error) {
      this.logger.error(`❌ Error analyzing message: ${error.message}`);
    }
  }

  /**
   * Log analytics periodically
   */
  private logAnalytics(): void {
    const uptime = Date.now() - new Date(this.analytics.startTime).getTime();
    const uptimeHours = Math.round(uptime / (1000 * 60 * 60) * 10) / 10;

    const messagesPerHour = uptimeHours > 0 ? Math.round(this.analytics.totalMessages / uptimeHours) : 0;
    const responseRate = this.analytics.processedMessages > 0
      ? Math.round((this.analytics.autoResponses / this.analytics.processedMessages) * 100)
      : 0;

    this.logger.log('📊 AUTO-RESPONDER ANALYTICS');
    this.logger.log(`   Uptime: ${uptimeHours}h | Messages/hour: ${messagesPerHour}`);
    this.logger.log(`   Total messages: ${this.analytics.totalMessages}`);
    this.logger.log(`   Processed: ${this.analytics.processedMessages} | Skipped: ${this.analytics.skippedMessages}`);
    this.logger.log(`   Auto-responses: ${this.analytics.autoResponses} (${responseRate}% response rate)`);
    this.logger.log(`   Errors: ${this.analytics.errors}`);
  }

  // ✅ PUBLIC METHODS FOR DEBUGGING

  /**
   * Get message processing statistics
   */
  getMessageStats() {
    const uptime = Date.now() - new Date(this.analytics.startTime).getTime();
    const responseRate = this.analytics.processedMessages > 0
      ? Math.round((this.analytics.autoResponses / this.analytics.processedMessages) * 100)
      : 0;

    return {
      ...this.analytics,
      uptime: {
        milliseconds: uptime,
        hours: Math.round(uptime / (1000 * 60 * 60) * 10) / 10,
        formatted: this.formatUptime(uptime)
      },
      rates: {
        responseRate: `${responseRate}%`,
        messagesPerHour: uptime > 0 ? Math.round(this.analytics.totalMessages / (uptime / (1000 * 60 * 60))) : 0,
        errorsPercentage: this.analytics.totalMessages > 0
          ? `${Math.round((this.analytics.errors / this.analytics.totalMessages) * 100)}%`
          : '0%'
      }
    };
  }

  /**
   * Reset analytics
   */
  resetAnalytics(): void {
    this.analytics = {
      totalMessages: 0,
      processedMessages: 0,
      skippedMessages: 0,
      autoResponses: 0,
      errors: 0,
      startTime: new Date().toISOString()
    };
    this.logger.log('🔄 Auto-responder analytics reset');
  }

  /**
   * Get comprehensive status
   */
  getStatus() {
    return {
      initialized: true,
      analytics: this.getMessageStats(),
      handlerRegistered: true, // We registered in onModuleInit
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}