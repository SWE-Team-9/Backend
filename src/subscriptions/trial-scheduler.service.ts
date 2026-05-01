import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InvoiceStatus, SubscriptionStatus } from "@prisma/client";
import { randomUUID } from "crypto";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  FREE_UPLOAD_LIMIT,
  GRACE_PERIOD_DAYS,
  SubscriptionsService,
} from "./subscriptions.service";

/** Returns a new Date exactly one calendar month after the given date. */
function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== day) {
    result.setDate(0);
  }
  return result;
}

function mockId(prefix: string): string {
  return `${prefix}_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

@Injectable()
export class TrialSchedulerService {
  private readonly logger = new Logger(TrialSchedulerService.name);
  private readonly paymentFeaturesEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    this.paymentFeaturesEnabled =
      (process.env.ENABLE_PAYMENT_FEATURES ??
        (process.env.NODE_ENV === "test" ? "true" : "false")) === "true";
  }

  /**
   * Runs once daily at 09:00 UTC.
   * Sends a single 48-hour renewal warning email to users whose trial ends in ~48 hours.
   * Uses a PaymentEvent record as an idempotency flag so the email is only ever sent once
   * per subscription, regardless of how many times the job runs.
   */
  @Cron("0 9 * * *")
  async sendTrialEndingWarnings(): Promise<void> {
    if (!this.paymentFeaturesEnabled) {
      return;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() + 47 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 49 * 60 * 60 * 1000);

    const subs = await this.prisma.userSubscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        currentPeriodEnd: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
        plan: { select: { name: true, priceCents: true } },
        payments: {
          where: { eventType: "trial.renewal_warning" },
          select: { id: true },
          take: 1,
        },
      },
    });

    for (const sub of subs) {
      // Skip if warning email was already sent for this subscription
      if (sub.payments.length > 0) {
        continue;
      }

      // Fire-and-forget: do not block the cron job on email delivery
      this.mailService
        .sendTrialEndingEmail({
          to: sub.user.email,
          displayName: sub.user.profile?.displayName ?? undefined,
          planName: sub.plan.name,
          priceCents: sub.plan.priceCents,
          trialEndsAt: sub.currentPeriodEnd,
        })
        .catch((err) =>
          this.logger.error(
            `[TRIAL WARNING] Email delivery failed for sub ${sub.id}: ${String(err)}`,
          ),
        );

      // Record the sent flag before the cron runs again
      await this.prisma.paymentEvent.create({
        data: {
          subscriptionId: sub.id,
          stripeEventId: mockId("evt"),
          eventType: "trial.renewal_warning",
          payload: {
            trialEnd: sub.currentPeriodEnd.toISOString(),
            warningSentAt: now.toISOString(),
          },
        },
      });

      this.logger.log(
        `[TRIAL WARNING] 48h warning queued for sub ${sub.id}, trialEnd=${sub.currentPeriodEnd.toISOString()}`,
      );
    }
  }

  /**
   * Runs every hour.
   * Auto-charges and converts subscriptions whose trial period has expired.
   * Skips subscriptions with cancelAtPeriodEnd=true (user cancelled during trial).
   */
  @Cron("0 * * * *")
  async autoRenewExpiredTrials(): Promise<void> {
    if (!this.paymentFeaturesEnabled) {
      return;
    }

    const now = new Date();
    const newPeriodEnd = addOneMonth(now); // +1 calendar month

    const expiredTrials = await this.prisma.userSubscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        currentPeriodEnd: { lt: now },
        cancelAtPeriodEnd: false,
      },
      select: {
        id: true,
        stripeCustomerId: true,
        plan: { select: { name: true, priceCents: true, tier: true } },
      },
    });

    for (const sub of expiredTrials) {
      const newStripeSubId = mockId("sub");

      try {
        const invoice = await this.prisma.billingInvoice.create({
          data: {
            subscriptionId: sub.id,
            stripeInvoiceId: mockId("in"),
            amountDueCents: sub.plan.priceCents,
            amountPaidCents: sub.plan.priceCents,
            currency: "USD",
            status: InvoiceStatus.PAID,
            dueAt: now,
            paidAt: now,
          },
        });

        await this.prisma.userSubscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            stripeSubscriptionId: newStripeSubId,
            currentPeriodStart: now,
            currentPeriodEnd: newPeriodEnd,
          },
        });

        await this.prisma.paymentEvent.create({
          data: {
            subscriptionId: sub.id,
            invoiceId: invoice.id,
            stripeEventId: mockId("evt"),
            eventType: "invoice.payment_succeeded",
            payload: {
              subscriptionId: newStripeSubId,
              customerId: sub.stripeCustomerId,
              amountPaid: sub.plan.priceCents,
              currency: "USD",
              planTier: sub.plan.tier,
              trialAutoRenewed: true,
              timestamp: now.toISOString(),
            },
          },
        });

        this.logger.log(
          `[TRIAL AUTO-RENEW] Sub ${sub.id} converted to ACTIVE, amount=${sub.plan.priceCents}`,
        );
      } catch (err) {
        this.logger.error(`[TRIAL AUTO-RENEW] Failed to renew sub ${sub.id}: ${String(err)}`);
      }
    }
  }

  /**
   * Runs every hour.
   * Auto-renews ACTIVE subscriptions whose billing period has expired and whose
   * cancelAtPeriodEnd flag is false (user has not cancelled).
   * In a real integration this would call the Stripe API; here it always succeeds (mock).
   */
  @Cron("0 * * * *")
  async autoRenewActiveSubscriptions(): Promise<void> {
    if (!this.paymentFeaturesEnabled) {
      return;
    }

    const now = new Date();
    const newPeriodEnd = addOneMonth(now);

    const expiredActive = await this.prisma.userSubscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { lt: now },
        cancelAtPeriodEnd: false,
      },
      select: {
        id: true,
        stripeCustomerId: true,
        plan: { select: { name: true, priceCents: true, tier: true } },
      },
    });

    for (const sub of expiredActive) {
      const newStripeSubId = mockId("sub");

      try {
        const invoice = await this.prisma.billingInvoice.create({
          data: {
            subscriptionId: sub.id,
            stripeInvoiceId: mockId("in"),
            amountDueCents: sub.plan.priceCents,
            amountPaidCents: sub.plan.priceCents,
            currency: "USD",
            status: InvoiceStatus.PAID,
            dueAt: now,
            paidAt: now,
          },
        });

        await this.prisma.userSubscription.update({
          where: { id: sub.id },
          data: {
            stripeSubscriptionId: newStripeSubId,
            currentPeriodStart: now,
            currentPeriodEnd: newPeriodEnd,
          },
        });

        await this.prisma.paymentEvent.create({
          data: {
            subscriptionId: sub.id,
            invoiceId: invoice.id,
            stripeEventId: mockId("evt"),
            eventType: "invoice.payment_succeeded",
            payload: {
              subscriptionId: newStripeSubId,
              customerId: sub.stripeCustomerId,
              amountPaid: sub.plan.priceCents,
              currency: "USD",
              planTier: sub.plan.tier,
              autoRenewed: true,
              timestamp: now.toISOString(),
            },
          },
        });

        this.logger.log(`[MONTHLY RENEWAL] Sub ${sub.id} renewed, amount=${sub.plan.priceCents}`);
      } catch (err) {
        this.logger.error(`[MONTHLY RENEWAL] Failed to renew sub ${sub.id}: ${String(err)}`);
      }
    }
  }

  /**
   * Runs every hour.
   * Cancels PAST_DUE subscriptions whose grace period (GRACE_PERIOD_DAYS) has elapsed
   * without the user updating their payment method.
   * Moves the user to Free and sends a "moved to free" email.
   * The grace period is measured from `updatedAt` - the timestamp when the sub
   * was set to PAST_DUE by the invoice.payment_failed webhook.
   */
  @Cron("0 * * * *")
  async cancelExpiredGracePeriodSubscriptions(): Promise<void> {
    if (!this.paymentFeaturesEnabled) {
      return;
    }

    const now = new Date();

    const expiredGrace = await this.prisma.userSubscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        // Use paymentFailureGraceEndsAt (the explicit deadline set at payment failure)
        // rather than updatedAt, which resets on any subsequent write and would cause
        // unpredictable grace-period lengths.
        paymentFailureGraceEndsAt: { lt: now },
      },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
        plan: { select: { name: true } },
      },
    });

    for (const sub of expiredGrace) {
      try {
        await this.prisma.userSubscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.CANCELED,
            endedAt: now,
          },
        });

        await this.prisma.paymentEvent.create({
          data: {
            subscriptionId: sub.id,
            stripeEventId: mockId("evt"),
            eventType: "subscription.grace_period_expired",
            payload: { cancelledAt: now.toISOString() },
          },
        });

        // Revoke offline downloads and enforce FREE plan track limit
        await this.subscriptionsService.revokeOfflineDownloads(sub.userId);
        await this.subscriptionsService.applyPlanLimitToTracks(sub.userId, FREE_UPLOAD_LIMIT);

        // Fire-and-forget
        this.mailService
          .sendPaymentFailedMovedToFreeEmail({
            to: sub.user.email,
            displayName: sub.user.profile?.displayName ?? undefined,
            planName: sub.plan.name,
          })
          .catch((err) =>
            this.logger.error(`[GRACE EXPIRED EMAIL] Failed for sub ${sub.id}: ${String(err)}`),
          );

        this.logger.log(
          `[GRACE EXPIRED] Sub ${sub.id} cancelled after ${GRACE_PERIOD_DAYS}d grace period`,
        );
      } catch (err) {
        this.logger.error(`[GRACE EXPIRED] Failed to cancel sub ${sub.id}: ${String(err)}`);
      }
    }
  }
}
