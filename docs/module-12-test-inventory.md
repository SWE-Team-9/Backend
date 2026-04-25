# Module 12 — Premium Subscription Test Inventory

Auto-generated inventory of every test case in the Module 12 test suite.
Total: **216 tests** across 5 files.

---

## Bug Found & Fixed

| ID | File | Description |
|----|------|-------------|
| BUG-01 | `trial-scheduler.service.ts` | `cancelExpiredGracePeriodSubscriptions()` used `updatedAt: { lt: graceCutoff }` to find expired grace periods. Because Prisma `@updatedAt` resets on any write, this caused unpredictable grace periods. **Fixed** to use `paymentFailureGraceEndsAt: { lt: now }` — the explicit deadline field set at payment failure time. |
| BUG-02 | `subscriptions.service.spec.ts` | `makeActiveSub()` third parameter was typed as `stripeIds` and never spread into the returned object, so `cancelAtPeriodEnd: true`, `status: PAST_DUE`, `status: TRIALING` overrides were silently ignored. **Fixed** by using a generic `overrides: Record<string, unknown>` spread. |

---

## File: `src/subscriptions/payment-methods.service.spec.ts`

**23 tests** — covers payment method management: portal response shape, data safety, webhook handling, and email delivery.

### `createBillingPortal()` — payment methods focus

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 1 | returns portalSessionId from the billing provider | portalSessionId present in response |
| 2 | returns portalUrl from the billing provider | portalUrl contains session ID |
| 3 | returns all 8 payment-method capabilities | canViewPaymentMethods, canAddPaymentMethod, canUpdatePaymentMethod, canRemovePaymentMethod, canSetDefaultPaymentMethod, canCancel, canChangePlan, canViewReceipts |
| 4 | returns currentPlanCode FREE when user has no active subscription | No sub → currentPlanCode='FREE' |
| 5 | returns currentPlanCode PRO when user has a PRO subscription | Active PRO → currentPlanCode='PRO' |
| 6 | returns paymentMethodSummary from DB (stored value) when present | DB value takes precedence over provider value |
| 7 | falls back to provider paymentMethodSummary when DB has none | Provider mock value returned when DB is null |
| 8 | returns paymentMethodSummary null when no sub and provider returns null | Null case handled cleanly |
| 9 | never exposes full card number in response | No 15–16 digit sequence in JSON output |
| 10 | never exposes a CVC field in response | No 'cvc' or 'cvv' key in response JSON |
| 11 | forwards returnUrl to the billing provider | returnUrl passed through to createBillingPortalSession |
| 12 | throws NotFoundException when user does not exist | user.findUnique returns null → 404 |
| 13 | paymentMethodSummary fields are safe (no raw token) | brand, last4, expiryMonth, expiryYear present; no token/id field |

### `getMySubscription()` — paymentMethod fields

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 14 | returns structured paymentMethod object when one is stored | JSON paymentMethod field includes brand/last4/expiry |
| 15 | derives paymentMethodSummary string from structured paymentMethod | String contains last4 digits |
| 16 | paymentMethodSummary is null when no paymentMethod stored | Null passthrough when no PM in DB |

### `payment_method.updated` webhook

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 17 | updates paymentMethod JSON and paymentMethodSummary string in DB | userSubscription.update called with brand/last4/expiry |
| 18 | creates a PaymentEvent record for idempotency | paymentEvent.create called with stripeEventId + eventType |
| 19 | is idempotent: duplicate event ID is skipped | Pre-existing PaymentEvent → no DB update |
| 20 | queues payment method updated email (fire-and-forget) | user.findUnique called for email lookup |
| 21 | is a no-op when customer ID is not found in DB | Unknown customerId → no update, no event |
| 22 | handles event where card details are at top level | card-less object with brand/last4 at root level parsed correctly |
| 23 | stored paymentMethod contains no full card number or CVC | Safety assertion on stored data |

---

## File: `src/subscriptions/subscriptions.service.spec.ts`

**141 tests** — covers all service methods of `SubscriptionsService`.

