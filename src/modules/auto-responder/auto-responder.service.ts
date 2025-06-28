import { Injectable, Logger } from '@nestjs/common';
import { RulesService } from '../rules/rules.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AccountsService } from '../accounts/accounts.service';

interface AutoResponseStats {
  totalMessagesReceived: number;
  rulesMatched: number;
  responsesSent: number;
  responsesFailedToSend: number;
  skippedOldMessages: number;
  lastResponseAt?: string;
  averageResponseTime: number;
}

interface ResponseAttempt {
  messageId: string;
  sender: string;
  message: string;
  matchedRule?: any;
  responseTime: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

@Injectable()
export class AutoResponderService {
  private readonly logger = new Logger(AutoResponderService.name);
  private readonly responseHistory = new Map<string, ResponseAttempt[]>(); // accountId -> responses
  private readonly recentResponses = new Map<string, number>(); // sender -> timestamp to prevent spam
  private readonly stats = new Map<string, AutoResponseStats>(); // accountId -> stats

  // ✅ Prevent spam responses (same sender within this time won't get another response)
  private readonly SPAM_PREVENTION_WINDOW_MS = 60000; // 1 minute
  private readonly MAX_RESPONSE_HISTORY = 100; // Keep last 100 responses per account

  constructor(
    private readonly rulesService: RulesService,
    private readonly whatsAppService: WhatsAppService,
    private readonly accountsService: AccountsService,
  ) {
    // Clean up old response history every hour
    setInterval(() => {
      this.cleanupOldResponses();
    }, 3600000); // 1 hour
  }

