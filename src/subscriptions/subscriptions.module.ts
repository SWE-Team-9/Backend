import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import { MailModule } from "../mail/mail.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { TrialSchedulerService } from "./trial-scheduler.service";

@Module({
  imports: [PrismaModule, MailModule, BillingModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, TrialSchedulerService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
