import { validateEnvironment } from './env.validation';

const longSecret = 'x'.repeat(64);

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    JWT_SECRET: longSecret,
    JWT_REFRESH_SECRET: `${longSecret}refresh`,
    CLIENT_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/iqa3',
    BILLING_PROVIDER: 'mock_stripe',
    ...overrides,
  };
}

describe('validateEnvironment', () => {
  it('allows mock Stripe mode without real Stripe credentials', () => {
    expect(() => validateEnvironment(baseEnv())).not.toThrow();
  });

  it('requires Stripe secrets and checkout URLs in real Stripe mode', () => {
    expect(() =>
      validateEnvironment(
        baseEnv({
          BILLING_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: undefined,
          STRIPE_CHECKOUT_SUCCESS_URL: undefined,
          STRIPE_CHECKOUT_CANCEL_URL: undefined,
        }),
      ),
    ).toThrow(/STRIPE_SECRET_KEY is required/);
  });

  it('accepts valid test-mode Stripe credentials and URLs', () => {
    expect(() =>
      validateEnvironment(
        baseEnv({
          BILLING_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'sk_test_123456789',
          STRIPE_WEBHOOK_SECRET: 'whsec_123456789',
          STRIPE_CHECKOUT_SUCCESS_URL:
            'http://localhost:3000/subscriptions/success?session_id={CHECKOUT_SESSION_ID}',
          STRIPE_CHECKOUT_CANCEL_URL: 'http://localhost:3000/subscriptions/cancel',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects malformed Stripe secret prefixes', () => {
    expect(() =>
      validateEnvironment(
        baseEnv({
          BILLING_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: 'not-a-stripe-secret',
          STRIPE_WEBHOOK_SECRET: 'not-a-webhook-secret',
          STRIPE_CHECKOUT_SUCCESS_URL: 'http://localhost:3000/success',
          STRIPE_CHECKOUT_CANCEL_URL: 'http://localhost:3000/cancel',
        }),
      ),
    ).toThrow(/STRIPE_SECRET_KEY must start/);
  });

  it('requires SSL on production database URLs', () => {
    expect(() =>
      validateEnvironment(
        baseEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/iqa3',
        }),
      ),
    ).toThrow(/DATABASE_URL must include sslmode=require/);
  });
});
