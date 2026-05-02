import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StripeModule } from '../stripe/stripe.module';
import { BILLING_PROVIDER } from './billing-provider.interface';
import { MockStripeBillingProvider } from './mock-stripe.provider';
import { RealStripeBillingProvider } from './real-stripe.provider';

/**
 * BillingModule - provides IBillingProvider to the application.
 *
 * BILLING_PROVIDER env var selects the implementation:
 *   mock_stripe (default) — MockStripeBillingProvider (zero real Stripe calls)
 *   stripe                — RealStripeBillingProvider (real Stripe API)
 */
@Module({
  imports: [ConfigModule, StripeModule],
  providers: [
    MockStripeBillingProvider,
    RealStripeBillingProvider,
    {
      provide: BILLING_PROVIDER,
      useFactory: (
        config: ConfigService,
        mockProvider: MockStripeBillingProvider,
        realProvider: RealStripeBillingProvider,
      ) => {
        const providerName =
          config.get<string>('billing.provider') ??
          config.get<string>('BILLING_PROVIDER') ??
          process.env.BILLING_PROVIDER ??
          'mock_stripe';

        return providerName === 'stripe' ? realProvider : mockProvider;
      },
      inject: [ConfigService, MockStripeBillingProvider, RealStripeBillingProvider],
    },
  ],
  exports: [BILLING_PROVIDER, MockStripeBillingProvider, RealStripeBillingProvider],
})
export class BillingModule {}
