import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly config: ConfigService) {
    const billingProvider =
      this.config.get<string>('billing.provider') ??
      this.config.get<string>('BILLING_PROVIDER') ??
      process.env.BILLING_PROVIDER ??
      'mock_stripe';

    const secretKey =
      this.config.get<string>('stripe.secretKey') ??
      this.config.get<string>('STRIPE_SECRET_KEY') ??
      process.env.STRIPE_SECRET_KEY ??
      '';

    const isRealStripe = billingProvider === 'stripe';

    if (isRealStripe && !secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required when BILLING_PROVIDER=stripe.');
    }

    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const isLiveKey =
      secretKey.startsWith('sk_live_') ||
      secretKey.startsWith('pk_live_') ||
      secretKey.startsWith('rk_live_');
    if (isLiveKey && nodeEnv !== 'production') {
      throw new Error(
        `Live Stripe key detected in NODE_ENV=${nodeEnv}. Use sk_test_ keys for dev/test.`,
      );
    }

    const stripeKey = secretKey || 'sk_test_mock_key_do_not_use_in_real_payments';

    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2025-08-27.basil',
      typescript: true,
    });

    if (!isRealStripe) {
      this.logger.warn(
        `StripeService initialized with BILLING_PROVIDER=${billingProvider}. Real Stripe network calls must not be used in mock mode.`,
      );
    }
  }

  // ── Customer ─────────────────────────────────────────────────────────────

  async createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata ?? {},
    });
  }

  async retrieveCustomer(customerId: string): Promise<Stripe.Customer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if ('deleted' in customer && customer.deleted) return null;
      return customer as Stripe.Customer;
    } catch (err) {
      this.logger.warn(`[STRIPE] Failed to retrieve customer ${customerId}: ${String(err)}`);
      return null;
    }
  }

  async updateCustomerDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // ── Setup Intent ─────────────────────────────────────────────────────────

  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    return this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });
  }

  async retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
    return this.stripe.setupIntents.retrieve(setupIntentId);
  }

  // ── Payment Method ───────────────────────────────────────────────────────

  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return this.stripe.paymentMethods.retrieve(paymentMethodId);
  }

  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string,
  ): Promise<Stripe.PaymentMethod> {
    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);

    const currentCustomer =
      typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : paymentMethod.customer?.id;

    if (currentCustomer && currentCustomer !== customerId) {
      throw new Error('Payment method is already attached to a different Stripe customer.');
    }

    if (currentCustomer === customerId) {
      return paymentMethod;
    }

    return this.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async listCustomerPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const response = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return response.data;
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  async createSubscription(params: {
    customerId: string;
    priceId: string;
    paymentMethodId: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    await this.stripe.customers.update(params.customerId, {
      invoice_settings: { default_payment_method: params.paymentMethodId },
    });

    return this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      default_payment_method: params.paymentMethodId,
      trial_period_days: params.trialPeriodDays,
      metadata: params.metadata ?? {},
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async cancelSubscription(stripeSubscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (atPeriodEnd) {
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      return;
    }

    await this.stripe.subscriptions.cancel(stripeSubscriptionId);
  }

  async reactivateSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async retrieveSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async updateSubscription(
    stripeSubscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, params);
  }

  async listCustomerSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
    const response = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      expand: ['data.latest_invoice.payment_intent'],
    });

    return response.data;
  }

  // ── Invoice ───────────────────────────────────────────────────────────────

  async retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return this.stripe.invoices.retrieve(invoiceId, {
      expand: ['payment_intent', 'subscription'],
    });
  }

  async listCustomerInvoices(customerId: string): Promise<Stripe.Invoice[]> {
    const response = await this.stripe.invoices.list({
      customer: customerId,
      limit: 100,
      expand: ['data.payment_intent', 'data.subscription'],
    });

    return response.data;
  }

  async payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return this.stripe.invoices.pay(invoiceId);
  }

  // ── Customer Search ───────────────────────────────────────────────────────

  async searchCustomersByUserId(userId: string): Promise<string | null> {
    const escapedUserId = userId.replace(/'/g, "\\'");

    const result = await this.stripe.customers.search({
      query: `metadata['userId']:'${escapedUserId}'`,
      limit: 1,
    });

    return result.data[0]?.id ?? null;
  }

  // ── Checkout Session ─────────────────────────────────────────────────────

  async createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create(params);
  }

  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription', 'payment_intent', 'setup_intent'],
    });
  }

  // ── Billing Portal ───────────────────────────────────────────────────────

  async createBillingPortalSession(
    params: Stripe.BillingPortal.SessionCreateParams,
  ): Promise<Stripe.BillingPortal.Session> {
    return this.stripe.billingPortal.sessions.create(params);
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
    webhookSecret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  getClient(): Stripe {
    return this.stripe;
  }
}