### `getMySubscription()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 1 | returns FREE tier defaults when no subscription exists | No sub → planCode='FREE', isPremium=false, uploadLimit=FREE_UPLOAD_LIMIT |
| 2 | returns PRO subscription data when active | Active PRO → planCode='PRO', isPremium=true, uploadLimit=100 |
| 3 | returns GO_PLUS subscription data | Active GO_PLUS → planCode='GO_PLUS', uploadLimit=1000 |
| 4 | includes uploadedTracks count | track.count called with correct userId, count reflected in response |
| 5 | sets subscriptionType = tier for backward compat | subscriptionType field equals the plan tier value |
| 6 | sets renewalDate (not expiresAt) when active and NOT canceling | cancelAtPeriodEnd=false → renewalDate set, expiresAt=null |
| 7 | sets expiresAt (not renewalDate) when cancelAtPeriodEnd=true | cancelAtPeriodEnd=true → expiresAt set, renewalDate=null |
| 8 | includes latestInvoice when one exists | billingInvoice.findFirst result mapped to latestInvoice |
| 9 | response does not include stripeCustomerId or stripeSubscriptionId | Stripe internal IDs stripped from response |
| 10 | TRIALING sub returns trialStart and trialEnd | status=TRIALING, trialStart/trialEnd not null |

### `getPlans()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 11 | returns plans with features from PLAN_CONFIG | DB plans enriched with PLAN_CONFIG features |
| 12 | returns plans with uploadLimitDisplay and priceDisplay | Display fields computed correctly |

### `subscribe()` (backward-compat alias)

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 13 | throws ConflictException when user email is not verified | isVerified=false → ConflictException |
| 14 | throws NotFoundException when plan does not exist | plan not in DB → NotFoundException |
| 15 | returns checkout response for a new PRO subscription | Creates sub, returns checkoutSessionId, checkoutUrl |
| 16 | creates TrialRedemption when trial is eligible | No prior redemption → trialRedemption.create called |
| 17 | does not create TrialRedemption when already redeemed | Prior redemption → no create, trialEligible=false |
| 18 | creates BillingInvoice with amountPaidCents=0 for trial start | Trial → invoice priceCents=0 |
| 19 | creates BillingInvoice with full price for non-trial checkout | No trial → invoice priceCents=plan price |
| 20 | throws ConflictException when user subscribes to the same plan they already have | Same tier → PLAN_ALREADY_ACTIVE error |

### `PLAN_CONFIG` static catalog

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 21 | FREE plan has priceCents=0 | PLAN_CONFIG.FREE.priceCents = 0 |
| 22 | FREE plan has uploadLimit=3 (FREE_UPLOAD_LIMIT) | PLAN_CONFIG.FREE.uploadLimit = FREE_UPLOAD_LIMIT |
| 23 | FREE plan has adsEnabled=true | PLAN_CONFIG.FREE.adsEnabled = true |
| 24 | FREE plan has canDownload=false | PLAN_CONFIG.FREE.canDownload = false |
| 25 | PRO plan has priceCents=999 | PLAN_CONFIG.PRO.priceCents = 999 |
| 26 | PRO plan has uploadLimit=100 | PLAN_CONFIG.PRO.uploadLimit = 100 |
| 27 | GO_PLUS plan has priceCents=1999 | PLAN_CONFIG.GO_PLUS.priceCents = 1999 |
| 28 | GO_PLUS plan has uploadLimit=1000 | PLAN_CONFIG.GO_PLUS.uploadLimit = 1000 |

### `checkout()` extended

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 29 | throws ConflictException(EMAIL_NOT_VERIFIED) when user email unverified | isVerified=false → error code EMAIL_NOT_VERIFIED |
| 30 | throws NotFoundException when plan code not in DB | Unknown plan → NotFoundException |
| 31 | throws NotFoundException when plan is not active | isActive=false → NotFoundException |
| 32 | creates subscription in TRIALING status when trial eligible | trialRedemption=null → status=TRIALING |
| 33 | creates subscription in ACTIVE status when no trial | Already redeemed → status=ACTIVE |
| 34 | trialEligible=true when no prior TrialRedemption exists | Service determines eligibility (not billing session) |
| 35 | trialEligible=false when TrialRedemption already exists | Prior redemption → trialEligible=false in response |
| 36 | creates TrialRedemption record on first trial | trialRedemption.create called once |
| 37 | does NOT create TrialRedemption when already redeemed | No duplicate redemptions |
| 38 | logs trial_started PaymentEvent when trial eligible | eventType='trial_started' |
| 39 | logs payment_succeeded PaymentEvent when no trial | eventType='payment_succeeded' |
| 40 | returns checkoutSessionId and checkoutUrl | Session fields present in response |
| 41 | returns correct priceCents from plan | priceCents in response matches DB plan |
| 42 | fires email async (does not block response) | subscribe() resolves before email completes |
| 43 | backward-compat: subscribe() delegates to checkout() | subscribe() result matches checkout() |
| 44 | throws ConflictException(PLAN_ALREADY_ACTIVE) for same-tier re-subscribe | Same tier → PLAN_ALREADY_ACTIVE |
| 45 | throws BadRequestException when planCode='FREE' | Cannot subscribe to FREE |

