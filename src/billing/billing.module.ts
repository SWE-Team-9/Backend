import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StripeService } from "../stripe/stripe.service";
import { BILLING_PROVIDER } from "./billing-provider.interface";
import { MockStripeBillingProvider } from "./mock-stripe.provider";
import { RealStripeBillingProvider } from "./real-stripe.provider";

/**
 * BillingModule - provides IBillingProvider to the application.
 *
 * BILLING_PROVIDER env var selects the implementation:
 *   mock_stripe (default) — MockStripeBillingProvider (zero real Stripe calls)
 *   stripe                — RealStripeBillingProvider (live/test Stripe API)
 *
 * To switch to real Stripe:
 *   1. In .env: set BILLING_PROVIDER=stripe
 *   2. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
 *   3. Set stripePriceId on each SubscriptionPlan row in the DB
 *      (copy price_xxx from Stripe Dashboard → Products)
 *   4. Register the webhook endpoint in Stripe Dashboard:
 *      https://your-domain.com/api/v1/subscriptions/webhook
 *      Events: checkout.session.completed, invoice.paid,
 *              invoice.payment_failed, customer.subscription.deleted
 */
@Module({
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
          config.get<string>("billing.provider") ??
          process.env.BILLING_PROVIDER ??
          "mock_stripe";

        switch (providerName) {
          case "stripe":
            return realProvider;
          case "mock_stripe":
          default:
            return mockProvider;
        }
      },
      inject: [ConfigService, MockStripeBillingProvider, RealStripeBillingProvider],
    },
  ],
  exports: [BILLING_PROVIDER, MockStripeBillingProvider, RealStripeBillingProvider],
})
export class BillingModule {}
