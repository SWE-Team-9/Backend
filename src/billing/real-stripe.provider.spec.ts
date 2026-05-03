import { ConfigService } from '@nestjs/config';

import { RealStripeBillingProvider } from '../billing/real-stripe.provider';
import { StripeService } from '../stripe/stripe.service';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeStripeServiceMock() {
  return {
    searchCustomersByUserId: jest.fn().mockResolvedValue(null),
    createCustomer: jest.fn().mockResolvedValue({ id: 'cus_new' }),
    createCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    }),
    createBillingPortalSession: jest.fn().mockResolvedValue({
      id: 'bps_test_123',
      url: 'https://billing.stripe.com/session/test',
    }),
    listCustomerPaymentMethods: jest.fn().mockResolvedValue([
      {
        id: 'pm_123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2030,
        },
      },
    ]),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    reactivateSubscription: jest.fn().mockResolvedValue({ id: 'sub_123' }),
    retrieveSubscription: jest.fn().mockResolvedValue({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ id: 'si_123' }] },
      current_period_start: 1770000000,
      current_period_end: 1772592000,
    }),
    updateSubscription: jest.fn().mockResolvedValue({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ id: 'si_123' }] },
      current_period_start: 1770000000,
      current_period_end: 1772592000,
    }),
    constructWebhookEvent: jest.fn().mockReturnValue({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123' } },
    }),
  };
}

describe('RealStripeBillingProvider', () => {
  let stripe: ReturnType<typeof makeStripeServiceMock>;
  let provider: RealStripeBillingProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    stripe = makeStripeServiceMock();
    provider = new RealStripeBillingProvider(
      stripe as unknown as StripeService,
      makeConfig({
        'app.clientUrl': 'https://dev.iqa3.tech',
        'billing.checkoutSuccessUrl':
          'https://dev.iqa3.tech/subscriptions/success?session_id={CHECKOUT_SESSION_ID}',
        'billing.checkoutCancelUrl': 'https://dev.iqa3.tech/subscriptions/cancel',
        'billing.portalReturnUrl': 'https://dev.iqa3.tech/settings',
        'stripe.webhookSecret': 'whsec_test_123',
      }),
    );
  });

  describe('getOrCreateCustomer', () => {
    it('returns an existing Stripe customer found by user metadata', async () => {
      stripe.searchCustomersByUserId.mockResolvedValueOnce('cus_existing');

      await expect(
        provider.getOrCreateCustomer({ userId: 'user-1', email: 'user@example.com' }),
      ).resolves.toBe('cus_existing');
      expect(stripe.createCustomer).not.toHaveBeenCalled();
    });

    it('creates a customer when none exists', async () => {
      await expect(
        provider.getOrCreateCustomer({
          userId: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
        }),
      ).resolves.toBe('cus_new');

      expect(stripe.createCustomer).toHaveBeenCalledWith({
        email: 'user@example.com',
        name: 'Test User',
        metadata: { userId: 'user-1' },
      });
    });
  });

  describe('createCheckoutSession', () => {
    it('throws when the DB plan does not provide stripePriceId', async () => {
      await expect(
        provider.createCheckoutSession({ userId: 'user-1', planCode: 'PRO' }),
      ).rejects.toThrow('No Stripe price ID');
    });

    it('creates a non-trial Checkout Session with a real amount due', async () => {
      const result = await provider.createCheckoutSession({
        userId: 'user-1',
        planCode: 'GO_PLUS',
        providerCustomerId: 'cus_123',
        trialDays: 0,
        metadata: {
          planId: 'plan-go-plus',
          stripePriceId: 'price_go_plus',
          priceCents: '1999',
        },
      });

      expect(result).toMatchObject({
        checkoutSessionId: 'cs_test_123',
        checkoutUrl: 'https://checkout.stripe.com/cs_test_123',
        planCode: 'GO_PLUS',
        trialEligible: false,
        trialDays: 0,
        amountDueNowCents: 1999,
      });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer: 'cus_123',
          line_items: [{ price: 'price_go_plus', quantity: 1 }],
          subscription_data: expect.not.objectContaining({ trial_period_days: expect.any(Number) }),
        }),
      );
    });

    it('creates a PRO trial Checkout Session with amountDueNowCents=0', async () => {
      const result = await provider.createCheckoutSession({
        userId: 'user-1',
        planCode: 'PRO',
        providerCustomerId: 'cus_123',
        trialDays: 7,
        metadata: {
          planId: 'plan-pro',
          stripePriceId: 'price_pro',
          priceCents: '999',
        },
      });

      expect(result.trialEligible).toBe(true);
      expect(result.amountDueNowCents).toBe(0);
      expect(result.trialEndsAt).toBeDefined();
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_data: expect.objectContaining({ trial_period_days: 7 }),
        }),
      );
    });
  });

  describe('createBillingPortalSession', () => {
    it('requires providerCustomerId', async () => {
      await expect(provider.createBillingPortalSession({ userId: 'user-1' })).rejects.toThrow(
        'providerCustomerId is required',
      );
    });

    it('returns portal capabilities and payment method summary', async () => {
      const result = await provider.createBillingPortalSession({
        userId: 'user-1',
        providerCustomerId: 'cus_123',
      });

      expect(result.portalSessionId).toBe('bps_test_123');
      expect(result.capabilities.canUpdatePaymentMethod).toBe(true);
      expect(result.paymentMethodSummary).toEqual({
        brand: 'visa',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2030,
        isDefault: true,
      });
    });
  });

  describe('subscription operations', () => {
    it('delegates cancelSubscription to StripeService', async () => {
      await provider.cancelSubscription({
        providerSubscriptionId: 'sub_123',
        cancelAtPeriodEnd: true,
      });
      expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_123', true);
    });

    it('delegates resumeSubscription to StripeService', async () => {
      await provider.resumeSubscription({ providerSubscriptionId: 'sub_123' });
      expect(stripe.reactivateSubscription).toHaveBeenCalledWith('sub_123');
    });

    it('requires newProviderPriceId for real Stripe plan changes', async () => {
      await expect(
        provider.changePlan({ providerSubscriptionId: 'sub_123', newPlanCode: 'GO_PLUS' }),
      ).rejects.toThrow('newProviderPriceId is required');
    });

    it('updates the existing Stripe subscription item when changing plan', async () => {
      const result = await provider.changePlan({
        providerSubscriptionId: 'sub_123',
        newPlanCode: 'GO_PLUS',
        newProviderPriceId: 'price_go_plus',
      });

      expect(stripe.updateSubscription).toHaveBeenCalledWith('sub_123', {
        items: [{ id: 'si_123', price: 'price_go_plus' }],
        proration_behavior: 'create_prorations',
      });
      expect(result.providerSubscriptionId).toBe('sub_123');
      expect(result.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe('constructWebhookEvent', () => {
    it('requires STRIPE_WEBHOOK_SECRET', () => {
      const noSecretProvider = new RealStripeBillingProvider(
        stripe as unknown as StripeService,
        makeConfig({}),
      );

      expect(() => noSecretProvider.constructWebhookEvent(Buffer.from('{}'), 'sig')).toThrow(
        'STRIPE_WEBHOOK_SECRET is required',
      );
    });

    it('verifies and maps Stripe webhook events', () => {
      const raw = Buffer.from('raw-body');
      const event = provider.constructWebhookEvent(raw, 'sig_123');

      expect(stripe.constructWebhookEvent).toHaveBeenCalledWith(raw, 'sig_123', 'whsec_test_123');
      expect(event).toEqual({
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123' } },
      });
    });
  });
});
