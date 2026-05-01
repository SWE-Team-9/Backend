import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { StripeService } from '../stripe/stripe.service';
import {
  BILLING_PROVIDER,
  BillingPortalResult,
  CheckoutSessionResult,
  IBillingProvider,
  PaymentMethodSummary,
  ProviderSubscriptionResult,
  WebhookEvent,
} from './billing-provider.interface';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== day) result.setDate(0);
  return result;
}

function secondsToDate(value: unknown, fallback: Date): Date {
  return typeof value === 'number' && value > 0 ? new Date(value * 1000) : fallback;
}

function mapStripeSubscription(sub: Stripe.Subscription): ProviderSubscriptionResult {
  const s = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    trial_start?: number;
    trial_end?: number;
  };

  const now = new Date();
  const periodEndFallback = addOneMonth(now);

  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: sub.status,
    currentPeriodStart: secondsToDate(s.current_period_start, now),
    currentPeriodEnd: secondsToDate(s.current_period_end, periodEndFallback),
    trialStart: s.trial_start ? new Date(s.trial_start * 1000) : undefined,
    trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

@Injectable()
export class RealStripeBillingProvider implements IBillingProvider {
  private readonly logger = new Logger(RealStripeBillingProvider.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) {}

  async getOrCreateCustomer(params: {
    userId: string;
    email: string;
    name?: string;
  }): Promise<string> {
    const existingId = await this.stripeService.searchCustomersByUserId(params.userId);
    if (existingId) {
      this.logger.debug(`[Stripe] Existing customer ${existingId} for user ${params.userId}`);
      return existingId;
    }

    const customer = await this.stripeService.createCustomer({
      email: params.email,
      name: params.name,
      metadata: { userId: params.userId },
    });

    this.logger.debug(`[Stripe] Created customer ${customer.id} for user ${params.userId}`);
    return customer.id;
  }

