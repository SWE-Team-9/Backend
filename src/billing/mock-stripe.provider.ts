import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";

import {
  BILLING_PROVIDER,
  BillingPortalResult,
  CheckoutSessionResult,
  IBillingProvider,
  PaymentMethodSummary,
  ProviderSubscriptionResult,
  WebhookEvent,
} from "./billing-provider.interface";

// ── Plan catalog (single source of truth) ────────────────────────────────────

const PLAN_CATALOG: Record<
  string,
  {
    priceCents: number;
    trialDays: number;
    uploadLimit: number;
    adsEnabled: boolean;
    canDownload: boolean;
  }
> = {
  FREE: {
    priceCents: 0,
    trialDays: 0,
    uploadLimit: 3,
    adsEnabled: true,
    canDownload: false,
  },
  PRO: {
    priceCents: 999,
    trialDays: 7,
    uploadLimit: 100,
    adsEnabled: false,
    canDownload: true,
  },
  GO_PLUS: {
    priceCents: 1999,
    trialDays: 30,
    uploadLimit: 1000,
    adsEnabled: false,
    canDownload: true,
  },
};

function mockId(prefix: string): string {
  return `${prefix}_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

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

/**
 * MockStripeBillingProvider - zero real Stripe calls.
 *
 * Generates deterministic mock IDs (mock_sub_..., mock_cus_..., etc.) and returns
 * payloads shaped close enough to real Stripe that swapping to
 * RealStripeBillingProvider requires only replacing this class.
 *
 * ── Real Stripe swap guide ─────────────────────────────────────────────────
 * To activate real Stripe, set BILLING_PROVIDER=stripe in .env and implement
 * RealStripeBillingProvider that:
 *   - getOrCreateCustomer -> stripe.customers.create / retrieve
 *   - createCheckoutSession -> stripe.checkout.sessions.create (mode='subscription')
 *   - createBillingPortalSession -> stripe.billingPortal.sessions.create
 *   - cancelSubscription -> stripe.subscriptions.update / cancel
 *   - resumeSubscription -> stripe.subscriptions.update cancel_at_period_end=false
 *   - changePlan -> stripe.subscriptions.update with new items[0].price
 *   - retrieveSubscription -> stripe.subscriptions.retrieve
 *   - constructWebhookEvent -> stripe.webhooks.constructEvent
 */
@Injectable()
export class MockStripeBillingProvider implements IBillingProvider {
  private readonly logger = new Logger(MockStripeBillingProvider.name);

  // In-memory store of mock customers: userId -> customerId
  private readonly customers = new Map<string, string>();

  // In-memory store of mock subscriptions: providerSubscriptionId -> state
  private readonly subscriptions = new Map<
    string,
    {
      status: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      trialStart?: Date;
      trialEnd?: Date;
      cancelAtPeriodEnd: boolean;
      providerCustomerId: string;
    }
  >();

  async getOrCreateCustomer(params: {
    userId: string;
    email: string;
    name?: string;
  }): Promise<string> {
    if (this.customers.has(params.userId)) {
      return this.customers.get(params.userId)!;
    }
    // TODO(RealStripe): stripe.customers.create({ email, name, metadata: { userId } })
    const customerId = mockId("cus");
    this.customers.set(params.userId, customerId);
    this.logger.debug(
      `[MOCK] Created customer ${customerId} for user ${params.userId}`,
    );
    return customerId;
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
    // TODO(RealStripe): stripe.checkout.sessions.create({
    //   mode: 'subscription',
    //   customer: params.providerCustomerId,
    //   line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    //   subscription_data: { trial_period_days: params.trialDays, metadata: params.metadata },
    //   success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL,
    //   cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL,
    // })
    const now = new Date();
    const plan = PLAN_CATALOG[params.planCode];
    const trialDays = params.trialDays ?? 0;
    const trialEligible = trialDays > 0;
    const trialEnd = trialEligible ? addDays(now, trialDays) : undefined;
    const renewsAt = trialEnd ?? addOneMonth(now);
    const amountDueNow = trialEligible ? 0 : (plan?.priceCents ?? 0);

    const sessionId = mockId("cs");
    const subId = mockId("sub");

    const result: CheckoutSessionResult = {
      checkoutSessionId: sessionId,
      checkoutUrl: `https://mock-checkout.example.com/pay?session=${sessionId}&plan=${params.planCode}`,
      planCode: params.planCode,
      trialEligible,
      trialDays,
      amountDueNowCents: amountDueNow,
      renewsAt: renewsAt.toISOString(),
      trialEndsAt: trialEnd?.toISOString(),
    };

    // Store state for later retrieval (mirrors what a real Stripe webhook would deliver)
    this.subscriptions.set(subId, {
      status: trialEligible ? "trialing" : "active",
      currentPeriodStart: now,
      currentPeriodEnd: renewsAt,
      trialStart: trialEligible ? now : undefined,
      trialEnd,
      cancelAtPeriodEnd: false,
      providerCustomerId: params.providerCustomerId ?? mockId("cus"),
    });

    this.logger.debug(
      `[MOCK] Checkout session ${sessionId} for plan ${params.planCode}, trial=${trialEligible}`,
    );
    return result;
  }

  async createBillingPortalSession(params: {
    userId: string;
    providerCustomerId?: string;
    returnUrl?: string;
  }): Promise<BillingPortalResult> {
    // TODO(RealStripe): stripe.billingPortal.sessions.create({
    //   customer: params.providerCustomerId,
    //   return_url: params.returnUrl ?? process.env.STRIPE_BILLING_PORTAL_RETURN_URL,
    // })
    const sessionId = mockId("bps");
    // Mock payment method: deterministic per-customer safe summary.
    // Real Stripe would populate this from the customer's saved payment methods.
    const mockPaymentMethod: PaymentMethodSummary = {
      brand: "visa",
      last4: "4242",
      expiryMonth: 12,
      expiryYear: 2030,
      isDefault: true,
    };
    return {
      portalSessionId: sessionId,
      portalUrl: `https://mock-portal.example.com/billing?session=${sessionId}`,
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
      paymentMethodSummary: mockPaymentMethod,
    };
  }

  async cancelSubscription(params: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    // TODO(RealStripe): if cancelAtPeriodEnd:
    //   stripe.subscriptions.update(id, { cancel_at_period_end: true })
    // else:
    //   stripe.subscriptions.cancel(id)
    const sub = this.subscriptions.get(params.providerSubscriptionId);
    if (sub) {
      if (params.cancelAtPeriodEnd) {
        sub.cancelAtPeriodEnd = true;
      } else {
        sub.status = "canceled";
      }
    }
    this.logger.debug(
      `[MOCK] Cancelled subscription ${params.providerSubscriptionId} cancelAtPeriodEnd=${params.cancelAtPeriodEnd}`,
    );
  }

  async resumeSubscription(params: {
    providerSubscriptionId: string;
  }): Promise<void> {
    // TODO(RealStripe): stripe.subscriptions.update(id, { cancel_at_period_end: false })
    const sub = this.subscriptions.get(params.providerSubscriptionId);
    if (sub) {
      sub.cancelAtPeriodEnd = false;
    }
    this.logger.debug(
      `[MOCK] Resumed subscription ${params.providerSubscriptionId}`,
    );
  }

  async changePlan(params: {
    providerSubscriptionId: string;
    newPlanCode: string;
    newProviderPriceId?: string;
  }): Promise<ProviderSubscriptionResult> {
    // TODO(RealStripe): stripe.subscriptions.update(id, {
    //   items: [{ id: existingItemId, price: newProviderPriceId }],
    //   proration_behavior: 'create_prorations',
    // })
    const sub = this.subscriptions.get(params.providerSubscriptionId);
    const now = new Date();
    const periodEnd = sub?.currentPeriodEnd ?? addOneMonth(now);

    this.logger.debug(
      `[MOCK] Changed plan for ${params.providerSubscriptionId} -> ${params.newPlanCode}`,
    );

    return {
      providerSubscriptionId: params.providerSubscriptionId,
      providerCustomerId: sub?.providerCustomerId ?? mockId("cus"),
      status: sub?.status ?? "active",
      currentPeriodStart: sub?.currentPeriodStart ?? now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }

  async retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionResult> {
    // TODO(RealStripe): stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] })
    const sub = this.subscriptions.get(providerSubscriptionId);
    const now = new Date();
    return {
      providerSubscriptionId,
      providerCustomerId: sub?.providerCustomerId ?? mockId("cus"),
      status: sub?.status ?? "active",
      currentPeriodStart: sub?.currentPeriodStart ?? now,
      currentPeriodEnd: sub?.currentPeriodEnd ?? addOneMonth(now),
      trialStart: sub?.trialStart,
      trialEnd: sub?.trialEnd,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }

  constructWebhookEvent(rawBody: Buffer, _signature: string): WebhookEvent {
    // TODO(RealStripe): stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)
    // For mock: just parse the JSON. No signature verification needed for mock events.
    try {
      const parsed = JSON.parse(rawBody.toString()) as WebhookEvent;
      if (!parsed.id || !parsed.type) {
        throw new Error("Invalid webhook payload: missing id or type");
      }
      return parsed;
    } catch {
      throw new Error("WEBHOOK_INVALID_SIGNATURE");
    }
  }
}

export { BILLING_PROVIDER };
