import { Injectable, Logger } from '@nestjs/common';
import { RulesService } from '../rules/rules.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class AutoResponderService {
  private readonly logger = new Logger(AutoResponderService.name);

  constructor(
    private readonly rulesService: RulesService,
    private readonly whatsAppService: WhatsAppService,
    private readonly accountsService: AccountsService,
  ) {}

  /**
   * Handle incoming message based on rules
   * @param message Incoming message text
   * @param sender Sender phone number
   * @param accountId WhatsApp account ID that received the message
   * @returns Boolean indicating if a response was sent
   */
  async handleIncomingMessage(message: string, sender: string, accountId: string): Promise<boolean> {
    try {
      // Get the account details to find which user this account belongs to
      const account = await this.accountsService.findById(accountId);
      if (!account) {
        this.logger.warn(`Account ${accountId} not found for incoming message`);
        return false;
      }

      // Extract user ID from the account
      const userId = account.user.toString();
      
      // Find a matching rule for this message and user
      const matchingRule = await this.rulesService.findMatchingRule(message, userId);
      
      if (!matchingRule) {
        this.logger.debug(`No matching rule found for message "${message}" from user ${userId}`);
        return false;
      }
      
      // We found a rule, send the response with a delay
      this.logger.log(`Found matching rule "${matchingRule.keyword}" for message "${message}"`);
      
      // Check if client is ready
      if (!account.clientId) {
        this.logger.warn(`Account ${accountId} has no client ID`);
        return false;
      }
      
      // Send the auto-response with a 1-second delay
      await this.whatsAppService.sendMessage(
        account.clientId,
        [sender],
        matchingRule.response,
        1000
      );
      
      this.logger.log(`Auto-response sent to ${sender} using rule "${matchingRule.keyword}"`);
      return true;
    } catch (error) {
      this.logger.error(`Error handling incoming message: ${error.message}`, error.stack);
      return false;
    }
  }
}
