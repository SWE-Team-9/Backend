# Module 12 — Premium Subscriptions

## Overview

Module 12 provides a complete subscription management system with plan-based entitlements, trial periods, billing provider abstraction, grace-period payment handling, and offline track downloads.

---

## Plans

| Code       | Price    | Uploads | Ads  | Downloads | Trial  |
|------------|----------|---------|------|-----------|--------|
| `FREE`     | $0       | 3       | Yes  | No        | —      |
| `PRO`      | $9.99/mo | 100     | No   | Yes       | 7 days |
| `GO_PLUS`  | $19.99/mo| 1,000   | No   | Yes       | 30 days|

**Key constants** (exported from `subscriptions.service.ts`):
- `FREE_UPLOAD_LIMIT = 3`
- `GRACE_PERIOD_DAYS = 1`
- `PLAN_CONFIG` — single source of truth for plan metadata

---

## Endpoints

All endpoints are under `/api/v1/subscriptions` and require JWT auth unless marked **public**.

| Method | Path                        | Auth   | Description                                   |
|--------|-----------------------------|--------|-----------------------------------------------|
| GET    | `/me`                       | JWT    | Current subscription status + entitlements    |
| GET    | `/plans`                    | Public | List all available plans                      |
| GET    | `/invoices`                 | JWT    | Invoice history for the authenticated user    |
| GET    | `/offline/:trackId`         | JWT    | Get a time-limited download URL (PRO/GO+)     |
| POST   | `/checkout`                 | JWT    | Start a new subscription (Module 12 canonical)|
| POST   | `/subscribe`                | JWT    | Alias for `/checkout` (backward-compat)       |
| POST   | `/portal`                   | JWT    | Create a billing portal session URL           |
| POST   | `/resume`                   | JWT    | Resume a scheduled-to-cancel subscription     |
| POST   | `/change-plan`              | JWT    | Upgrade or downgrade plan                     |
| POST   | `/cancel`                   | JWT    | Cancel subscription at period end             |
| POST   | `/webhook`                  | Public | Stripe webhook receiver                       |

### GET /me — Response shape

```json
{
  "userId": "uuid",
  "planCode": "PRO",
  "subscriptionType": "PRO",
  "subscriptionStatus": "ACTIVE",
  "planName": "Pro Monthly",
  "isPremium": true,
  "adsEnabled": false,
  "canDownload": true,
  "supportLevel": "priority",
  "uploadLimit": 100,
  "uploadLimitDisplay": "100",
  "uploadedTracks": 12,
  "remainingUploads": 88,
  "currentPeriodEnd": "2025-08-01T00:00:00.000Z",
  "renewalDate": "2025-08-01T00:00:00.000Z",
  "expiresAt": null,
  "cancelAtPeriodEnd": false,
  "trialStart": null,
  "trialEnd": null,
  "paymentMethodSummary": null,
  "latestInvoice": null
}
```

### POST /checkout — Request body

```json
{
  "planCode": "PRO",
  "returnUrl": "https://app.example.com/dashboard",
  "cancelUrl": "https://app.example.com/pricing"
}
```

Response includes `checkoutSessionId`, `checkoutUrl`, `planCode`, `trialEligible`, `trialDays`, `amountDueNowCents`, `renewsAt`, `trialEndsAt`, `priceCents`.

### POST /subscribe (backward-compat) — Request body

```json
{
  "subscriptionType": "PRO",
  "paymentMethodId": "pm_optional"
}
```

Delegates to `/checkout` internally.

---

## Trial Abuse Prevention

`TrialRedemption` table enforces one trial per user per plan (unique `[userId, planCode]`). On checkout:
- `trialRedemption.findUnique` → if found, trial is skipped and user pays full price.
- On successful checkout with trial, a `TrialRedemption` record is created.

---

## Payment Grace Period

When `invoice.payment_failed` fires:
- Subscription status → `PAST_DUE`
- `paymentFailureGraceEndsAt` = now + `GRACE_PERIOD_DAYS` (1 day)
- User **keeps full access** during the grace period
- A `sendPaymentGracePeriodEmail` is sent

If a second failure occurs or the grace period expires (cron job in `TrialSchedulerService`):
- Status → `CANCELED`
- Tracks are hidden to the FREE plan limit (`applyPlanLimitToTracks`)
- Offline downloads are revoked (`revokeOfflineDownloads`)

---

## Plan Limit Enforcement

`applyPlanLimitToTracks(userId, newLimit)`:
- Keeps the **newest N tracks** visible (where N = uploadLimit)
- Older tracks are auto-hidden via `hiddenByPlanLimit = true`
- On upgrade, previously auto-hidden tracks within the new limit are restored
- Tracks are **never deleted**

---

## Offline Downloads

`GET /offline/:trackId` requires `PRO` or `GO_PLUS`:
- Returns a time-limited download URL
- Local storage: URL valid for 1 hour
- S3 storage: signed URL TTL controlled by `S3_DOWNLOAD_URL_TTL_SECONDS` env var (default: 900 s)
- Prefers `STREAM` file over `ORIGINAL` when both exist

---

## Billing Provider Abstraction

`IBillingProvider` (token: `BILLING_PROVIDER`) in `src/billing/`:

