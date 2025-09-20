// src/modules/seed/seed.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async onModuleInit() {
    console.log('Starting subscription seeding...');
    await this.seedSubscriptions();
    console.log('Subscription seeding complete.');
  }

  private async seedSubscriptions() {
    const existingSubscriptions = await this.subscriptionsService.findAll();
    if (existingSubscriptions.length > 0) {
      console.log('Subscriptions already exist. Skipping subscription seeding.');
      return;
    }

    const subscriptionsData = [
      {
        name: 'Basic',
        messageLimit: 100,
        durationInDays: 30,
        features: ['basic_feature_1'],
        isCustom: false,
      },
      {
        name: 'Standard',
        messageLimit: 500,
        durationInDays: 30,
        features: ['basic_feature_1', 'standard_feature_1'],
        isCustom: false,
      },
      {
        name: 'Premium',
        messageLimit: 2000,
        durationInDays: 30,
        features: ['basic_feature_1', 'standard_feature_1', 'premium_feature_1'],
        isCustom: false,
      },
      {
        name: 'Custom Admin',
        messageLimit: 99999,
        durationInDays: 9999,
        features: ['all_features_enabled'],
        isCustom: true,
      },
    ];

    try {
      for (const data of subscriptionsData) {
        await this.subscriptionsService.create(data);
      }
      
      console.log('Subscriptions seeded successfully:', subscriptionsData.length);
    } catch (error) {
      console.error('Subscription seeding failed:', error);
    }
  }
}