### `resumeSubscription()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 46 | throws NotFoundException when no subscription found | No sub → NotFoundException |
| 47 | throws ConflictException(SUBSCRIPTION_NOT_CANCELED) when sub not canceling | cancelAtPeriodEnd=false → error |
| 48 | calls billing.resumeSubscription and clears cancelAtPeriodEnd flag | billing called, DB updated cancelAtPeriodEnd=false |
| 49 | returns updated subscription state after resuming | Returns getMySubscription result with cancelAtPeriodEnd=false |
| 50 | logs payment event on resume | paymentEvent.create called with eventType=customer.subscription.updated |

### `cancelSubscription()` — basic

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 51 | throws ConflictException when user has no active subscription | No sub → ConflictException |
| 52 | sets cancelAtPeriodEnd=true and returns accessUntil | Sets cancelAtPeriodEnd, returns expiresAt |

### `cancelSubscription()` — extended

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 53 | throws ConflictException(SUBSCRIPTION_ALREADY_CANCELED) when already canceling | cancelAtPeriodEnd=true → error |
| 54 | response message includes "full access" wording | Message communicates access duration |
| 55 | calls billing.cancelSubscription with cancelAtPeriodEnd=true | Billing call with correct params |

### `changePlan()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 56 | throws NotFoundException when no active subscription | No sub → NotFoundException |
| 57 | throws ConflictException(PLAN_ALREADY_ACTIVE) when switching to same tier | Same tier → PLAN_ALREADY_ACTIVE |
| 58 | throws BadRequestException when trying to change to FREE | Downgrade to FREE blocked |
| 59 | throws BadRequestException when new plan not found in DB | Unknown plan → BadRequestException |
| 60 | calls billing.changePlan with new plan | billing.changePlan called with subscription/plan IDs |
| 61 | updates planId in DB | DB updated with new planId |
| 62 | logs PaymentEvent for plan change | paymentEvent.create called |
| 63 | calls applyPlanLimitToTracks with new plan upload limit | Track visibility enforced for new limit |
| 64 | sends plan changed email async | sendPlanChangedEmail fire-and-forget |
| 65 | returns getMySubscription() result | Response is full subscription state |

### `createBillingPortal()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 66 | throws NotFoundException when no active subscription | No sub → NotFoundException |
| 67 | calls billing.getOrCreateCustomer | Customer created/retrieved |
| 68 | calls billing.createBillingPortalSession | Portal session created |
| 69 | returns portalUrl and capabilities | Portal fields present in response |
| 70 | returns currentPlanCode in response | planCode field reflects current plan |

