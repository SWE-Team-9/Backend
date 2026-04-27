/**
 * IBillingProvider — billing abstraction for Module 12: Premium Subscriptions.
 *
 * Currently backed by MockStripeBillingProvider (deterministic mock IDs, no
 * real network calls). Switch to RealStripeBillingProvider by changing
 * BILLING_PROVIDER=stripe in environment config.
 *
 * All provider ID fields (providerCustomerId, providerSubscriptionId, etc.)
 * are deliberately named after Stripe concepts so that swapping providers
 * requires only replacing this implementation, not every service that uses it.
 */

export interface CheckoutSessionResult {
  /** Provider-scoped checkout session ID (e.g. cs_mock_…) */
  checkoutSessionId: string;
  /** Redirect URL the client should open in a browser/WebView */
  checkoutUrl: string;
  /** Plan that was checked out */
  planCode: string;
  /** Whether a free trial was activated */
  trialEligible: boolean;
  /** Trial length in days (0 when trialEligible=false) */
  trialDays: number;
  /** Amount charged immediately in cents (0 if trial) */
  amountDueNowCents: number;
  /** ISO datetime of first/next renewal */
  renewsAt: string;
  /** ISO datetime of trial end (only when trialEligible=true) */
  trialEndsAt?: string;
}

/**
 * Safe payment method summary — never exposes full card number, CVC, or raw tokens.
 * Suitable for displaying as "Visa ending in 4242 · expires 12/2030".
 */
export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

export interface BillingPortalResult {
  /** Provider-scoped portal session ID (e.g. bps_mock_…) */
  portalSessionId: string;
  /** URL to redirect the user to for billing management */
  portalUrl: string;
  /** Which actions are available in this portal */
  capabilities: {
    // General billing capabilities
    canUpdatePaymentMethod: boolean;
    canCancel: boolean;
    canChangePlan: boolean;
    canViewReceipts: boolean;
    // Payment method–specific capabilities
    canViewPaymentMethods: boolean;
    canAddPaymentMethod: boolean;
    canRemovePaymentMethod: boolean;
    canSetDefaultPaymentMethod: boolean;
  };
  /** Safe summary of the current default payment method, if one is stored */
  paymentMethodSummary?: PaymentMethodSummary | null;
}

export interface ProviderSubscriptionResult {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart?: Date;
  trialEnd?: Date;
  cancelAtPeriodEnd: boolean;
}

export interface WebhookEvent {
  /** Unique provider event ID — used for idempotency checks */
  id: string;
  /** Event type string (e.g. 'invoice.paid', 'customer.subscription.deleted') */
  type: string;
  data: { object: Record<string, unknown> };
}

export interface IBillingProvider {
  /**
   * Create a checkout session for a new subscription.
   * For real Stripe: stripe.checkout.sessions.create with mode='subscription'.
   */
  createCheckoutSession(params: {
    userId: string;
    planCode: string;
    providerCustomerId?: string;
    trialDays?: number;
    returnUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<CheckoutSessionResult>;

  /**
   * Create a billing portal session so the user can manage payment methods,
   * cancel, or change plans.
   * For real Stripe: stripe.billingPortal.sessions.create
   */
  createBillingPortalSession(params: {
    userId: string;
    providerCustomerId?: string;
    returnUrl?: string;
  }): Promise<BillingPortalResult>;

  /**
   * Cancel a subscription (at period end or immediately).
   * For real Stripe: stripe.subscriptions.update cancel_at_period_end=true
   * or stripe.subscriptions.cancel for immediate.
   */
  cancelSubscription(params: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void>;

  /**
   * Resume a subscription that was set to cancel_at_period_end.
   * For real Stripe: stripe.subscriptions.update cancel_at_period_end=false
   */
  resumeSubscription(params: { providerSubscriptionId: string }): Promise<void>;

  /**
   * Change the plan on an active subscription (e.g. PRO ↔ GO+).
   * For real Stripe: stripe.subscriptions.update with new price item.
   */
  changePlan(params: {
    providerSubscriptionId: string;
    newPlanCode: string;
    newProviderPriceId?: string;
  }): Promise<ProviderSubscriptionResult>;

  /**
   * Retrieve current subscription state from the provider.
   * For real Stripe: stripe.subscriptions.retrieve
   */
  retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionResult>;

  /**
   * Verify and parse an inbound webhook payload.
   * For real Stripe: stripe.webhooks.constructEvent
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): WebhookEvent;

  /**
   * Create or retrieve a provider customer ID for a user.
   * For real Stripe: stripe.customers.create / stripe.customers.retrieve
   */
  getOrCreateCustomer(params: {
    userId: string;
    email: string;
    name?: string;
  }): Promise<string>;
}

/** NestJS injection token for the billing provider */
export const BILLING_PROVIDER = "BILLING_PROVIDER";
