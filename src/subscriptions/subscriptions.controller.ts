import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CancelSubscriptionDto } from "./dto/cancel-subscription.dto";
import { SubscribeDto } from "./dto/subscribe.dto";
import { CheckoutDto } from "./dto/checkout.dto";
import { ChangePlanDto } from "./dto/change-plan.dto";
import { PaymentMethodPortalDto } from "./dto/payment-method-portal.dto";
import { SubscriptionsService } from "./subscriptions.service";

@ApiTags("Subscriptions")
@ApiBearerAuth()
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // ─── GET /subscriptions/me ─────────────────────────────────────────────────
  @ApiOperation({ summary: "Get current subscription status" })
  @ApiResponse({ status: 200, description: "Subscription status returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("me")
  async getMySubscription(@CurrentUser("userId") userId: string) {
    return this.subscriptionsService.getMySubscription(userId);
  }

  // ─── GET /subscriptions/plans (public) ────────────────────────────────────
  @ApiOperation({ summary: "List all available subscription plans" })
  @ApiResponse({ status: 200, description: "List of active plans." })
  @Public()
  @Get("plans")
  async getPlans() {
    return this.subscriptionsService.getPlans();
  }

  // ─── GET /subscriptions/invoices ──────────────────────────────────────────
  @ApiOperation({ summary: "List billing invoices for the current user" })
  @ApiResponse({ status: 200, description: "Invoice list returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("invoices")
  async getInvoices(@CurrentUser("userId") userId: string) {
    return this.subscriptionsService.getInvoices(userId);
  }

  // ─── GET /subscriptions/offline/:trackId ──────────────────────────────────
  @ApiOperation({
    summary:
      "[STEP 1] Check offline entitlement & get track metadata (PRO / GO+ only)",
    description:
      "**Offline Listening — Step 1 of 2**\n\n" +
      "Call this first to:\n" +
      "- Verify the user has an active PRO or GO+ subscription (returns 403 if not)\n" +
      "- Get the track title, artist, duration and cover art for display in the offline library\n\n" +
      "After a successful response, proceed to **Step 2**: " +
      "`GET /subscriptions/offline/{trackId}/stream` to download the audio bytes.\n\n" +
      "**Authentication:** Requires a valid session cookie (`withCredentials: true` / `Cookie` header).\n\n" +
      "**Error codes:**\n" +
      "- `DOWNLOAD_NOT_ALLOWED` (403) — user is on the FREE plan\n" +
      "- `404` — track does not exist or is not published",
  })
  @ApiParam({
    name: "trackId",
    description: "UUID of the track to save for offline",
    example: "6df98111-74b9-4fef-b284-2dc5040701d9",
  })
  @ApiResponse({
    status: 200,
    description:
      "Entitlement confirmed. Returns track metadata. " +
      "Use `trackId`, `title`, `artist`, `durationMs` and `coverArtUrl` " +
      "to populate the offline library UI. " +
      "Then call `/offline/{trackId}/stream` to download the audio.",
    schema: {
      example: {
        trackId: "6df98111-74b9-4fef-b284-2dc5040701d9",
        title: "Midnight Drive",
        artist: "DJ Nova",
        handle: "djnova",
        durationMs: 214000,
        coverArtUrl:
          "https://iqa3-media-storage.s3.eu-north-1.amazonaws.com/covers/abc.jpg",
        downloadUrl:
          "(signed S3 URL — do not use directly; call /stream instead)",
        expiresAt: "2026-04-28T14:00:00.000Z",
        expiresInSeconds: 900,
        planCode: "PRO",
      },
    },
  })
  @ApiResponse({
    status: 403,
    description:
      "`DOWNLOAD_NOT_ALLOWED` — User is on the FREE plan. " +
      "Show an upgrade prompt directing the user to `/subscriptions/checkout`.",
    schema: {
      example: {
        statusCode: 403,
        code: "DOWNLOAD_NOT_ALLOWED",
        message: "Offline listening is available on PRO and GO+.",
        details: { currentPlan: "FREE", upgradeOptions: ["PRO", "GO_PLUS"] },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Track not found or not yet published.",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated — missing or expired session cookie.",
  })
  @Get("offline/:trackId")
  async getOfflineTrack(
    @CurrentUser("userId") userId: string,
    @Param("trackId", ParseUUIDPipe) trackId: string,
  ) {
    return this.subscriptionsService.getOfflineTrack(userId, trackId);
  }

  // ─── GET /subscriptions/offline/:trackId/stream ───────────────────────────
  @ApiOperation({
    summary:
      "[STEP 2] Download audio bytes for offline caching (PRO / GO+ only)",
    description:
      "**Offline Listening — Step 2 of 2**\n\n" +
      "Downloads the raw audio bytes for a track and returns them as `audio/mpeg`. " +
      "The server fetches the file from S3 internally — " +
      "**the client never needs S3 credentials or a presigned URL**.\n\n" +
      "**How to use:**\n" +
      "1. Call `GET /subscriptions/offline/{trackId}` first (Step 1) to verify entitlement\n" +
      "2. Call this endpoint to download the bytes\n" +
      "3. Store the bytes in **app-private storage** (IndexedDB on web, app cache dir on mobile)\n" +
      "4. When playing offline, load the audio from the private cache — " +
      "do NOT save to the public Downloads folder\n\n" +
      "**Web (Next.js):** `fetch(url, { credentials: 'include' })` → store Blob in IndexedDB\n\n" +
      "**Flutter:** Use `flutter_cache_manager` with `authHeaders: { 'Cookie': sessionCookie }` " +
      "→ `AudioSource.file(cachedFile.path)` for playback\n\n" +
      "**Authentication:** Session cookie required (`withCredentials: true` / `Cookie` header). " +
      "The cookie is set automatically by login — no manual token handling needed.\n\n" +
      "**Error codes:**\n" +
      "- `DOWNLOAD_NOT_ALLOWED` (403) — subscription lapsed since Step 1\n" +
      "- `404` — track not found",
  })
  @ApiParam({
    name: "trackId",
    description: "UUID of the track (same value used in Step 1)",
    example: "6df98111-74b9-4fef-b284-2dc5040701d9",
  })
  @ApiHeader({
    name: "Cookie",
    description:
      "Session cookie set automatically by the login endpoint. " +
      "Web: handled by the browser when `credentials: 'include'` is set. " +
      "Flutter: extract from the DioClient CookieJar and pass as `Cookie: <value>`.",
    required: true,
  })
  @ApiProduces("audio/mpeg")
  @ApiResponse({
    status: 200,
    description:
      "Raw audio bytes (`audio/mpeg`). " +
      "Response headers: `Content-Type: audio/mpeg`, `Content-Disposition: inline`, " +
      "`Content-Length: <bytes>`, `Cache-Control: private, max-age=900`. " +
      "Read the response body as a Blob (web) or stream it to a file (mobile) " +
      "and store in app-private cache for offline playback.",
  })
  @ApiResponse({
    status: 403,
    description:
      "`DOWNLOAD_NOT_ALLOWED` — Subscription is no longer active. " +
      "Re-check entitlement and prompt the user to renew.",
  })
  @ApiResponse({
    status: 404,
    description: "Track not found or not yet published.",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated — missing or expired session cookie.",
  })
  @Get("offline/:trackId/stream")
  async streamOfflineTrack(
    @CurrentUser("userId") userId: string,
    @Param("trackId", ParseUUIDPipe) trackId: string,
    @Res() res: Response,
  ) {
    return this.subscriptionsService.streamOfflineTrack(userId, trackId, res);
  }

  // ─── POST /subscriptions/checkout ─────────────────────────────────────────
  @ApiOperation({
    summary: "Create a checkout session to subscribe to PRO or GO+",
    description:
      "**Module-12 canonical checkout endpoint.**\n\n" +
      "Behavior depends on the active billing provider:\n\n" +
      "**Mock mode** (`BILLING_PROVIDER=mock_stripe`, default):\n" +
      "- Subscription is activated immediately in the DB\n" +
      "- Returns `{ status: 'active', checkoutUrl: 'https://mock-checkout...' }`\n" +
      "- No real payment is taken — use this for development/testing\n\n" +
      "**Real Stripe mode** (`BILLING_PROVIDER=stripe`):\n" +
      "- Creates a Stripe Hosted Checkout Session\n" +
      "- Returns `{ checkoutUrl: 'https://checkout.stripe.com/...' }`\n" +
      "- **Frontend must redirect the user to `checkoutUrl`** — Stripe collects card details\n" +
      "- On success, Stripe redirects to `/subscriptions/success?session_id=...`\n" +
      "- On cancel, Stripe redirects to `/subscriptions/cancel`\n" +
      "- Subscription is activated asynchronously via the `POST /webhook` event `checkout.session.completed`\n\n" +
      "**Trial logic:**\n" +
      "- First-time PRO subscribers get a 7-day free trial\n" +
      "- First-time GO+ subscribers get a 30-day free trial\n" +
      "- Trial eligibility is tracked per-user in `TrialRedemption` to prevent abuse\n\n" +
      "**Downgrade detection:**\n" +
      "- If requesting a lower tier than the current plan, the downgrade is scheduled\n" +
      "  at the end of the current billing period (user keeps current benefits until then)\n\n" +
      "**Pre-requisites for real Stripe:**\n" +
      "- Each `SubscriptionPlan` row in the DB must have `stripePriceId` set\n" +
      "- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` must be configured in `.env`",
  })
  @ApiBody({ type: CheckoutDto })
  @ApiResponse({
    status: 200,
    description: "Checkout session created.",
    schema: {
      examples: {
        mock: {
          summary: "Mock mode response (subscription activated immediately)",
          value: {
            subscriptionId: "sub_uuid",
            status: "active",
            planCode: "PRO",
            trialEligible: false,
            amountPaidCents: 999,
            currentPeriodEnd: "2026-05-28T00:00:00.000Z",
            checkoutUrl:
              "https://mock-checkout.example.com/pay?session=cs_mock_...",
          },
        },
        stripe: {
          summary:
            "Real Stripe response (frontend must redirect to checkoutUrl)",
          value: {
            checkoutSessionId: "cs_test_a1B2c3D4",
            checkoutUrl: "https://checkout.stripe.com/pay/cs_test_a1B2c3D4",
            planCode: "PRO",
            trialEligible: true,
            trialDays: 7,
            amountDueNowCents: 0,
            renewsAt: "2026-05-05T00:00:00.000Z",
            trialEndsAt: "2026-05-05T00:00:00.000Z",
          },
        },
        downgrade: {
          summary: "Downgrade scheduled (no redirect needed)",
          value: {
            scheduled: true,
            effectiveAt: "2026-05-28T00:00:00.000Z",
            currentPlan: "GO_PLUS",
            newPlan: "PRO",
            message:
              "Your plan will downgrade from GO+ to Artist Pro on 2026-05-28.",
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Invalid plan code, or `SUBSCRIPTION_ALREADY_ACTIVE` (already on that plan).",
  })
  @ApiResponse({
    status: 403,
    description: "`EMAIL_NOT_VERIFIED` — email address not confirmed.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("checkout")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async checkout(
    @CurrentUser("userId") userId: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.subscriptionsService.checkout(userId, dto);
  }

  // ─── POST /subscriptions/subscribe (backward-compat alias) ────────────────
  @ApiOperation({
    summary: "Subscribe to PRO or GO_PLUS (legacy alias for /checkout)",
    description:
      "Kept for backward compatibility. Delegates to the checkout flow.",
  })
  @ApiBody({ type: SubscribeDto })
  @ApiResponse({ status: 200, description: "Subscription activated." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("subscribe")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async subscribe(
    @CurrentUser("userId") userId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.subscriptionsService.subscribe(userId, dto);
  }

  // ─── POST /subscriptions/portal ───────────────────────────────────────────
  @ApiOperation({
    summary: "Create a Stripe Customer Portal session for billing management",
    description:
      "Returns a `portalUrl` that the user should be redirected to.\n\n" +
      "**On the portal, the user can:**\n" +
      "- Add, update, or remove payment methods (card, bank, etc.)\n" +
      "- View and download past invoices\n" +
      "- Cancel or change their subscription plan\n\n" +
      "**Mock mode:** Returns a mock portal URL (no real Stripe redirect).\n\n" +
      "**Real Stripe mode:** Returns a `https://billing.stripe.com/...` URL. " +
      "After the user finishes, they are redirected to the `returnUrl` (defaults to `/settings`).\n\n" +
      "The response also includes a safe `paymentMethodSummary` (brand, last4, expiry — never full card data) " +
      "suitable for displaying the saved card on the settings page without an extra API call.\n\n" +
      'Pass `flow: "payment_methods"` in the body to open the payment-methods screen directly.',
  })
  @ApiBody({ type: PaymentMethodPortalDto, required: false })
  @ApiQuery({
    name: "returnUrl",
    required: false,
    description:
      "Where to send the user after they close the portal (backward-compat query param).",
  })
  @ApiResponse({
    status: 200,
    description: "Portal session created. Redirect the user to `portalUrl`.",
    schema: {
      example: {
        portalSessionId: "bps_test_a1B2c3",
        portalUrl: "https://billing.stripe.com/session/bps_test_a1B2c3",
        capabilities: {
          canUpdatePaymentMethod: true,
          canCancel: true,
          canChangePlan: true,
          canViewReceipts: true,
          canViewPaymentMethods: true,
          canAddPaymentMethod: true,
          canRemovePaymentMethod: true,
          canSetDefaultPaymentMethod: true,
        },
        currentPlanCode: "PRO",
        paymentMethodSummary: {
          brand: "visa",
          last4: "4242",
          expiryMonth: 12,
          expiryYear: 2030,
          isDefault: true,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("portal")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createBillingPortal(
    @CurrentUser("userId") userId: string,
    @Body() dto?: PaymentMethodPortalDto,
    @Query("returnUrl") queryReturnUrl?: string,
  ) {
    // Merge query-param returnUrl (backward compat) with body dto
    const merged: PaymentMethodPortalDto = {
      returnUrl: dto?.returnUrl ?? queryReturnUrl,
      flow: dto?.flow,
    };
    return this.subscriptionsService.createBillingPortal(userId, merged);
  }

  // ─── POST /subscriptions/resume ───────────────────────────────────────────
  @ApiOperation({
    summary: "Resume a subscription that is scheduled to cancel",
    description:
      "Lifts the cancel_at_period_end flag. Requires an active subscription.",
  })
  @ApiResponse({ status: 200, description: "Subscription resumed." })
  @ApiResponse({ status: 404, description: "No active subscription found." })
  @ApiResponse({
    status: 409,
    description: "Subscription is not scheduled to cancel.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("resume")
  @HttpCode(HttpStatus.OK)
  async resumeSubscription(@CurrentUser("userId") userId: string) {
    return this.subscriptionsService.resumeSubscription(userId);
  }

  // ─── POST /subscriptions/change-plan ──────────────────────────────────────
  @ApiOperation({
    summary: "Change the active subscription plan",
    description:
      "Switches between PRO and GO+. To downgrade to FREE, cancel instead.",
  })
  @ApiBody({ type: ChangePlanDto })
  @ApiResponse({ status: 200, description: "Plan changed." })
  @ApiResponse({ status: 400, description: "Invalid plan change." })
  @ApiResponse({ status: 404, description: "No active subscription." })
  @ApiResponse({ status: 409, description: "Already on that plan." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("change-plan")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async changePlan(
    @CurrentUser("userId") userId: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptionsService.changePlan(userId, dto);
  }

  // ─── POST /subscriptions/cancel ───────────────────────────────────────────
  @ApiOperation({ summary: "Cancel subscription at period end" })
  @ApiBody({ type: CancelSubscriptionDto })
  @ApiResponse({ status: 200, description: "Cancellation scheduled." })
  @ApiResponse({
    status: 409,
    description: "No active subscription or already cancelled.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async cancelSubscription(
    @CurrentUser("userId") userId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionsService.cancelSubscription(userId, dto);
  }

  // ─── POST /subscriptions/webhook (public - Stripe calls this) ─────────────
  @ApiOperation({
    summary: "Stripe webhook receiver — do NOT call this manually",
    description:
      "**This endpoint is called by Stripe, not by your frontend/mobile app.**\n\n" +
      "Stripe sends signed HMAC events here after payment events occur. " +
      "The raw request body is used for signature verification before any processing.\n\n" +
      "**How to set up (real Stripe only):**\n" +
      "1. Stripe Dashboard → Developers → Webhooks → Add endpoint\n" +
      "2. URL: `https://your-domain.com/api/v1/subscriptions/webhook`\n" +
      "3. Select events:\n" +
      "   - `checkout.session.completed` — activates subscription after payment\n" +
      "   - `invoice.paid` / `invoice.payment_succeeded` — renews subscription\n" +
      "   - `invoice.payment_failed` — starts grace period, sends payment failure email\n" +
      "   - `customer.subscription.deleted` — cancels subscription\n" +
      "4. Copy the webhook signing secret → set as `STRIPE_WEBHOOK_SECRET` in `.env`\n\n" +
      "**Local testing with Stripe CLI:**\n" +
      "```\nstripe listen --forward-to localhost:3006/api/v1/subscriptions/webhook\n```\n\n" +
      "**Idempotent:** duplicate events are detected via `stripeEventId` and skipped.\n\n" +
      "**Mock mode:** The mock provider bypasses signature verification — " +
      "you can POST any JSON `{ id, type, data: { object: {} } }` to test the handler locally.",
  })
  @ApiHeader({
    name: "stripe-signature",
    description:
      "HMAC signature added by Stripe. Required for real Stripe events. " +
      "Not required when using MockStripeBillingProvider (mock mode ignores it).",
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: "Event received and processed.",
    schema: { example: { received: true } },
  })
  @ApiResponse({
    status: 400,
    description:
      "`WEBHOOK_INVALID_SIGNATURE` — signature mismatch. " +
      "Check that `STRIPE_WEBHOOK_SECRET` matches the webhook in Stripe Dashboard.",
  })
  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Req() req: Request,
    @Headers("stripe-signature") signature: string,
  ) {
    const rawBody: Buffer =
      (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
    return this.subscriptionsService.handleStripeWebhook(
      rawBody,
      signature ?? "",
    );
  }
}