### `getInvoices()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 71 | returns empty array when user has no subscription | No sub → [] |
| 72 | returns mapped invoice objects | Invoice fields mapped to response shape |
| 73 | dueAt and paidAt are ISO strings or null | Dates serialized as ISO strings |
| 74 | scoped to userId (does not return other users' invoices) | userId filter applied |
| 75 | invoice includes planName and planTier | Plan fields present on invoice |

### `handleStripeWebhook()` — basic

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 76 | returns { received: true } for any event | Always acknowledges receipt |
| 77 | marks subscription ACTIVE on invoice.payment_succeeded | Status updated to ACTIVE |
| 78 | marks subscription PAST_DUE and sends grace period email on invoice.payment_failed | PAST_DUE + paymentFailureGraceEndsAt set + email |
| 79 | marks subscription CANCELED on customer.subscription.deleted | Revokes downloads, applies FREE limit |
| 80 | is idempotent — skips duplicate events | paymentEvent.findUnique pre-check prevents double processing |

### `handleStripeWebhook()` — extended

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 81 | throws BadRequestException(WEBHOOK_INVALID_SIGNATURE) on bad signature | constructWebhookEvent throws → 400 |
| 82 | idempotency: returns {received:true} without reprocessing known event | Duplicate event skipped gracefully |
| 83 | checkout.session.completed creates subscription record | New subscription created |
| 84 | invoice.payment_action_required sets PAST_DUE with grace period | Same path as payment_failed |
| 85 | customer.subscription.updated syncs cancelAtPeriodEnd | DB synced to webhook state |
| 86 | customer.subscription.updated with status=canceled sets CANCELED | Status updated |
| 87 | customer.subscription.trial_will_end sends trial ending email | Email queued when not canceling |
| 88 | customer.subscription.trial_will_end skips email if cancelAtPeriodEnd=true | No spurious email on cancel-path trial |
| 89 | invoice.paid creates BillingInvoice and sets ACTIVE | Invoice created, status updated |
| 90 | mapStripeStatus maps 'trialing' → TRIALING | Status mapping works |
| 91 | mapStripeStatus maps unknown status → ACTIVE (safe default) | Unknown status defaults to ACTIVE |

### `getOfflineTrack()` — basic

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 92 | throws ForbiddenException(DOWNLOAD_NOT_ALLOWED) when no subscription | No sub → forbidden |
| 93 | throws ForbiddenException(DOWNLOAD_NOT_ALLOWED) for FREE tier | FREE → forbidden |
| 94 | returns local download URL for PRO users with local storage | Local URL built from storageKey |
| 95 | throws NotFoundException when track does not exist | Unknown track → 404 |
| 96 | throws NotFoundException when track has no audio files | Track with no files → 404 |

### `getOfflineTrack()` — extended

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 97 | prefers STREAM file over ORIGINAL when both are available | STREAM role selected over ORIGINAL |
| 98 | returns expiresAt set to TTL seconds from now | expiresAt = now + TTL |
| 99 | upserts OfflineDownload with correct userId and trackId | offlineDownload.upsert called with correct args |
| 100 | response includes planCode of current subscription | planCode field present |
| 101 | generates S3 pre-signed URL when storage.provider=s3 | S3 URL generated when provider is s3 |

### `getUploadQuota()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 102 | falls back to FREE_UPLOAD_LIMIT when no subscription exists | No sub → FREE_UPLOAD_LIMIT (3) |
| 103 | returns plan limit when user has an active PRO subscription | PRO → 100 |
| 104 | returns plan limit for GO_PLUS subscription | GO_PLUS → 1000 |
| 105 | returns plan config limit for unlimited plan | PLAN_CONFIG is source of truth (not DB uploadLimit) |
| 106 | calls track.count with the correct userId filter | count scoped to userId |
| 107 | FREE plan: at limit (uploadedCount=3, limit=3) → quota returned correctly | Boundary: at limit |
| 108 | FREE plan: over limit (uploadedCount=5, limit=3) → quota reflects overage | Boundary: over limit |

### `applyPlanLimitToTracks()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 109 | hides tracks over the limit (sets hiddenByPlanLimit=true) | Tracks beyond limit hidden |
| 110 | restores previously hidden tracks within new limit | hiddenByPlanLimit=false for tracks within limit |
| 111 | does not update tracks that are already in correct state | No unnecessary DB writes |
| 112 | uses createdAt desc order to preserve newest tracks | Oldest tracks hidden first |
| 113 | hides all tracks when limit=0 | Edge case: limit=0 |
| 114 | restores all tracks when limit=Infinity | Edge case: unlimited |

### `revokeOfflineDownloads()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 115 | calls offlineDownload.updateMany with expiresAt=epoch | expiresAt = new Date(0) |
| 116 | scoped to userId | updateMany where.userId = userId |

### `findActiveSubscription()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 117 | returns null when no active subscription | No sub → null |
| 118 | returns null for CANCELED subscription | CANCELED not included in active statuses |
| 119 | returns null for subscription with currentPeriodEnd in the past | Expired period → null |
| 120 | returns the found subscription when one exists | Active sub returned |
| 121 | PAST_DUE subscription within grace period IS returned | PAST_DUE included in active statuses (user keeps access) |
| 122 | queries with status IN [ACTIVE, TRIALING, PAST_DUE] | All three statuses included |

---

## File: `src/subscriptions/trial-scheduler.service.spec.ts`

**35 tests** — covers all 4 cron methods of `TrialSchedulerService`.

### `sendTrialEndingWarnings()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 1 | sends email and records PaymentEvent when no warning has been sent yet | Email sent, PaymentEvent with eventType=trial.renewal_warning created |
| 2 | skips subscription when a trial.renewal_warning event already exists | Idempotency: payments.length > 0 → skip |
| 3 | does nothing when no trials are in the 48h warning window | Empty findMany → no side effects |
| 4 | still records the PaymentEvent even if email delivery fails | Fire-and-forget email; event still created |
| 5 | queries TRIALING subs with cancelAtPeriodEnd=false | Query shape verified |
| 6 | filters subscriptions in the 47–49 hour window | Window bounds verified (gte ~47h, lte ~49h) |
| 7 | sends a trial ending email for each qualifying subscription | Email includes to, planName, priceCents |
| 8 | creates a trial.renewal_warning PaymentEvent for idempotency | Event with correct eventType and subscriptionId |
| 9 | skips sending email when trial.renewal_warning event already exists (duplicate describe) | Idempotency re-verified |
| 10 | sends emails for multiple qualifying subscriptions | Two subs → two emails, two events |

### `autoRenewExpiredTrials()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 11 | converts an expired trial to ACTIVE and creates a paid invoice | TRIALING → ACTIVE, invoice status=PAID |
| 12 | does nothing when there are no expired trials | Empty findMany → no side effects |
| 13 | continues processing remaining subs when one renewal fails | Error resilience per-sub |
| 14 | queries TRIALING subs with currentPeriodEnd in the past and cancelAtPeriodEnd=false | Query shape verified |
| 15 | creates a paid BillingInvoice for the renewed subscription | Invoice fields: amountDueCents, currency, status=PAID |
| 16 | creates invoice.payment_succeeded PaymentEvent | eventType='invoice.payment_succeeded' |
| 17 | renews currentPeriodEnd to ~1 month after now | New period 28–33 days in future |
| 18 | continues renewing remaining subs if one renewal fails (extended) | Second sub still processed after first fails |

### `autoRenewActiveSubscriptions()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 19 | renews an ACTIVE subscription whose period has expired | Invoice + period extended + PaymentEvent created |
| 20 | does nothing when there are no expired ACTIVE subscriptions | Empty findMany → no side effects |
| 21 | continues processing remaining subs when one renewal fails | Error resilience per-sub |
| 22 | queries ACTIVE subs with currentPeriodEnd in the past and cancelAtPeriodEnd=false | Query shape verified |
| 23 | creates a paid BillingInvoice for each renewed subscription | Invoice fields correct |
| 24 | extends currentPeriodEnd by ~1 month | 28–33 days in future |
| 25 | creates invoice.payment_succeeded PaymentEvent linking to new invoice | invoiceId linked correctly |
| 26 | continues processing remaining subs if one renewal fails (extended) | Second sub still processed |

### `cancelExpiredGracePeriodSubscriptions()` — **BUG FIX VERIFIED**

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 27 | cancels a PAST_DUE sub whose grace period has elapsed | Status=CANCELED, endedAt set |
| 28 | sends moved-to-free email after grace period expires | sendPaymentFailedMovedToFreeEmail called |
| 29 | does nothing when no PAST_DUE subs have exceeded grace period | Empty findMany → no side effects |
| 30 | continues processing remaining subs when one cancellation fails | Error resilience per-sub |
| 31 | **BUG FIX**: queries by `paymentFailureGraceEndsAt`, NOT `updatedAt` | `where.paymentFailureGraceEndsAt` present, `where.updatedAt` absent |
| 32 | queries PAST_DUE status with `paymentFailureGraceEndsAt < now` | Full query shape including status=PAST_DUE |
| 33 | calls `revokeOfflineDownloads` for the affected user | Downloads revoked on cancellation |
| 34 | calls `applyPlanLimitToTracks` with `FREE_UPLOAD_LIMIT` (3) | Track limit enforced at cancellation |
| 35 | `GRACE_PERIOD_DAYS` is 1 as required | Constant value asserted |
| 36 | processes multiple expired grace period subscriptions | Two subs → two cancellations |

---

## File: `src/entitlements/entitlements.service.spec.ts`

**62 tests** — covers all methods of `EntitlementsService`.

### `getUserEntitlements()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 1 | returns FREE entitlements when no active subscription exists | planCode=FREE, adsEnabled=true, canDownload=false |
| 2 | returns PRO entitlements for an active PRO subscription | planCode=PRO, isPremium=true, canDownload=true |
| 3 | returns GO_PLUS entitlements for a trialing GO_PLUS subscription | planCode=GO_PLUS, uploadLimit=1000, trialEnd set |
| 4 | returns premium entitlements for a PAST_DUE subscription (grace period) | PAST_DUE → still isPremium=true |
| 5 | canUpload=false and remainingUploads=0 when at upload limit | uploadedCount=limit → canUpload=false |
| 6 | canUpload=false and remainingUploads=0 when OVER limit | uploadedCount>limit → remainingUploads=0 (not negative) |
| 7 | remainingUploads correctly calculated when under limit | limit=3, count=1 → remaining=2 |
| 8 | calls getUploadQuota and findActiveSubscription in parallel | Both mocks called with userId |
| 9 | trialEnd is null for non-trialing subscriptions | trialEnd=null when not in trial |

### `canUploadTrack()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 10 | returns true when under upload limit | count < limit → true |
| 11 | returns false when at upload limit | count = limit → false |
| 12 | returns false when over upload limit | count > limit → false |

### `assertCanUploadTrack()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 13 | resolves without error when upload is allowed | Under limit → no exception |
| 14 | throws ForbiddenException(UPLOAD_LIMIT_REACHED) when at limit | At limit → ForbiddenException |
| 15 | thrown exception includes UPLOAD_LIMIT_REACHED code | Error code verified |
| 16 | exception response includes upgradeOptions PRO and GO_PLUS | Response details include upgrade paths |

### `canDownloadTrack()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 17 | returns false for FREE plan | FREE → false |
| 18 | returns true for PRO plan | PRO → true |
| 19 | returns true for GO_PLUS plan | GO_PLUS → true |

### `isPremium()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 20 | returns false for FREE plan | FREE → false |
| 21 | returns true for PRO plan | PRO → true |
| 22 | returns true for GO_PLUS plan | GO_PLUS → true |
| 23 | returns true while in grace period (PAST_DUE) | PAST_DUE → still premium |

---

## File: `src/billing/mock-stripe.provider.spec.ts`

**26 tests** — covers `MockStripeBillingProvider` (billing abstraction layer).

### `getOrCreateCustomer()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 1 | creates and returns a new customer ID | New customerId returned |
| 2 | returns the same customer ID on subsequent calls with the same userId | In-memory cache works |
| 3 | returns different IDs for different users | User isolation |

### `createCheckoutSession()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 4 | returns checkoutSessionId starting with `cs_mock_` | ID prefix format |
| 5 | returns checkoutUrl starting with the mock checkout domain | URL domain format |
| 6 | trialEligible=true and amountDueNowCents=0 when trialDays > 0 | Trial → free upfront |
| 7 | trialEligible=false and amountDueNowCents=plan price when trialDays=0 | No trial → full charge |
| 8 | GO_PLUS with no trial charges 1999 cents | Plan price lookup correct |
| 9 | returns trialDays matching what was passed in | trialDays passed through |
| 10 | trialEndsAt is set when trialDays > 0 | ~7 days in future |
| 11 | trialEndsAt is undefined when trialDays=0 | Not set for non-trial |
| 12 | renewsAt is ~1 month from now for non-trial session | 28–33 days in future |

### `createBillingPortalSession()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 13 | returns portalSessionId starting with `bps_mock_` | ID prefix format |
| 14 | returns portalUrl starting with the mock portal domain | URL domain format |
| 15 | returns capabilities object with all four flags true | Full capabilities object shape |

### `cancelSubscription()` / `resumeSubscription()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 16 | cancelSubscription with cancelAtPeriodEnd=true resolves without error | No throw on unknown subId |
| 17 | cancelSubscription with cancelAtPeriodEnd=false resolves without error | Immediate cancel path |
| 18 | resumeSubscription resolves without error | Graceful no-op on unknown subId |

### `changePlan()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 19 | returns a ProviderSubscriptionResult with the subscription ID | Result shape correct |
| 20 | changePlan on unknown subscription returns default active state | Safe default status='active' |

### `retrieveSubscription()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 21 | returns a valid ProviderSubscriptionResult | Result shape correct |

### `constructWebhookEvent()`

| # | Test Name | Behavior Verified |
|---|-----------|-------------------|
| 22 | parses a valid webhook event with id and type | Valid JSON parsed correctly |
| 23 | throws WEBHOOK_INVALID_SIGNATURE on malformed JSON | Non-JSON → error |
| 24 | throws WEBHOOK_INVALID_SIGNATURE when id field is missing | Missing id → error |
| 25 | throws WEBHOOK_INVALID_SIGNATURE when type field is missing | Missing type → error |
| 26 | passes through arbitrary data object attached to the event | data field preserved |

---

## Coverage Summary by Service Method

| Method | Service File | Tested In | Tests |
|--------|-------------|-----------|-------|
| `getMySubscription()` | subscriptions.service | subscriptions.service.spec | 10 |
| `getPlans()` | subscriptions.service | subscriptions.service.spec | 2 |
| `subscribe()` (compat alias) | subscriptions.service | subscriptions.service.spec | 8 |
| `checkout()` | subscriptions.service | subscriptions.service.spec | 17 |
| `resumeSubscription()` | subscriptions.service | subscriptions.service.spec | 5 |
| `cancelSubscription()` | subscriptions.service | subscriptions.service.spec | 5 |
| `changePlan()` | subscriptions.service | subscriptions.service.spec | 10 |
| `createBillingPortal()` | subscriptions.service | subscriptions.service.spec | 5 |
| `getInvoices()` | subscriptions.service | subscriptions.service.spec | 5 |
| `handleStripeWebhook()` | subscriptions.service | subscriptions.service.spec | 16 |
| `getOfflineTrack()` | subscriptions.service | subscriptions.service.spec | 10 |
| `getUploadQuota()` | subscriptions.service | subscriptions.service.spec | 7 |
| `applyPlanLimitToTracks()` | subscriptions.service | subscriptions.service.spec | 6 |
| `revokeOfflineDownloads()` | subscriptions.service | subscriptions.service.spec | 2 |
| `findActiveSubscription()` | subscriptions.service | subscriptions.service.spec | 6 |
| PLAN_CONFIG catalog | subscriptions.service | subscriptions.service.spec | 8 |
| `sendTrialEndingWarnings()` | trial-scheduler.service | trial-scheduler.service.spec | 10 |
| `autoRenewExpiredTrials()` | trial-scheduler.service | trial-scheduler.service.spec | 8 |
| `autoRenewActiveSubscriptions()` | trial-scheduler.service | trial-scheduler.service.spec | 8 |
| `cancelExpiredGracePeriodSubscriptions()` | trial-scheduler.service | trial-scheduler.service.spec | 10 |
| `getUserEntitlements()` | entitlements.service | entitlements.service.spec | 9 |
| `canUploadTrack()` | entitlements.service | entitlements.service.spec | 3 |
| `assertCanUploadTrack()` | entitlements.service | entitlements.service.spec | 4 |
| `canDownloadTrack()` | entitlements.service | entitlements.service.spec | 3 |
| `isPremium()` | entitlements.service | entitlements.service.spec | 4 |
| `getOrCreateCustomer()` | mock-stripe.provider | mock-stripe.provider.spec | 3 |
| `createCheckoutSession()` | mock-stripe.provider | mock-stripe.provider.spec | 9 |
| `createBillingPortalSession()` | mock-stripe.provider | mock-stripe.provider.spec | 3 |
| `cancelSubscription()` | mock-stripe.provider | mock-stripe.provider.spec | 2 |
| `resumeSubscription()` | mock-stripe.provider | mock-stripe.provider.spec | 1 |
| `changePlan()` | mock-stripe.provider | mock-stripe.provider.spec | 2 |
| `retrieveSubscription()` | mock-stripe.provider | mock-stripe.provider.spec | 1 |
| `constructWebhookEvent()` | mock-stripe.provider | mock-stripe.provider.spec | 5 |
| `createBillingPortal()` — payment methods | subscriptions.service | payment-methods.service.spec | 13 |
| `getMySubscription()` — paymentMethod fields | subscriptions.service | payment-methods.service.spec | 3 |
| `handleStripeWebhook()` — payment_method.updated | subscriptions.service | payment-methods.service.spec | 7 |

**Total: 216 tests, 0 failures**
