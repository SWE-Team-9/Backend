import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { TrialSchedulerService } from './trial-scheduler.service';

const enablePaymentFeatures =
  (process.env.ENABLE_PAYMENT_FEATURES ??
    (process.env.NODE_ENV === 'test' ? 'true' : 'false')) === 'true';

@Module({
  imports: [PrismaModule, MailModule, BillingModule],
  controllers: enablePaymentFeatures ? [SubscriptionsController] : [],
  providers: [
    SubscriptionsService,
    ...(enablePaymentFeatures ? [TrialSchedulerService] : []),
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
