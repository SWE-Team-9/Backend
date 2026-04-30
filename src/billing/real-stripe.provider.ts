import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

import { StripeService } from "../stripe/stripe.service";
import {
  BILLING_PROVIDER,
  BillingPortalResult,
  CheckoutSessionResult,
  IBillingProvider,
  PaymentMethodSummary,
  ProviderSubscriptionResult,
  WebhookEvent,
} from "./billing-provider.interface";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function mapStripeSubscription(
  sub: Stripe.Subscription,
): ProviderSubscriptionResult {
  // Stripe API 2025-08-27.basil renamed / moved some subscription fields.
  // Use a typed-any access to handle the period dates safely across API versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sub as any;

  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer as string,
    status: sub.status,
    currentPeriodStart: new Date((s.current_period_start ?? 0) * 1000),
    currentPeriodEnd: new Date((s.current_period_end ?? 0) * 1000),
    trialStart: s.trial_start ? new Date(s.trial_start * 1000) : undefined,
    trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

// ── RealStripeBillingProvider ─────────────────────────────────────────────────
//
// Drop-in replacement for MockStripeBillingProvider that makes real Stripe API
// calls via the injected StripeService. Activated when BILLING_PROVIDER=stripe
// in the environment.
//
// Checkout flow (Hosted Checkout):
//   1. Frontend calls POST /subscriptions/checkout
//   2. Backend creates Stripe Checkout Session, returns { checkoutUrl }
//   3. Frontend redirects user to checkoutUrl (stripe.com hosted page)
//   4. User enters card, Stripe processes payment
//   5. Stripe sends webhook: checkout.session.completed → backend activates sub
//
// Pre-requisites:
//   - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in .env
//   - Each SubscriptionPlan record in DB must have stripePriceId set
//     (create the price in Stripe Dashboard, copy the price_id like 'price_xxx')
//   - STRIPE_CHECKOUT_SUCCESS_URL (optional, defaults to /subscriptions/success)
//   - STRIPE_CHECKOUT_CANCEL_URL  (optional, defaults to /subscriptions/cancel)
//   - STRIPE_BILLING_PORTAL_RETURN_URL (optional, defaults to /settings)

@Injectable()
export class RealStripeBillingProvider implements IBillingProvider {
  private readonly logger = new Logger(RealStripeBillingProvider.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) {}

  // ── Customer ───────────────────────────────────────────────────────────────

  /**
   * Finds an existing Stripe customer by userId metadata, or creates one.
   * Using metadata search prevents duplicate customers when users re-subscribe.
   */
  async getOrCreateCustomer(params: {
    userId: string;
    email: string;
    name?: string;
  }): Promise<string> {
    // Check for existing customer via metadata search (idempotent)
    const existingId = await this.stripeService.searchCustomersByUserId(
      params.userId,
    );
    if (existingId) {
      this.logger.debug(
        `[Stripe] Existing customer ${existingId} for user ${params.userId}`,
      );
      return existingId;
    }

    const customer = await this.stripeService.createCustomer({
      email: params.email,
      name: params.name,
      metadata: { userId: params.userId },
    });
    this.logger.debug(
      `[Stripe] Created customer ${customer.id} for user ${params.userId}`,
    );
    return customer.id;
  }

  // ── Checkout ───────────────────────────────────────────────────────────────

  /**
   * Creates a Stripe Hosted Checkout session.
   *
   * The caller (SubscriptionsService) must pass the Stripe price ID via
   * metadata.stripePriceId — this is set automatically from the DB plan record.
   *
   * Returns checkoutUrl which the frontend should redirect the browser to.
   * The subscription is activated by the checkout.session.completed webhook.
   */
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
        `No Stripe price ID for plan "${params.planCode}". ` +
          `Set stripePriceId on the SubscriptionPlan DB record ` +
          `(e.g. price_xxx from Stripe Dashboard).`,
      );
    }

    const frontendUrl =
      this.config.get<string>("app.clientUrl") ?? "http://localhost:3000";

    // success_url: {CHECKOUT_SESSION_ID} is replaced by Stripe automatically
    const successUrl =
      this.config.get<string>("billing.checkoutSuccessUrl") ??
      `${frontendUrl}/subscriptions/success?session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl =
      params.cancelUrl ??
      this.config.get<string>("billing.checkoutCancelUrl") ??
      `${frontendUrl}/subscriptions/cancel`;

    const now = new Date();
    const trialDays = params.trialDays ?? 0;
    const trialEligible = trialDays > 0;

    const sessionCreateParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: params.providerCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Stripe replaces {CHECKOUT_SESSION_ID} in success_url automatically
      success_url: params.returnUrl
        ? `${params.returnUrl}?session_id={CHECKOUT_SESSION_ID}`
        : successUrl,
      cancel_url: cancelUrl,
      // Allow discount codes to be entered on the hosted page
      allow_promotion_codes: true,
      // Prefill email if we have a customer (avoids duplicate data entry)
      ...(params.providerCustomerId ? {} : {}),
      metadata: {
        userId: params.userId,
        planCode: params.planCode,
        ...(params.metadata ?? {}),
      },
      subscription_data: {
        metadata: {
          userId: params.userId,
          planCode: params.planCode,
        },
        ...(trialEligible ? { trial_period_days: trialDays } : {}),
      },
    };

    const session =
      await this.stripeService.createCheckoutSession(sessionCreateParams);

    const trialEnd = trialEligible ? addDays(now, trialDays) : undefined;
    const renewsAt = trialEnd ?? addOneMonth(now);

    this.logger.log(
      `[Stripe] Checkout session ${session.id} created for plan=${params.planCode} trial=${trialEligible}`,
    );

    return {
      checkoutSessionId: session.id,
      checkoutUrl: session.url ?? "",
      planCode: params.planCode,
      trialEligible,
      trialDays,
      amountDueNowCents: trialEligible ? 0 : 0, // actual amount charged by Stripe on completion
      renewsAt: renewsAt.toISOString(),
      trialEndsAt: trialEnd?.toISOString(),
    };
  }

  // ── Billing Portal ─────────────────────────────────────────────────────────

  /**
   * Creates a Stripe Customer Portal session.
   *
   * The user is redirected to portalUrl where they can:
   * - Update / add / remove payment methods
   * - View and download invoices
   * - Cancel or change plans
   *
   * Must be configured in Stripe Dashboard → Billing → Customer Portal.
   */
  async createBillingPortalSession(params: {
    userId: string;
    providerCustomerId?: string;
    returnUrl?: string;
  }): Promise<BillingPortalResult> {
    if (!params.providerCustomerId) {
      throw new Error(
        "providerCustomerId is required to create a billing portal session.",
      );
    }

    const frontendUrl =
      this.config.get<string>("app.clientUrl") ?? "http://localhost:3000";

    const returnUrl =
      params.returnUrl ??
      this.config.get<string>("billing.portalReturnUrl") ??
      `${frontendUrl}/settings`;

    const session = await this.stripeService.createBillingPortalSession({
      customer: params.providerCustomerId,
      return_url: returnUrl,
    });

    // Fetch the customer's saved payment methods for the settings UI display.
    // This is best-effort — failure is non-fatal.
    let paymentMethodSummary: PaymentMethodSummary | null = null;
    try {
      const pms = await this.stripeService.listCustomerPaymentMethods(
        params.providerCustomerId,
      );
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
        `[Stripe] Could not fetch payment methods for ${params.providerCustomerId}: ${err}`,
      );
    }

    this.logger.debug(
      `[Stripe] Billing portal session ${session.id} for customer ${params.providerCustomerId}`,
    );

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

  // ── Subscription lifecycle ─────────────────────────────────────────────────

  async cancelSubscription(params: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    await this.stripeService.cancelSubscription(
      params.providerSubscriptionId,
      params.cancelAtPeriodEnd,
    );
    this.logger.debug(
      `[Stripe] Cancelled ${params.providerSubscriptionId} cancelAtPeriodEnd=${params.cancelAtPeriodEnd}`,
    );
  }

  async resumeSubscription(params: {
    providerSubscriptionId: string;
  }): Promise<void> {
    await this.stripeService.reactivateSubscription(
      params.providerSubscriptionId,
    );
    this.logger.debug(`[Stripe] Resumed ${params.providerSubscriptionId}`);
  }

  /**
   * Upgrades or switches plans by swapping the price on the Stripe subscription.
   * Creates prorations automatically so the user is charged/credited correctly.
   */
  async changePlan(params: {
    providerSubscriptionId: string;
    newPlanCode: string;
    newProviderPriceId?: string;
  }): Promise<ProviderSubscriptionResult> {
    if (!params.newProviderPriceId) {
      throw new Error(
        `newProviderPriceId is required for real Stripe plan change to "${params.newPlanCode}". ` +
          `Set stripePriceId on the SubscriptionPlan DB record.`,
      );
    }

    // Retrieve current subscription to get the subscription item ID
    const existing = await this.stripeService.retrieveSubscription(
      params.providerSubscriptionId,
    );
    const itemId = existing.items.data[0]?.id;
    if (!itemId) {
      throw new Error(
        `Stripe subscription ${params.providerSubscriptionId} has no items to update.`,
      );
    }

    const updated = await this.stripeService.updateSubscription(
      params.providerSubscriptionId,
      {
        items: [{ id: itemId, price: params.newProviderPriceId }],
        proration_behavior: "create_prorations",
      },
    );

    this.logger.debug(
      `[Stripe] Changed plan ${params.providerSubscriptionId} → ${params.newPlanCode}`,
    );

    return mapStripeSubscription(updated);
  }

  async retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionResult> {
    const sub = await this.stripeService.retrieveSubscription(
      providerSubscriptionId,
    );
    return mapStripeSubscription(sub);
  }

  // ── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Verifies the Stripe-Signature HMAC and returns a typed WebhookEvent.
   * Throws if the signature is invalid or the payload cannot be parsed.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): WebhookEvent {
    const webhookSecret = this.config.get<string>("stripe.webhookSecret") ?? "";
    const event = this.stripeService.constructWebhookEvent(
      rawBody,
      signature,
      webhookSecret,
    );
    return {
      id: event.id,
      type: event.type,
      data: { object: event.data.object as unknown as Record<string, unknown> },
    };
  }
}

export { BILLING_PROVIDER };
