import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('stripe.secretKey') ?? '';
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    });
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
      if (customer.deleted) return null;
      return customer as Stripe.Customer;
    } catch {
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
  // Used by the frontend to securely collect card details via Stripe.js.
  // The frontend confirms the SetupIntent and gets back a paymentMethodId.

  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    return this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
  }

  // ── Payment Method ────────────────────────────────────────────────────────

  async retrievePaymentMethod(
    paymentMethodId: string,
  ): Promise<Stripe.PaymentMethod> {
    return this.stripe.paymentMethods.retrieve(paymentMethodId);
  }

  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string,
  ): Promise<Stripe.PaymentMethod> {
    return this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async listCustomerPaymentMethods(
    customerId: string,
  ): Promise<Stripe.PaymentMethod[]> {
    const response = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return response.data;
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  async createSubscription(params: {
    customerId: string;
    priceId: string;
    paymentMethodId: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    // Ensure the payment method is attached to the customer
    await this.stripe.customers.update(params.customerId, {
      invoice_settings: {
        default_payment_method: params.paymentMethodId,
      },
    });

    return this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      default_payment_method: params.paymentMethodId,
      trial_period_days: params.trialPeriodDays,
      metadata: params.metadata ?? {},
      // Expand the latest invoice so we can inspect its payment intent
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async cancelSubscription(
    stripeSubscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<void> {
    if (atPeriodEnd) {
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      await this.stripe.subscriptions.cancel(stripeSubscriptionId);
    }
  }

  async reactivateSubscription(
    stripeSubscriptionId: string,
  ): Promise<Stripe.Subscription> {
    // Un-cancel a subscription that was set to cancel at period end
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async retrieveSubscription(
    stripeSubscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(stripeSubscriptionId);
  }

  async updateSubscription(
    stripeSubscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, params);
  }

  // ── Webhook ───────────────────────────────────────────────────────────────
  // Verifies the Stripe-Signature header and parses the raw body.
  // Throws if the signature is invalid.

  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
    webhookSecret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}
