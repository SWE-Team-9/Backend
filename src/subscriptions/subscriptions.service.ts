import * as path from 'path';
import * as fs from 'fs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FileRole,
  InvoiceStatus,
  Prisma,
  SubscriptionStatus,
  SubscriptionTier,
  TrackStatus,
  TrackVisibility,
} from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  BILLING_PROVIDER,
  IBillingProvider,
  PaymentMethodSummary,
} from '../billing/billing-provider.interface';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { PaymentMethodPortalDto } from './dto/payment-method-portal.dto';

// ──────────────────────────────────────────────────────────────────────────────
// Constants - single source of truth for plan limits / prices / features
// ──────────────────────────────────────────────────────────────────────────────

export const FREE_UPLOAD_LIMIT = 3;

/**
 * Grace period (days) after payment failure before the subscription is cancelled.
 * User requested: 1 day.
 */
export const GRACE_PERIOD_DAYS = 1;

/**
 * Plan catalog - all prices, limits, and trial durations live here.
 * Never let controllers or DTOs define plan features.
 */
export const PLAN_CONFIG: Record<
  'FREE' | 'PRO' | 'GO_PLUS',
  {
    displayName: string;
    priceCents: number;
    uploadLimit: number;
    adsEnabled: boolean;
    canDownload: boolean;
    supportLevel: 'community' | 'priority';
    trialDays: number;
  }
> = {
  FREE: {
    displayName: 'Free',
    priceCents: 0,
    uploadLimit: 3,
    adsEnabled: true,
    canDownload: false,
    supportLevel: 'community',
    trialDays: 0,
  },
  PRO: {
    displayName: 'Pro',
    priceCents: 999,
    uploadLimit: 100,
    adsEnabled: false,
    canDownload: true,
    supportLevel: 'priority',
    trialDays: 7, // 7-day free trial for PRO
  },
  GO_PLUS: {
    displayName: 'GO+',
    priceCents: 1999,
    uploadLimit: 1000,
    adsEnabled: false,
    canDownload: true,
    supportLevel: 'priority',
    trialDays: 30, // 30-day free trial for GO+
  },
};

/**
 * Numeric rank for plan tiers — higher = more features/price.
 * Used to detect upgrades vs downgrades.
 */
const PLAN_TIER_RANK: Record<string, number> = {
  FREE: 0,
  PRO: 1,
  GO_PLUS: 2,
};

/** Returns a new Date exactly one calendar month after the given date. */
function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== day) result.setDate(0);
  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// Temporary QA override for expiry-flow testing.
// Revert this constant after testing is completed.
const PRO_TEST_EXPIRY_MINUTES = 2;