  async createCheckoutSession(params: {
    userId: string;
    planCode: string;
    providerCustomerId?: string;
    trialDays?: number;
    returnUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<CheckoutSessionResult> {
    const priceId = params.metadata?.stripePriceId;
    if (!priceId) {
      throw new Error(
        `No Stripe price ID for plan "${params.planCode}". Set stripePriceId on the SubscriptionPlan DB record.`,
      );
    }

    const frontendUrl = this.config.get<string>('app.clientUrl') ?? 'http://localhost:3000';
    const successUrl =
      this.config.get<string>('billing.checkoutSuccessUrl') ??
      `${frontendUrl}/subscriptions/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      params.cancelUrl ??
      this.config.get<string>('billing.checkoutCancelUrl') ??
      `${frontendUrl}/subscriptions/cancel`;

    const now = new Date();
    const trialDays = params.trialDays ?? 0;
    const trialEligible = trialDays > 0;
    const priceCents = Number(params.metadata?.priceCents ?? 0);

    const sessionCreateParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: params.providerCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.returnUrl
        ? `${params.returnUrl}?session_id={CHECKOUT_SESSION_ID}`
        : successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        userId: params.userId,
        planCode: params.planCode,
        ...(params.metadata ?? {}),
      },
      subscription_data: {
        metadata: {
          userId: params.userId,
          planCode: params.planCode,
          ...(params.metadata ?? {}),
        },
        ...(trialEligible ? { trial_period_days: trialDays } : {}),
      },
    };

    const session = await this.stripeService.createCheckoutSession(sessionCreateParams);
    const trialEnd = trialEligible ? addDays(now, trialDays) : undefined;
    const renewsAt = trialEnd ?? addOneMonth(now);

    this.logger.log(
      `[Stripe] Checkout session ${session.id} created for plan=${params.planCode} trial=${trialEligible}`,
    );

    return {
      checkoutSessionId: session.id,
      checkoutUrl: session.url ?? '',
      planCode: params.planCode,
      trialEligible,
      trialDays,
      amountDueNowCents: trialEligible ? 0 : priceCents,
      renewsAt: renewsAt.toISOString(),
      trialEndsAt: trialEnd?.toISOString(),
    };
  }

  async createBillingPortalSession(params: {
    userId: string;
    providerCustomerId?: string;
    returnUrl?: string;
  }): Promise<BillingPortalResult> {
    if (!params.providerCustomerId) {
      throw new Error('providerCustomerId is required to create a billing portal session.');
    }

    const frontendUrl = this.config.get<string>('app.clientUrl') ?? 'http://localhost:3000';
    const returnUrl =
      params.returnUrl ??
      this.config.get<string>('billing.portalReturnUrl') ??
      `${frontendUrl}/settings`;

    const session = await this.stripeService.createBillingPortalSession({
      customer: params.providerCustomerId,
      return_url: returnUrl,
    });

    let paymentMethodSummary: PaymentMethodSummary | null = null;
    try {
      const pms = await this.stripeService.listCustomerPaymentMethods(params.providerCustomerId);
      const pm = pms.find((p) => p.card) ?? pms[0];
      if (pm?.card) {
        paymentMethodSummary = {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expiryMonth: pm.card.exp_month,
          expiryYear: pm.card.exp_year,
          isDefault: true,
        };
      }
    } catch (err) {
      this.logger.warn(
        `[Stripe] Could not fetch payment methods for ${params.providerCustomerId}: ${String(err)}`,
      );
    }

    return {
      portalSessionId: session.id,
      portalUrl: session.url,
      capabilities: {
        canUpdatePaymentMethod: true,
        canCancel: true,
        canChangePlan: true,
        canViewReceipts: true,
        canViewPaymentMethods: true,
        canAddPaymentMethod: true,
        canRemovePaymentMethod: true,
        canSetDefaultPaymentMethod: true,
      },
      paymentMethodSummary,
    };
  }

  async cancelSubscription(params: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    await this.stripeService.cancelSubscription(
      params.providerSubscriptionId,
      params.cancelAtPeriodEnd,
    );
  }

  async resumeSubscription(params: { providerSubscriptionId: string }): Promise<void> {
    await this.stripeService.reactivateSubscription(params.providerSubscriptionId);
  }

  async changePlan(params: {
    providerSubscriptionId: string;
    newPlanCode: string;
    newProviderPriceId?: string;
  }): Promise<ProviderSubscriptionResult> {
    if (!params.newProviderPriceId) {
      throw new Error(
        `newProviderPriceId is required for real Stripe plan change to "${params.newPlanCode}".`,
      );
    }

    const existing = await this.stripeService.retrieveSubscription(params.providerSubscriptionId);
    const itemId = existing.items.data[0]?.id;
    if (!itemId) {
      throw new Error(
        `Stripe subscription ${params.providerSubscriptionId} has no items to update.`,
      );
    }

    const updated = await this.stripeService.updateSubscription(params.providerSubscriptionId, {
      items: [{ id: itemId, price: params.newProviderPriceId }],
      proration_behavior: 'create_prorations',
    });

    return mapStripeSubscription(updated);
  }

  async retrieveSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionResult> {
    const sub = await this.stripeService.retrieveSubscription(providerSubscriptionId);
    return mapStripeSubscription(sub);
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): WebhookEvent {
    const webhookSecret =
      this.config.get<string>('stripe.webhookSecret') ??
      this.config.get<string>('STRIPE_WEBHOOK_SECRET') ??
      process.env.STRIPE_WEBHOOK_SECRET ??
      '';

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required when BILLING_PROVIDER=stripe.');
    }

    const event = this.stripeService.constructWebhookEvent(rawBody, signature, webhookSecret);
    return {
      id: event.id,
      type: event.type,
      data: { object: event.data.object as unknown as Record<string, unknown> },
    };
  }
}

export { BILLING_PROVIDER };