  /**
   * Handle incoming message based on rules
   * @param message Incoming message text
   * @param sender Sender phone number (already processed, no @c.us suffix)
   * @param accountId WhatsApp account ID that received the message
   * @returns Boolean indicating if a response was sent
   */
  async handleIncomingMessage(message: string, sender: string, accountId: string): Promise<boolean> {
    const startTime = Date.now();

    try {
      // ✅ Initialize stats if needed
      if (!this.stats.has(accountId)) {
        this.initializeStats(accountId);
      }
      const accountStats = this.stats.get(accountId)!;
      accountStats.totalMessagesReceived++;

      this.logger.debug(`🔍 Auto-responder processing message from ${sender} for account ${accountId}`);

      // ✅ Validate inputs
      if (!message || !message.trim()) {
        this.logger.debug(`⏭️ Skipping empty message from ${sender}`);
        return false;
      }

      // ✅ Check spam prevention
      const senderKey = `${accountId}:${sender}`;
      const lastResponseTime = this.recentResponses.get(senderKey);
      // if (lastResponseTime && (Date.now() - lastResponseTime) < this.SPAM_PREVENTION_WINDOW_MS) {
      //   this.logger.debug(`⏭️ Skipping response to ${sender} - too recent (spam prevention)`);
      //   return false;
      // }

      // ✅ Get account details
      const account = await this.accountsService.findById(accountId);
      if (!account) {
        this.logger.warn(`❌ Account ${accountId} not found for incoming message from ${sender}`);
        return false;
      }

      if (!account.clientId) {
        this.logger.warn(`❌ Account ${accountId} has no client ID`);
        return false;
      }

      // ✅ Check if client is ready
      if (!this.whatsAppService.isClientReady(account.clientId)) {
        this.logger.warn(`❌ Client ${account.clientId} is not ready for account ${accountId}`);
        return false;
      }

      // ✅ Find matching rule with enhanced matching
      const matchingRule = await this.findBestMatchingRule(message, accountId);
      if (!matchingRule) {
        this.logger.debug(`❌ No matching rule found for message "${message.substring(0, 50)}" from ${sender}`);
        this.recordResponse(accountId, {
          messageId: `${Date.now()}_${sender}`,
          sender,
          message: message.substring(0, 100),
          responseTime: Date.now() - startTime,
          success: false,
          error: 'No matching rule',
          timestamp: new Date().toISOString()
        });
        return false;
      }

      this.logger.log(`🎯 Found matching rule with keywords "${matchingRule.keywords.join(', ')}" for message from ${sender}`);
      accountStats.rulesMatched++;

      // ✅ Send auto-response
      const response = await this.sendAutoResponse(account.clientId, sender, matchingRule.response);
      const responseTime = Date.now() - startTime;

      if (response.success) {
        accountStats.responsesSent++;
        accountStats.lastResponseAt = new Date().toISOString();
        accountStats.averageResponseTime = this.calculateAverageResponseTime(accountId, responseTime);

        // ✅ Record successful response
        this.recentResponses.set(senderKey, Date.now());
        this.recordResponse(accountId, {
          messageId: response.messageId || `${Date.now()}_${sender}`,
          sender,
          message: message.substring(0, 100),
          matchedRule: {
            keywords: matchingRule.keywords,
            response: matchingRule.response.substring(0, 50)
          },
          responseTime,
          success: true,
          timestamp: new Date().toISOString()
        });

        this.logger.log(`✅ Auto-response sent to ${sender} in ${responseTime}ms using rule with keywords "${matchingRule.keywords.join(', ')}"`);
        return true;
      } else {
        accountStats.responsesFailedToSend++;
        this.recordResponse(accountId, {
          messageId: `${Date.now()}_${sender}`,
          sender,
          message: message.substring(0, 100),
          matchedRule: {
            keywords: matchingRule.keywords,
            response: matchingRule.response.substring(0, 50)
          },
          responseTime,
          success: false,
          error: response.error,
          timestamp: new Date().toISOString()
        });

        this.logger.error(`❌ Failed to send auto-response to ${sender}: ${response.error}`);
        return false;
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.stats.get(accountId)!.responsesFailedToSend++;

      this.recordResponse(accountId, {
        messageId: `${Date.now()}_${sender}`,
        sender,
        message: message.substring(0, 100),
        responseTime,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`❌ Error handling incoming message from ${sender} for account ${accountId}: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Enhanced rule matching with priority and context awareness
   */
  private async findBestMatchingRule(message: string, accountId: string): Promise<any> {
    try {
      const rules = await this.rulesService.findAllRules(accountId);
      if (rules.length === 0) {
        return null;
      }

      const messageLower = message.toLowerCase().trim();
      let bestMatch: any = null;
      let bestScore = 0;

      for (const rule of rules) {
        const score = this.calculateRuleMatchScore(messageLower, rule);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = rule;
        }
      }

      // Only return if we have a meaningful match (score > 0)
      return bestScore > 0 ? bestMatch : null;

    } catch (error) {
      this.logger.error(`❌ Error finding matching rule for account ${accountId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate match score for a rule (higher score = better match)
   */
  private calculateRuleMatchScore(message: string, rule: any): number {
    let score = 0;

    for (const keyword of rule.keywords) {
      const keywordLower = keyword.toLowerCase().trim();

      // Exact match (highest score)
      if (message === keywordLower) {
        score += 100;
        continue;
      }

      // Word boundary match (high score)
      const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(keywordLower)}\\b`, 'i');
      if (wordBoundaryRegex.test(message)) {
        score += 50;
        continue;
      }

      // Contains match (medium score)
      if (message.includes(keywordLower)) {
        score += 25;
        continue;
      }

      // Fuzzy match for typos (low score)
      if (this.fuzzyMatch(message, keywordLower)) {
        score += 10;
      }
    }

    return score;
  }

  /**
   * Simple fuzzy matching for common typos
   */
  private fuzzyMatch(text: string, keyword: string): boolean {
    if (keyword.length < 3) return false; // Skip fuzzy matching for very short keywords

    // Check if most characters match (allowing for 1-2 character differences)
    const maxDifferences = Math.floor(keyword.length / 4);
    let differences = 0;

    for (let i = 0; i < Math.min(text.length, keyword.length); i++) {
      if (text[i] !== keyword[i]) {
        differences++;
        if (differences > maxDifferences) {
          return false;
        }
      }
    }

    return differences <= maxDifferences;
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Send auto-response with error handling
   */
  private async sendAutoResponse(clientId: string, sender: string, responseText: string): Promise<{ success: boolean, error?: string, messageId?: string }> {
    try {
      const result = await this.whatsAppService.sendMessage(
        clientId,
        [sender],
        responseText,
        1000 // 1 second delay
      );

      if (result && (result.results?.[0]?.status === 'sent' || result.results?.[0]?.status === 'likely_sent')) {
        return {
          success: true,
          messageId: result.results[0].messageId
        };
      } else {
        const error = result?.results?.[0]?.error || 'Unknown send error';
        return { success: false, error };
      }

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Record response attempt for analytics
   */
  private recordResponse(accountId: string, response: ResponseAttempt): void {
    if (!this.responseHistory.has(accountId)) {
      this.responseHistory.set(accountId, []);
    }

    const history = this.responseHistory.get(accountId)!;
    history.push(response);

    // Keep only recent responses
    if (history.length > this.MAX_RESPONSE_HISTORY) {
      history.shift();
    }
  }

  /**
   * Initialize stats for an account
   */
  private initializeStats(accountId: string): void {
    this.stats.set(accountId, {
      totalMessagesReceived: 0,
      rulesMatched: 0,
      responsesSent: 0,
      responsesFailedToSend: 0,
      skippedOldMessages: 0,
      averageResponseTime: 0
    });
  }

  /**
   * Calculate average response time
   */
  private calculateAverageResponseTime(accountId: string, newResponseTime: number): number {
    const history = this.responseHistory.get(accountId) || [];
    const successfulResponses = history.filter(r => r.success);

    if (successfulResponses.length === 0) {
      return newResponseTime;
    }

    const totalTime = successfulResponses.reduce((sum, r) => sum + r.responseTime, 0) + newResponseTime;
    return Math.round(totalTime / (successfulResponses.length + 1));
  }

  /**
   * Clean up old response data
   */
  private cleanupOldResponses(): void {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    // Clean up recent responses map
    for (const [key, timestamp] of this.recentResponses.entries()) {
      if (timestamp < oneDayAgo) {
        this.recentResponses.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`🧹 Cleaned up ${cleanedCount} old response timestamps`);
    }
  }

  // ✅ PUBLIC METHODS FOR MONITORING AND DEBUGGING

  /**
   * Get comprehensive stats for an account
   */
  async getAutoResponseStats(accountId: string) {
    try {
      const rules = await this.rulesService.findAllRules(accountId);
      const account = await this.accountsService.findById(accountId);
      const stats = this.stats.get(accountId) || this.initializeStats(accountId);
      const history = this.responseHistory.get(accountId) || [];

      return {
        accountId,
        clientId: account?.clientId,
        isClientReady: account?.clientId ? this.whatsAppService.isClientReady(account.clientId) : false,
        stats: { ...stats },
        rules: {
          count: rules.length,
          list: rules.map((rule: any) => ({
            id: rule._id,
            keywords: rule.keywords,
            response: rule.response.substring(0, 50) + (rule.response.length > 50 ? '...' : '')
          }))
        },
        recentResponses: history.slice(-10), // Last 10 responses
        spamPrevention: {
          activeBlocks: Array.from(this.recentResponses.entries())
            .filter(([key]) => key.startsWith(`${accountId}:`))
            .map(([key, timestamp]) => ({
              sender: key.split(':')[1],
              blockedUntil: new Date(timestamp + this.SPAM_PREVENTION_WINDOW_MS).toISOString()
            }))
        }
      };
    } catch (error) {
      this.logger.error(`Error getting auto-response stats for ${accountId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get overall system stats
   */
  getSystemStats() {
    const allStats = Array.from(this.stats.values());
    const totalHistory = Array.from(this.responseHistory.values()).flat();

    return {
      totalAccounts: this.stats.size,
      totalMessagesReceived: allStats.reduce((sum, s) => sum + s.totalMessagesReceived, 0),
      totalResponsesSent: allStats.reduce((sum, s) => sum + s.responsesSent, 0),
      totalRulesMatched: allStats.reduce((sum, s) => sum + s.rulesMatched, 0),
      totalFailures: allStats.reduce((sum, s) => sum + s.responsesFailedToSend, 0),
      averageResponseTime: allStats.length > 0
        ? Math.round(allStats.reduce((sum, s) => sum + s.averageResponseTime, 0) / allStats.length)
        : 0,
      recentActivity: totalHistory.slice(-20), // Last 20 responses across all accounts
      spamPreventionActive: this.recentResponses.size,
    };
  }

  /**
   * Reset stats for an account
   */
  resetAccountStats(accountId: string): void {
    this.stats.delete(accountId);
    this.responseHistory.delete(accountId);

    // Clear spam prevention for this account
    for (const [key] of this.recentResponses.entries()) {
      if (key.startsWith(`${accountId}:`)) {
        this.recentResponses.delete(key);
      }
    }

    this.logger.log(`🔄 Reset auto-responder stats for account: ${accountId}`);
  }
}