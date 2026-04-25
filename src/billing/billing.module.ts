import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BILLING_PROVIDER } from './billing-provider.interface';
import { MockStripeBillingProvider } from './mock-stripe.provider';

/**
 * BillingModule — provides IBillingProvider to the application.
 *
 * BILLING_PROVIDER env var selects the implementation:
 *   mock_stripe (default) — MockStripeBillingProvider (no real Stripe calls)
 *   stripe               — RealStripeBillingProvider (real Stripe API calls)
 *
 * To add real Stripe support:
 * 1. Implement RealStripeBillingProvider using StripeService.
 * 2. Add it to the switch below.
 * 3. Set BILLING_PROVIDER=stripe in .env.
 */
@Module({
  providers: [
    MockStripeBillingProvider,
    {
      provide: BILLING_PROVIDER,
      useFactory: (
        config: ConfigService,
        mockProvider: MockStripeBillingProvider,
      ) => {
        const providerName =
          config.get<string>('billing.provider') ??
          process.env.BILLING_PROVIDER ??
          'mock_stripe';

        switch (providerName) {
          // TODO(RealStripe): case 'stripe': return realStripeBillingProvider;
          case 'mock_stripe':
          default:
            return mockProvider;
        }
      },
      inject: [ConfigService, MockStripeBillingProvider],
    },
  ],
  exports: [BILLING_PROVIDER, MockStripeBillingProvider],
})
export class BillingModule {}