```typescript
interface IBillingProvider {
  getOrCreateCustomer(opts): Promise<string>;
  createCheckoutSession(opts): Promise<CheckoutSessionResult>;
  createBillingPortalSession(opts): Promise<BillingPortalResult>;
  cancelSubscription(opts): Promise<{ canceled: boolean }>;
  resumeSubscription(opts): Promise<{ resumed: boolean }>;
  changePlan(opts): Promise<{ changed: boolean }>;
  retrieveSubscription(opts): Promise<unknown>;
  constructWebhookEvent(rawBody, signature): WebhookEvent;
}
```

Active provider is selected by `billing.provider` config key:
- `mock_stripe` → `MockStripeBillingProvider` (default for local dev)
- `stripe` → real Stripe SDK (production)

---

## Entitlements Service

`EntitlementsService` (`src/entitlements/`) wraps subscription checks:

| Method                        | Description                                      |
|-------------------------------|--------------------------------------------------|
| `getUserEntitlements(userId)` | Full entitlement object from `/me`               |
| `canUploadTrack(userId)`      | Returns `true` if under upload quota             |
| `assertCanUploadTrack(userId)`| Throws `ForbiddenException` if over quota        |
| `canDownloadTrack(userId)`    | Returns `true` if PRO or GO+                     |
| `isPremium(userId)`           | Returns `true` if not FREE                       |

**Endpoint:** `GET /api/v1/entitlements/me`

---

## Webhook Events Handled

| Stripe event                          | Action                                               |
|---------------------------------------|------------------------------------------------------|
| `checkout.session.completed`          | Mark subscription `ACTIVE`                           |
| `invoice.paid` / `payment_succeeded`  | Mark subscription `ACTIVE`, create invoice record    |
| `invoice.payment_failed`              | Mark `PAST_DUE`, start grace period, send email      |
| `invoice.payment_action_required`     | Same as `payment_failed`                             |
| `customer.subscription.updated`       | Sync status / cancelAtPeriodEnd from Stripe          |
| `customer.subscription.deleted`       | Mark `CANCELED`, revoke downloads, apply plan limits |
| `customer.subscription.trial_will_end`| Send trial-ending reminder email                     |

**Idempotency**: Each event is deduplicated by `stripeEventId` in `PaymentEvent` table.

**Raw body**: The webhook endpoint requires the raw request body (not parsed JSON) for signature verification. This is configured in `main.ts`:
```typescript
app.use('/api/v1/subscriptions/webhook', express.raw({ type: 'application/json', limit: '64kb' }), (req, _res, next) => {
  req.rawBody = req.body;
  next();
});
```

---

## Cron Jobs (TrialSchedulerService)

| Cron               | Method                                    | Action                                       |
|--------------------|-------------------------------------------|----------------------------------------------|
| `0 9 * * *`        | `sendTrialEndingReminders()`              | Email users whose trial ends in 3 days       |
| `0 0 * * *`        | `expireTrials()`                          | Move expired `TRIALING` → `ACTIVE`           |
| `0 0 * * *`        | `cancelExpiredGracePeriodSubscriptions()` | Cancel `PAST_DUE` past grace period → FREE   |
| Every minute       | `processScheduledCancellations()`         | Cancel `cancelAtPeriodEnd` past period end   |

---

## Email Notifications

| Trigger                 | MailService method                   |
|-------------------------|--------------------------------------|
| Trial started           | `sendTrialStartedEmail`              |
| Subscription confirmed  | `sendSubscriptionConfirmationEmail`  |
| Trial ending (3d)       | `sendTrialEndingEmail`               |
| Payment failed          | `sendPaymentGracePeriodEmail`        |
| Subscription cancelled  | `sendCancellationConfirmedEmail`     |
| Invoice receipt         | `sendInvoiceReceiptEmail`            |
| Plan changed            | `sendPlanChangedEmail`               |
| Moved to FREE (unpaid)  | `sendPaymentFailedMovedToFreeEmail`  |

---

## Environment Variables

| Variable                       | Description                                      | Default        |
|--------------------------------|--------------------------------------------------|----------------|
| `BILLING_PROVIDER`             | `mock_stripe` or `stripe`                        | `mock_stripe`  |
| `STRIPE_SECRET_KEY`            | Stripe API key (required if `stripe`)            | —              |
| `STRIPE_WEBHOOK_SECRET`        | Stripe webhook signing secret                    | —              |
| `S3_DOWNLOAD_URL_TTL_SECONDS`  | TTL for S3 signed download URLs                  | `900`          |

---

## Database Models (Prisma)

**`UserSubscription`** — extended fields added in this module:
- `trialStart`, `trialEnd` — trial period dates
- `paymentFailureAt`, `paymentFailureGraceEndsAt` — grace period tracking
- `paymentMethodSummary` — e.g. `"Visa •••• 4242"`

**`TrialRedemption`** — `@@unique([userId, planCode])` prevents double trials.

**`Track`** — extended fields:
- `hiddenByPlanLimit` (Boolean) — auto-hidden by plan enforcement
- `hiddenByPlanLimitAt` (DateTime) — when it was auto-hidden

**`OfflineDownload`** — composite PK `[userId, deviceId, trackId]`.