function mockId(prefix: string): string {
  return `${prefix}_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function planTierToCode(tier: SubscriptionTier | string): 'FREE' | 'PRO' | 'GO_PLUS' {
  if (tier === SubscriptionTier.PRO) return 'PRO';
  if (tier === SubscriptionTier.GO_PLUS) return 'GO_PLUS';
  return 'FREE';
}

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly storageProvider: 'local' | 's3';
  private readonly localUploadUrl: string;
  private readonly localUploadDir: string;
  private readonly downloadUrlTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    @Inject(BILLING_PROVIDER) private readonly billing: IBillingProvider,
  ) {
    this.storageProvider = this.config.get<'local' | 's3'>('storage.provider', 'local');
    this.localUploadUrl = this.config.get<string>(
      'storage.localUploadUrl',
      'http://localhost:3000/uploads',
    );
    this.localUploadDir = this.config.get<string>('storage.localUploadDir', './uploads');
    this.s3Bucket = this.config.get<string>('storage.s3Bucket', '');
    this.s3Region = this.config.get<string>('storage.s3Region', 'us-east-1');
    this.downloadUrlTtl = parseInt(process.env.S3_DOWNLOAD_URL_TTL_SECONDS ?? '900', 10);

    if (this.storageProvider === 's3') {
      const accessKeyId = this.config.get<string>('storage.awsAccessKeyId', '');
      const secretAccessKey = this.config.get<string>('storage.awsSecretAccessKey', '');
      this.s3Client = new S3Client({
        region: this.s3Region,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    } else {
      this.s3Client = null;
    }
  }

  // ── GET /subscriptions/plans ──────────────────────────────────────────────

  async getPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        tier: true,
        priceCents: true,
        billingInterval: true,
        uploadLimit: true,
        features: true,
      },
      orderBy: { priceCents: 'asc' },
    });

    return plans.map((p) => {
      const planCode = planTierToCode(p.tier);
      const cfg = PLAN_CONFIG[planCode];
      const isUnlimited = p.uploadLimit < 0;
      const priceDisplay = p.priceCents === 0 ? 'Free' : `$${(p.priceCents / 100).toFixed(2)}/mo`;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        tier: p.tier,
        priceCents: p.priceCents,
        priceDisplay,
        billingInterval: p.billingInterval,
        uploadLimit: p.uploadLimit,
        uploadLimitDisplay: isUnlimited ? 'Unlimited' : String(p.uploadLimit),
        isUnlimited,
        trialDays: cfg.trialDays,
        adsEnabled: cfg.adsEnabled,
        canDownload: cfg.canDownload,
        supportLevel: cfg.supportLevel,
        highlightedFeatures: buildPlanFeatures(cfg, p.uploadLimit),
      };
    });
  }

  // ── GET /subscriptions/me ─────────────────────────────────────────────────

  async getMySubscription(userId: string) {
    await this.finalizeExpiredCancelAtPeriodEndSubscriptions(userId);

    const sub = await this.findActiveSubscription(userId);
    const uploadedTracks = await this.prisma.track.count({
      where: { uploaderId: userId, deletedAt: null },
    });

    const latestInvoice = sub
      ? await this.prisma.billingInvoice.findFirst({
          where: { subscriptionId: sub.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amountPaidCents: true,
            currency: true,
            status: true,
            paidAt: true,
          },
        })
      : null;

    if (!sub) {
      return this.buildSubscriptionResponse({
        userId,
        tier: 'FREE',
        planName: 'Free',
        uploadLimit: FREE_UPLOAD_LIMIT,
        uploadedTracks,
        currentPeriodEnd: null,
        subscriptionStatus: null,
        cancelAtPeriodEnd: false,
        trialStart: null,
        trialEnd: null,
        paymentMethodSummary: null,
        latestInvoice: null,
      });
    }

    // The paymentMethod JSON field may hold either card info or a pendingDowngrade
    // object (set when user schedules a downgrade in checkout()). Separate them.
    const rawPaymentMethod = (sub as any).paymentMethod as Record<string, unknown> | null;
    const pendingDowngrade =
      (rawPaymentMethod?.pendingDowngrade as {
        planCode: string;
        planId: string;
        planName: string;
        effectiveAt: string;
      } | null) ?? null;
    const paymentMethodData =
      rawPaymentMethod && typeof rawPaymentMethod.brand === 'string'
        ? (rawPaymentMethod as unknown as PaymentMethodSummary)
        : null;

    return this.buildSubscriptionResponse({
      userId,
      tier: sub.plan.tier,
      planName: sub.plan.name,
      uploadLimit: sub.plan.uploadLimit < 0 ? Infinity : sub.plan.uploadLimit,
      uploadedTracks,
      currentPeriodEnd: sub.currentPeriodEnd,
      subscriptionStatus: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialStart: (sub as any).trialStart ?? null,
      trialEnd: (sub as any).trialEnd ?? null,
      paymentMethodSummary: (sub as any).paymentMethodSummary ?? null,
      paymentMethod: paymentMethodData,
      pendingDowngrade,
      latestInvoice,
    });
  }

  // ── POST /subscriptions/checkout (Module 12 canonical checkout) ───────────
  // POST /subscriptions/subscribe is preserved as a backward-compat alias.

  async checkout(userId: string, dto: CheckoutDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isVerified: true,
        email: true,
        profile: { select: { displayName: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (!user.isVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before subscribing.',
      });
    }

    const planCode = dto.planCode as 'PRO' | 'GO_PLUS';
    const planCfg = PLAN_CONFIG[planCode];
    if (!planCfg) {
      throw new BadRequestException(`Invalid plan "${dto.planCode}". Valid: PRO, GO_PLUS`);
    }

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { tier: planCode, isActive: true },
      orderBy: { priceCents: 'asc' },
    });
    if (!plan) throw new BadRequestException(`No active plan for "${planCode}". Contact support.`);

    const now = new Date();
    const existing = await this.findActiveSubscription(userId);

    // Re-activation (canceled but not yet expired, same plan)
    if (existing?.cancelAtPeriodEnd && existing.planId === plan.id) {
      await this.billing.resumeSubscription({
        providerSubscriptionId: existing.stripeSubscriptionId ?? mockId('sub'),
      });
      await this.prisma.userSubscription.update({
        where: { id: existing.id },
        data: { cancelAtPeriodEnd: false, canceledAt: null },
      });
      await this.logPaymentEvent(existing.id, 'customer.subscription.updated', {
        reactivated: true,
      });
      return this.buildCheckoutResponse(
        existing.id,
        planCode,
        planCfg,
        false,
        0,
        existing.currentPeriodEnd,
      );
    }

    if (existing?.planId === plan.id) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ALREADY_ACTIVE',
        message: `You already have an active ${plan.name} subscription.`,
        details: { renewsAt: existing.currentPeriodEnd.toISOString() },
      });
    }

    // ── Downgrade detection ──────────────────────────────────────────────────
    // If the user is on a higher-tier plan and requests a lower one, schedule
    // the downgrade at the end of the current billing period instead of applying
    // it immediately. The user keeps all higher-plan benefits until then.
    if (existing) {
      const currentTierCode = planTierToCode(existing.plan.tier);
      if (PLAN_TIER_RANK[currentTierCode] > PLAN_TIER_RANK[planCode]) {
        const effectiveAt = existing.currentPeriodEnd;

        // Persist the scheduled downgrade intent in the subscription's
        // paymentMethod JSON so getMySubscription can surface it.
        const currentPaymentMethod =
          typeof existing.paymentMethod === 'object' && existing.paymentMethod !== null
            ? (existing.paymentMethod as object)
            : {};
        await this.prisma.userSubscription.update({
          where: { id: existing.id },
          data: {
            cancelAtPeriodEnd: true,
            paymentMethod: {
              ...currentPaymentMethod,
              pendingDowngrade: {
                planCode,
                planId: plan.id,
                planName: plan.name,
                effectiveAt: effectiveAt.toISOString(),
              },
            },
          },
        });

        await this.logPaymentEvent(existing.id, 'customer.subscription.downgrade_scheduled', {
          fromPlanCode: currentTierCode,
          toPlanCode: planCode,
          effectiveAt: effectiveAt.toISOString(),
        });

        this.sendDowngradeScheduledEmailAsync(userId, existing.plan.name, plan.name, effectiveAt);

        return {
          subscriptionId: existing.id,
          scheduled: true,
          effectiveAt: effectiveAt.toISOString(),
          currentPlan: currentTierCode,
          newPlan: planCode,
          message: `Your plan will downgrade from ${existing.plan.name} to ${plan.name} on ${effectiveAt.toISOString().slice(0, 10)}. You keep all current benefits until then.`,
        };
      }
    }

    // Trial eligibility
    const trialRedemption = await this.prisma.trialRedemption.findUnique({
      where: { userId_planCode: { userId, planCode: plan.code } },
    });
    const trialEligible = trialRedemption === null;
    const trialDays = trialEligible ? planCfg.trialDays : 0;

    // Get or create provider customer
    const providerCustomerId = await this.billing.getOrCreateCustomer({
      userId,
      email: user.email,
      name: user.profile?.displayName ?? undefined,
    });

    // Create checkout session via billing provider.
    // stripePriceId is passed in metadata so RealStripeBillingProvider can use
    // it for the Stripe Checkout Session line_item without requiring DB access.
    const session = await this.billing.createCheckoutSession({
      userId,
      planCode,
      providerCustomerId,
      trialDays,
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
      metadata: {
        userId,
        planId: plan.id,
        // Used by RealStripeBillingProvider to set the Stripe price ID.
        // Null-safe: real Stripe provider will throw a clear error if missing.
        stripePriceId: plan.stripePriceId ?? '',
      },
    });

    const periodEnd =
      planCode === 'PRO'
        ? addMinutes(now, PRO_TEST_EXPIRY_MINUTES)
        : new Date(session.renewsAt);
    const trialEnd =
      planCode === 'PRO'
        ? periodEnd
        : session.trialEndsAt
          ? new Date(session.trialEndsAt)
          : undefined;
    const status = trialEligible ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
    const amountPaid = trialEligible ? 0 : plan.priceCents;

    let subscriptionId: string;
    if (existing) {
      await this.prisma.userSubscription.update({
        where: { id: existing.id },
        data: {
          planId: plan.id,
          stripeCustomerId: providerCustomerId,
          stripeSubscriptionId: session.checkoutSessionId,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialStart: trialEligible ? now : undefined,
          trialEnd,
          status,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          endedAt: null,
        },
      });
      subscriptionId = existing.id;
    } else {
      const created = await this.prisma.userSubscription.create({
        data: {
          userId,
          planId: plan.id,
          stripeCustomerId: providerCustomerId,
          stripeSubscriptionId: session.checkoutSessionId,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialStart: trialEligible ? now : undefined,
          trialEnd,
          status,
        },
      });
      subscriptionId = created.id;
    }

    // Record trial redemption to prevent abuse
    if (trialEligible) {
      await this.prisma.trialRedemption.create({
        data: {
          userId,
          planCode: plan.code,
          providerSubscriptionId: session.checkoutSessionId,
        },
      });
    }

    const invoice = await this.prisma.billingInvoice.create({
      data: {
        subscriptionId,
        stripeInvoiceId: mockId('in'),
        amountDueCents: plan.priceCents,
        amountPaidCents: amountPaid,
        currency: 'USD',
        status: InvoiceStatus.PAID,
        dueAt: now,
        paidAt: trialEligible ? null : now,
      },
    });

    await this.logPaymentEvent(
      subscriptionId,
      trialEligible ? 'customer.subscription.trial_started' : 'invoice.payment_succeeded',
      {
        checkoutSessionId: session.checkoutSessionId,
        amountPaid,
        trialEligible,
        trialDays,
      },
    );

    if (trialEligible)
      this.sendTrialStartedEmailAsync(userId, plan.name, plan.priceCents, trialEnd!);
    else this.sendSubscriptionConfirmationEmailAsync(userId, plan.name, plan.priceCents, periodEnd);

    return this.buildCheckoutResponse(
      subscriptionId,
      planCode,
      planCfg,
      trialEligible,
      amountPaid,
      periodEnd,
      session,
      trialEnd,
    );
  }

  // ── POST /subscriptions/subscribe (backward-compat alias) ─────────────────

  async subscribe(userId: string, dto: { subscriptionType: string; paymentMethodId?: string }) {
    return this.checkout(userId, {
      planCode: dto.subscriptionType as unknown as CheckoutDto['planCode'],
    });
  }

  // ── POST /subscriptions/portal ────────────────────────────────────────────

  async createBillingPortal(userId: string, dto?: PaymentMethodPortalDto) {
    await this.finalizeExpiredCancelAtPeriodEndSubscriptions(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, profile: { select: { displayName: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');
    const sub = await this.findActiveSubscription(userId);
    const providerCustomerId = await this.billing.getOrCreateCustomer({
      userId,
      email: user.email,
      name: user.profile?.displayName ?? undefined,
    });
    const portal = await this.billing.createBillingPortalSession({
      userId,
      providerCustomerId,
      returnUrl: dto?.returnUrl,
    });
    // Prefer the payment method stored on the subscription; fall back to what
    // the provider session returned (covers the case where no PM is yet saved).
    const storedPaymentMethod = sub
      ? ((sub as any).paymentMethod as PaymentMethodSummary | null)
      : null;
    const paymentMethodSummary = storedPaymentMethod ?? portal.paymentMethodSummary ?? null;
    return {
      portalSessionId: portal.portalSessionId,
      portalUrl: portal.portalUrl,
      capabilities: portal.capabilities,
      currentPlanCode: sub ? planTierToCode(sub.plan.tier) : 'FREE',
      paymentMethodSummary,
    };
  }

  // ── POST /subscriptions/cancel ────────────────────────────────────────────

  async cancelSubscription(userId: string, _dto: CancelSubscriptionDto) {
    const sub = await this.findActiveSubscription(userId);
    if (!sub) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No active subscription to cancel.',
      });
    }
    if (sub.cancelAtPeriodEnd) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ALREADY_CANCELED',
        message: 'Your subscription is already scheduled to cancel.',
        details: { expiresAt: sub.currentPeriodEnd.toISOString() },
      });
    }
    const now = new Date();
    await this.billing.cancelSubscription({
      providerSubscriptionId: sub.stripeSubscriptionId ?? mockId('sub'),
      cancelAtPeriodEnd: true,
    });
    await this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, canceledAt: now },
    });
    await this.logPaymentEvent(sub.id, 'customer.subscription.updated', {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    });
    this.sendCancellationEmailAsync(userId, sub.plan.name, sub.currentPeriodEnd);
    return {
      message:
        'Subscription will cancel at end of billing period. You keep full access until then.',
      cancelledAt: now.toISOString(),
      expiresAt: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: true,
    };
  }

  // ── POST /subscriptions/resume ────────────────────────────────────────────

  async resumeSubscription(userId: string) {
    const sub = await this.findActiveSubscription(userId);
    if (!sub)
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No active subscription found.',
      });
    if (!sub.cancelAtPeriodEnd) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_NOT_CANCELED',
        message: 'Your subscription is not set to cancel.',
      });
    }
    await this.billing.resumeSubscription({
      providerSubscriptionId: sub.stripeSubscriptionId ?? mockId('sub'),
    });
    await this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false, canceledAt: null },
    });
    await this.logPaymentEvent(sub.id, 'customer.subscription.updated', {
      cancelAtPeriodEnd: false,
      resumed: true,
    });
    return this.getMySubscription(userId);
  }

  // ── POST /subscriptions/change-plan ──────────────────────────────────────

  async changePlan(userId: string, dto: ChangePlanDto) {
    const sub = await this.findActiveSubscription(userId);
    if (!sub)
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No active paid subscription found.',
      });
    const currentTier = sub.plan.tier;
    const newTier = dto.planCode as SubscriptionTier;
    if (currentTier === newTier) {
      throw new ConflictException({
        code: 'PLAN_ALREADY_ACTIVE',
        message: `You are already on the ${sub.plan.name} plan.`,
      });
    }
    if (newTier === SubscriptionTier.FREE) {
      throw new BadRequestException({
        code: 'INVALID_PLAN_CHANGE',
        message: 'To downgrade to FREE, cancel your subscription instead.',
      });
    }
    const newPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { tier: newTier, isActive: true },
    });
    if (!newPlan) throw new BadRequestException(`Plan "${dto.planCode}" not found.`);
    const now = new Date();
    await this.billing.changePlan({
      providerSubscriptionId: sub.stripeSubscriptionId ?? mockId('sub'),
      newPlanCode: dto.planCode,
      newProviderPriceId: newPlan.stripePriceId ?? undefined,
    });
    await this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { planId: newPlan.id },
    });
    await this.logPaymentEvent(sub.id, 'customer.subscription.updated', {
      oldPlanCode: planTierToCode(currentTier),
      newPlanCode: dto.planCode,
      effectiveDate: now.toISOString(),
    });
    const newPlanCode = planTierToCode(newTier);
    await this.applyPlanLimitToTracks(userId, PLAN_CONFIG[newPlanCode].uploadLimit);
    this.sendPlanChangedEmailAsync(userId, planTierToCode(currentTier), newPlanCode, now);
    return this.getMySubscription(userId);
  }

  // ── GET /subscriptions/invoices ───────────────────────────────────────────

  async getInvoices(userId: string) {
    const subs = await this.prisma.userSubscription.findMany({
      where: { userId },
      select: { id: true },
    });
    if (!subs.length) return [];
    const invoices = await this.prisma.billingInvoice.findMany({
      where: { subscriptionId: { in: subs.map((s) => s.id) } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        stripeInvoiceId: true,
        amountDueCents: true,
        amountPaidCents: true,
        currency: true,
        status: true,
        dueAt: true,
        paidAt: true,
        createdAt: true,
        subscription: {
          select: { plan: { select: { name: true, tier: true } } },
        },
      },
    });
    return invoices.map((inv) => ({
      id: inv.id,
      invoiceId: inv.stripeInvoiceId,
      amountDueCents: inv.amountDueCents,
      amountPaidCents: inv.amountPaidCents,
      currency: inv.currency,
      status: inv.status,
      planName: inv.subscription.plan.name,
      planTier: inv.subscription.plan.tier,
      dueAt: inv.dueAt?.toISOString() ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  // ── POST /subscriptions/webhook ───────────────────────────────────────────

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    let event: ReturnType<IBillingProvider['constructWebhookEvent']>;
    try {
      event = this.billing.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new BadRequestException({
        code: 'WEBHOOK_INVALID_SIGNATURE',
        message: 'Webhook signature verification failed.',
      });
    }

    this.logger.log(`[WEBHOOK] type=${event.type} id=${event.id}`);

    // Idempotency - skip duplicate events
    const existingEvent = await this.prisma.paymentEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existingEvent) {
      this.logger.warn(`[WEBHOOK] Duplicate event ${event.id} - skipped`);
      return { received: true };
    }

    const obj = event.data?.object ?? {};
    const stripeSubId =
      (obj['id'] as string | undefined) ?? (obj['subscription'] as string | undefined);
    let sub: {
      id: string;
      userId: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      plan: { name: string; tier: SubscriptionTier };
    } | null = null;

    if (stripeSubId) {
      sub = await this.prisma.userSubscription.findFirst({
        where: { stripeSubscriptionId: stripeSubId },
        select: {
          id: true,
          userId: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          plan: { select: { name: true, tier: true } },
        },
      });
    }

    if (sub) {
      await this.prisma.paymentEvent.create({
        data: {
          subscriptionId: sub.id,
          stripeEventId: event.id,
          eventType: event.type,
          payload: event.data as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const now = new Date();

    switch (event.type) {
      case 'checkout.session.completed':
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        if (sub) {
          // For checkout.session.completed: Stripe creates the real subscription
          // (sub_xxx) after checkout completes. The DB record was created with
          // the checkout session ID (cs_xxx) as the stripeSubscriptionId.
          // Update it now to the real subscription ID so future webhook events
          // (invoice.paid, subscription.deleted, etc.) can be matched correctly.
          const realSubId = obj['subscription'] as string | undefined;
          const updateData: Record<string, unknown> = {
            status: SubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: false,
            // Clear any stale payment-failure markers set by invoice.payment_failed.
            // The cron already guards by status=PAST_DUE, but keeping these null
            // avoids confusing the data if the subscription is ever inspected directly.
            paymentFailureAt: null,
            paymentFailureGraceEndsAt: null,
          };
          if (
            event.type === 'checkout.session.completed' &&
            realSubId &&
            realSubId !== sub.stripeSubscriptionId
          ) {
            updateData.stripeSubscriptionId = realSubId;
            this.logger.log(
              `[WEBHOOK] Updating stripeSubscriptionId: ${sub.stripeSubscriptionId} → ${realSubId}`,
            );
          }
          await this.prisma.userSubscription.update({
            where: { id: sub.id },
            data: updateData,
          });
          const invoiceId = obj['invoice'] as string | undefined;
          const amountPaid = (obj['amount_paid'] as number | undefined) ?? 0;
          const currency = ((obj['currency'] as string | undefined) ?? 'usd')
            .toUpperCase()
            .slice(0, 3);
          if (invoiceId) {
            const inv = await this.prisma.billingInvoice.findUnique({
              where: { stripeInvoiceId: invoiceId },
            });
            if (!inv) {
              const newInv = await this.prisma.billingInvoice.create({
                data: {
                  subscriptionId: sub.id,
                  stripeInvoiceId: invoiceId,
                  amountDueCents: amountPaid,
                  amountPaidCents: amountPaid,
                  currency,
                  status: InvoiceStatus.PAID,
                  paidAt: now,
                },
              });
              this.sendInvoiceReceiptEmailAsync(
                sub.userId,
                sub.plan.name,
                amountPaid,
                now,
                newInv.id,
              );
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        if (sub) {
          const graceEndsAt = addDays(now, GRACE_PERIOD_DAYS);
          await this.prisma.userSubscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.PAST_DUE,
              paymentFailureAt: now,
              paymentFailureGraceEndsAt: graceEndsAt,
            } as any,
          });
          const user = await this.prisma.user.findUnique({
            where: { id: sub.userId },
            select: { email: true, profile: { select: { displayName: true } } },
          });
          if (user) {
            this.mailService
              .sendPaymentGracePeriodEmail({
                to: user.email,
                displayName: user.profile?.displayName ?? undefined,
                planName: sub.plan.name,
                gracePeriodDays: GRACE_PERIOD_DAYS,
              })
              .catch((err) => this.logger.error(`[PAYMENT FAILED EMAIL] ${err}`));
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        if (sub) {
          const newStatus = obj['status'] as string | undefined;
          const cancelAtEnd = obj['cancel_at_period_end'] as boolean | undefined;
          const updateData: Record<string, unknown> = {};
          if (newStatus) updateData['status'] = this.mapStripeStatus(newStatus);
          if (cancelAtEnd !== undefined) updateData['cancelAtPeriodEnd'] = cancelAtEnd;
          if (Object.keys(updateData).length) {
            await this.prisma.userSubscription.update({
              where: { id: sub.id },
              data: updateData,
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        if (sub) {
          await this.prisma.userSubscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.CANCELED,
              canceledAt: now,
              endedAt: now,
            },
          });
          await this.revokeOfflineDownloads(sub.userId);
          await this.applyPlanLimitToTracks(sub.userId, FREE_UPLOAD_LIMIT);
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        if (sub) {
          const dbSub = await this.prisma.userSubscription.findUnique({
            where: { id: sub.id },
            select: {
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              plan: { select: { priceCents: true, name: true } },
            },
          });
          if (dbSub && !dbSub.cancelAtPeriodEnd) {
            const user = await this.prisma.user.findUnique({
              where: { id: sub.userId },
              select: {
                email: true,
                profile: { select: { displayName: true } },
              },
            });
            if (user) {
              this.mailService
                .sendTrialEndingEmail({
                  to: user.email,
                  displayName: user.profile?.displayName ?? undefined,
                  planName: dbSub.plan.name,
                  priceCents: dbSub.plan.priceCents,
                  trialEndsAt: dbSub.currentPeriodEnd,
                })
                .catch((err) => this.logger.error(`[TRIAL ENDING EMAIL] ${err}`));
            }
          }
        }
        break;
      }

      // ── payment_method.updated ──────────────────────────────────────────────
      // Fired (in mock: manually; in real Stripe: after the customer adds/replaces
      // a card in the billing portal).  The event object carries the card-safe
      // summary fields that we persist on the subscription row.
      case 'payment_method.updated': {
        // payment_method events carry a 'customer' field, not 'subscription'.
        const customerId = obj['customer'] as string | undefined;
        if (customerId) {
          const subByCustomer = await this.prisma.userSubscription.findFirst({
            where: { stripeCustomerId: customerId },
            select: { id: true, userId: true },
          });
          if (subByCustomer) {
            const card = (obj['card'] as Record<string, unknown> | undefined) ?? {};
            const brand =
              (card['brand'] as string | undefined) ??
              (obj['brand'] as string | undefined) ??
              'unknown';
            const last4 =
              (card['last4'] as string | undefined) ??
              (obj['last4'] as string | undefined) ??
              '0000';
            const expiryMonth =
              (card['exp_month'] as number | undefined) ??
              (obj['exp_month'] as number | undefined) ??
              1;
            const expiryYear =
              (card['exp_year'] as number | undefined) ??
              (obj['exp_year'] as number | undefined) ??
              2030;
            const newPaymentMethod: PaymentMethodSummary = {
              brand,
              last4,
              expiryMonth,
              expiryYear,
              isDefault: true,
            };
            const summaryStr = `${brand.charAt(0).toUpperCase() + brand.slice(1)} ending in ${last4}`;
            await this.prisma.userSubscription.update({
              where: { id: subByCustomer.id },
              data: {
                paymentMethod: newPaymentMethod as any,
                paymentMethodSummary: summaryStr,
              },
            });
            // Idempotent event log (idempotency checked at top of handler)
            await this.prisma.paymentEvent.create({
              data: {
                subscriptionId: subByCustomer.id,
                stripeEventId: event.id,
                eventType: 'payment_method.updated',
                payload: { brand, last4, expiryMonth, expiryYear },
              },
            });
            this.sendPaymentMethodUpdatedEmailAsync(
              subByCustomer.userId,
              brand,
              last4,
              expiryMonth,
              expiryYear,
            );
          }
        }
        break;
      }

      default:
        this.logger.debug(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  // ── GET /subscriptions/offline/:trackId ───────────────────────────────────

  async getOfflineTrack(userId: string, trackId: string) {
    const sub = await this.findActiveSubscription(userId);
    const planCode = sub ? planTierToCode(sub.plan.tier) : 'FREE';
    const canDownload = sub !== null && PLAN_CONFIG[planCode].canDownload;

    if (!canDownload) {
      throw new ForbiddenException({
        code: 'DOWNLOAD_NOT_ALLOWED',
        message: 'Offline listening is available on PRO and GO+.',
        details: { currentPlan: planCode, upgradeOptions: ['PRO', 'GO_PLUS'] },
      });
    }

    const track = await this.prisma.track.findFirst({
      where: {
        id: trackId,
        deletedAt: null,
        status: TrackStatus.FINISHED,
        OR: [{ visibility: TrackVisibility.PUBLIC }, { uploaderId: userId }],
      },
      select: {
        id: true,
        title: true,
        durationMs: true,
        coverArtUrl: true,
        files: {
          where: {
            isCurrent: true,
            fileRole: { in: [FileRole.STREAM, FileRole.ORIGINAL] },
          },
          select: { storageKey: true, fileRole: true },
        },
        uploader: {
          select: { profile: { select: { displayName: true, handle: true } } },
        },
      },
    });

    if (!track) throw new NotFoundException('Track not found or not available for download.');

    const file = track.files.find((f) => f.fileRole === FileRole.STREAM) ?? track.files[0];
    if (!file) throw new NotFoundException('Track audio file is not ready yet.');

    const ttl = this.downloadUrlTtl;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    let downloadUrl: string;

    if (this.storageProvider === 's3' && this.s3Client) {
      // Do NOT log the presigned URL - it contains a signature
      this.logger.log(
        `[DOWNLOAD] Generating S3 presigned URL for track ${track.id} user ${userId}`,
      );
      downloadUrl = await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: file.storageKey }),
        { expiresIn: ttl },
      );
    } else {
      downloadUrl = `${this.localUploadUrl}/${file.storageKey}`;
    }

    // Upsert OfflineDownload audit record (non-critical)
    if (sub) {
      await this.prisma.offlineDownload
        .upsert({
          where: {
            userId_deviceId_trackId: {
              userId,
              deviceId: '00000000-0000-0000-0000-000000000000',
              trackId,
            },
          },
          create: {
            userId,
            deviceId: '00000000-0000-0000-0000-000000000000',
            trackId,
            expiresAt,
          },
          update: { expiresAt },
        })
        .catch(() => undefined);
    }

    return {
      trackId: track.id,
      title: track.title,
      artist: track.uploader?.profile?.displayName ?? null,
      handle: track.uploader?.profile?.handle ?? null,
      durationMs: track.durationMs,
      coverArtUrl: track.coverArtUrl ?? null,
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: ttl,
      offlineTokenId: mockId('offline'),
      planCode,
    };
  }

  // ── GET /subscriptions/offline/:trackId/stream ────────────────────────────
  // Server-side proxy: fetches audio from S3 and streams bytes back to the
  // browser, bypassing S3 CORS restrictions. The browser stores the bytes in
  // IndexedDB for offline playback — no file is written to the device.

  async streamOfflineTrack(
    userId: string,
    trackId: string,
    res: import('express').Response,
  ): Promise<void> {
    // Reuse the existing entitlement + presigned URL logic
    const trackData = await this.getOfflineTrack(userId, trackId);
    const presignedUrl = trackData.downloadUrl;

    let audioBuffer: Buffer;

    if (this.storageProvider === 's3' && this.s3Client) {
      // Fetch directly via the AWS SDK (server-to-S3, no CORS restriction)
      const sub = await this.findActiveSubscription(userId);
      const planCode = sub ? planTierToCode(sub.plan.tier) : 'FREE';
      const track = await this.prisma.track.findFirst({
        where: { id: trackId, deletedAt: null },
        select: {
          files: {
            where: {
              isCurrent: true,
              fileRole: { in: [FileRole.STREAM, FileRole.ORIGINAL] },
            },
            select: { storageKey: true },
          },
        },
      });
      const storageKey = track?.files.find(() => true)?.storageKey ?? null;

      if (storageKey) {
        const s3Res = await this.s3Client.send(
          new GetObjectCommand({ Bucket: this.s3Bucket, Key: storageKey }),
        );
        const chunks: Buffer[] = [];
        for await (const chunk of s3Res.Body as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        audioBuffer = Buffer.concat(chunks);
        void planCode; // used above for entitlement check via getOfflineTrack
      } else {
        // Fall through to fetch the presigned URL
        const httpRes = await fetch(presignedUrl);
        if (!httpRes.ok) throw new Error(`S3 fetch failed: ${httpRes.status}`);
        audioBuffer = Buffer.from(await httpRes.arrayBuffer());
      }
    } else {
      // Local storage: read the file directly from the filesystem instead of
      // making an HTTP request to /uploads/tracks, which is now protected by the
      // JWT auth middleware. Direct disk reads bypass that middleware safely —
      // entitlement was already verified by getOfflineTrack() above.
      const localTrack = await this.prisma.track.findFirst({
        where: { id: trackId, deletedAt: null },
        select: {
          files: {
            where: { isCurrent: true, fileRole: { in: [FileRole.STREAM, FileRole.ORIGINAL] } },
            select: { storageKey: true },
          },
        },
      });
      const localStorageKey = localTrack?.files.find(() => true)?.storageKey ?? null;

      if (!localStorageKey) {
        throw new NotFoundException({
          code: 'TRACK_FILE_NOT_FOUND',
          message: 'Track file not found.',
        });
      }

      // Path traversal guard
      const resolvedUploadDir = path.resolve(this.localUploadDir);
      const fullPath = path.resolve(path.join(this.localUploadDir, localStorageKey));
      if (!fullPath.startsWith(resolvedUploadDir + path.sep) && fullPath !== resolvedUploadDir) {
        throw new ForbiddenException('Invalid storage path.');
      }

      audioBuffer = await fs.promises.readFile(fullPath);
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline',
      'Content-Length': String(audioBuffer.length),
      // Private audio — must not be cached beyond this session.
      'Cache-Control': 'private, max-age=900',
      // Do NOT set Access-Control-Allow-Origin here; the global CORS middleware
      // handles origin restrictions. A wildcard would allow any origin to read
      // this authenticated audio response.
    });
    res.end(audioBuffer);
  }

  // ── getUploadQuota (used by TracksService / EntitlementsService) ───────────

  async getUploadQuota(userId: string): Promise<{ uploadLimit: number; uploadedCount: number }> {
    const sub = await this.findActiveSubscription(userId);
    const planCode = sub ? planTierToCode(sub.plan.tier) : 'FREE';
    const { uploadLimit } = PLAN_CONFIG[planCode];
    const uploadedCount = await this.prisma.track.count({
      where: { uploaderId: userId, deletedAt: null },
    });
    return { uploadLimit, uploadedCount };
  }

  // ── applyPlanLimitToTracks ────────────────────────────────────────────────

  /**
   * SoundCloud-like plan-limit enforcement.
   * Keeps the newest `newLimit` tracks visible; auto-hides older over-limit tracks.
   * On upgrade, restores tracks that were hidden by this rule ONLY (not user-hidden).
   * Never deletes tracks.
   */
  async applyPlanLimitToTracks(userId: string, newLimit: number): Promise<void> {
    const tracks = await this.prisma.track.findMany({
      where: { uploaderId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' }, // newest first
      select: { id: true, hiddenByPlanLimit: true },
    });

    const now = new Date();
    const allowed = newLimit;

    const withinLimit = tracks.slice(0, allowed);
    const overLimit = tracks.slice(allowed);

    // Restore auto-hidden tracks that now fit within the new limit
    const toRestore = withinLimit.filter((t) => (t as any).hiddenByPlanLimit);
    if (toRestore.length > 0) {
      await this.prisma.track.updateMany({
        where: { id: { in: toRestore.map((t) => t.id) } },
        data: { hiddenByPlanLimit: false, hiddenByPlanLimitAt: null } as any,
      });
      this.logger.log(`[PLAN LIMIT] Restored ${toRestore.length} tracks for user ${userId}`);
    }

    // Auto-hide tracks that exceed the new limit
    const toHide = overLimit.filter((t) => !(t as any).hiddenByPlanLimit);
    if (toHide.length > 0) {
      await this.prisma.track.updateMany({
        where: { id: { in: toHide.map((t) => t.id) } },
        data: { hiddenByPlanLimit: true, hiddenByPlanLimitAt: now } as any,
      });
      this.logger.log(
        `[PLAN LIMIT] Auto-hid ${toHide.length} tracks for user ${userId} (limit=${newLimit})`,
      );
    }
  }

  // ── revokeOfflineDownloads ────────────────────────────────────────────────

  async revokeOfflineDownloads(userId: string): Promise<void> {
    await this.prisma.offlineDownload.updateMany({
      where: { userId },
      data: { expiresAt: new Date(0) },
    });
  }

  // ── findActiveSubscription ────────────────────────────────────────────────

  async findActiveSubscription(userId: string) {
    return this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE],
        },
        currentPeriodEnd: { gte: new Date() },
      },
      include: {
        plan: {
          select: {
            tier: true,
            uploadLimit: true,
            name: true,
            priceCents: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async logPaymentEvent(
    subscriptionId: string,
    eventType: string,
    payload: object,
  ): Promise<void> {
    await this.prisma.paymentEvent.create({
      data: {
        subscriptionId,
        stripeEventId: mockId('evt'),
        eventType,
        payload,
      },
    });
  }

  private async finalizeExpiredCancelAtPeriodEndSubscriptions(
    userId: string,
  ): Promise<void> {
    const now = new Date();
    const expiredCancelingSubs = await this.prisma.userSubscription.findMany({
      where: {
        userId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { lt: now },
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      select: {
        id: true,
        userId: true,
        plan: { select: { name: true } },
      },
    });

    for (const sub of expiredCancelingSubs) {
      await this.prisma.userSubscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.CANCELED,
          cancelAtPeriodEnd: false,
          endedAt: now,
        },
      });

      await this.revokeOfflineDownloads(sub.userId);
      await this.applyPlanLimitToTracks(sub.userId, FREE_UPLOAD_LIMIT);

      await this.logPaymentEvent(sub.id, 'subscription.cancel_period_end_finalized', {
        finalizedAt: now.toISOString(),
      });

      this.logger.warn(
        `[SUBSCRIPTION FINALIZE] Auto-finalized expired cancel-at-period-end subscription ${sub.id}`,
      );
    }
  }

  private buildSubscriptionResponse(opts: {
    userId: string;
    tier: SubscriptionTier | 'FREE';
    planName: string;
    uploadLimit: number;
    uploadedTracks: number;
    currentPeriodEnd: Date | null;
    subscriptionStatus: SubscriptionStatus | null;
    cancelAtPeriodEnd: boolean;
    trialStart: Date | null;
    trialEnd: Date | null;
    paymentMethodSummary: string | null;
    paymentMethod?: PaymentMethodSummary | null;
    pendingDowngrade?: {
      planCode: string;
      planId: string;
      planName: string;
      effectiveAt: string;
    } | null;
    latestInvoice: {
      id: string;
      amountPaidCents: number;
      currency: string;
      status: InvoiceStatus;
      paidAt: Date | null;
    } | null;
  }) {
    const planCode = planTierToCode(opts.tier);
    const cfg = PLAN_CONFIG[planCode];
    const isUnlimited = !isFinite(opts.uploadLimit);
    const remainingUploads = isUnlimited
      ? null
      : Math.max(0, opts.uploadLimit - opts.uploadedTracks);
    return {
      userId: opts.userId,
      planCode,
      subscriptionType: opts.tier, // backward compat
      subscriptionStatus: opts.subscriptionStatus,
      planName: opts.planName,
      isPremium: planCode !== 'FREE',
      adsEnabled: cfg.adsEnabled,
      canDownload: cfg.canDownload,
      supportLevel: cfg.supportLevel,
      uploadLimit: isUnlimited ? -1 : opts.uploadLimit,
      uploadLimitDisplay: isUnlimited ? 'Unlimited' : String(opts.uploadLimit),
      uploadedTracks: opts.uploadedTracks,
      remainingUploads,
      currentPeriodEnd: opts.currentPeriodEnd?.toISOString() ?? null,
      renewalDate:
        !opts.cancelAtPeriodEnd && opts.currentPeriodEnd
          ? opts.currentPeriodEnd.toISOString()
          : null,
      expiresAt:
        opts.cancelAtPeriodEnd && opts.currentPeriodEnd
          ? opts.currentPeriodEnd.toISOString()
          : null,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd,
      trialStart: opts.trialStart?.toISOString() ?? null,
      trialEnd: opts.trialEnd?.toISOString() ?? null,
      paymentMethodSummary: opts.paymentMethod
        ? `${opts.paymentMethod.brand.charAt(0).toUpperCase() + opts.paymentMethod.brand.slice(1)} ending in ${opts.paymentMethod.last4}`
        : opts.paymentMethodSummary,
      paymentMethod: opts.paymentMethod ?? null,
      pendingDowngrade: opts.pendingDowngrade ?? null,
      latestInvoice: opts.latestInvoice
        ? {
            id: opts.latestInvoice.id,
            amountPaidCents: opts.latestInvoice.amountPaidCents,
            currency: opts.latestInvoice.currency,
            status: opts.latestInvoice.status,
            paidAt: opts.latestInvoice.paidAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private buildCheckoutResponse(
    subscriptionId: string,
    planCode: 'PRO' | 'GO_PLUS',
    planCfg: (typeof PLAN_CONFIG)[keyof typeof PLAN_CONFIG],
    trialEligible: boolean,
    amountPaid: number,
    periodEnd: Date,
    session?: {
      checkoutSessionId: string;
      checkoutUrl: string;
      trialDays: number;
    },
    trialEnd?: Date,
  ) {
    return {
      subscriptionId,
      checkoutSessionId: session?.checkoutSessionId ?? mockId('cs'),
      checkoutUrl: session?.checkoutUrl ?? null,
      planCode,
      trialEligible,
      trialDays: session?.trialDays ?? 0,
      amountDueNowCents: amountPaid,
      renewsAt: periodEnd.toISOString(),
      trialEndsAt: trialEnd?.toISOString() ?? null,
      priceCents: planCfg.priceCents,
    };
  }

  private mapStripeStatus(stripeStatus: string): SubscriptionStatus {
    const map: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      trialing: SubscriptionStatus.TRIALING,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      unpaid: SubscriptionStatus.UNPAID,
      incomplete: SubscriptionStatus.INCOMPLETE,
      incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
      paused: SubscriptionStatus.PAUSED,
    };
    return map[stripeStatus] ?? SubscriptionStatus.ACTIVE;
  }

  private sendTrialStartedEmailAsync(
    userId: string,
    planName: string,
    priceCents: number,
    trialEndsAt: Date,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user)
          this.mailService
            .sendTrialStartedEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              planName,
              priceCents,
              trialEndsAt,
            })
            .catch((err) => this.logger.error(`[TRIAL STARTED EMAIL] ${err}`));
      })
      .catch(() => undefined);
  }

  private sendSubscriptionConfirmationEmailAsync(
    userId: string,
    planName: string,
    priceCents: number,
    currentPeriodEnd: Date,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user)
          this.mailService
            .sendSubscriptionConfirmationEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              planName,
              priceCents,
              currentPeriodEnd,
            })
            .catch((err) => this.logger.error(`[SUBSCRIPTION CONFIRMATION EMAIL] ${err}`));
      })
      .catch(() => undefined);
  }

  private sendCancellationEmailAsync(userId: string, planName: string, expiresAt: Date): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user && (this.mailService as any).sendCancellationConfirmedEmail) {
          (this.mailService as any)
            .sendCancellationConfirmedEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              planName,
              expiresAt,
            })
            .catch((err: unknown) => this.logger.error(`[CANCELLATION EMAIL] ${err}`));
        }
      })
      .catch(() => undefined);
  }

  private sendInvoiceReceiptEmailAsync(
    userId: string,
    planName: string,
    amountPaidCents: number,
    paidAt: Date,
    invoiceId: string,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user && (this.mailService as any).sendInvoiceReceiptEmail) {
          (this.mailService as any)
            .sendInvoiceReceiptEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              planName,
              amountPaidCents,
              paidAt,
              invoiceId,
            })
            .catch((err: unknown) => this.logger.error(`[INVOICE RECEIPT EMAIL] ${err}`));
        }
      })
      .catch(() => undefined);
  }

  private sendPlanChangedEmailAsync(
    userId: string,
    oldPlanCode: string,
    newPlanCode: string,
    effectiveDate: Date,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user && (this.mailService as any).sendPlanChangedEmail) {
          (this.mailService as any)
            .sendPlanChangedEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              oldPlanName:
                PLAN_CONFIG[oldPlanCode as keyof typeof PLAN_CONFIG]?.displayName ?? oldPlanCode,
              newPlanName:
                PLAN_CONFIG[newPlanCode as keyof typeof PLAN_CONFIG]?.displayName ?? newPlanCode,
              effectiveDate,
            })
            .catch((err: unknown) => this.logger.error(`[PLAN CHANGED EMAIL] ${err}`));
        }
      })
      .catch(() => undefined);
  }

  private sendDowngradeScheduledEmailAsync(
    userId: string,
    currentPlanName: string,
    newPlanName: string,
    effectiveAt: Date,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user) {
          this.mailService
            .sendDowngradeScheduledEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              currentPlanName,
              newPlanName,
              effectiveAt,
            })
            .catch((err: unknown) => this.logger.error(`[DOWNGRADE SCHEDULED EMAIL] ${err}`));
        }
      })
      .catch(() => undefined);
  }

  private sendPaymentMethodUpdatedEmailAsync(
    userId: string,
    brand: string,
    last4: string,
    expiryMonth: number,
    expiryYear: number,
  ): void {
    this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, profile: { select: { displayName: true } } },
      })
      .then((user) => {
        if (user) {
          this.mailService
            .sendPaymentMethodUpdatedEmail({
              to: user.email,
              displayName: user.profile?.displayName ?? undefined,
              brand,
              last4,
              expiryMonth,
              expiryYear,
            })
            .catch((err: unknown) => this.logger.error(`[PAYMENT METHOD EMAIL] ${err}`));
        }
      })
      .catch(() => undefined);
  }
}

// ── Plan feature builder ──────────────────────────────────────────────────────

function buildPlanFeatures(
  cfg: (typeof PLAN_CONFIG)[keyof typeof PLAN_CONFIG],
  uploadLimit: number,
): string[] {
  const isUnlimited = uploadLimit < 0;
  return [
    isUnlimited
      ? 'Unlimited track uploads'
      : `${uploadLimit} track upload${uploadLimit !== 1 ? 's' : ''}`,
    cfg.adsEnabled ? 'Ad-supported listening' : 'Ad-free listening',
    cfg.canDownload ? 'Offline listening / download tracks' : 'Online streaming only',
    cfg.supportLevel === 'priority' ? 'Priority support' : 'Community support',
  ];
}
