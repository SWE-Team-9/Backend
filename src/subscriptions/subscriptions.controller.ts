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
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
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
  @ApiOperation({ summary: "Get offline download URL (PRO / GO+ only)" })
  @ApiParam({ name: "trackId", description: "UUID of the track" })
  @ApiResponse({ status: 200, description: "Download URL returned." })
  @ApiResponse({
    status: 403,
    description: "DOWNLOAD_NOT_ALLOWED - requires PRO or GO+.",
  })
  @ApiResponse({ status: 404, description: "Track not found." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("offline/:trackId")
  async getOfflineTrack(
    @CurrentUser("userId") userId: string,
    @Param("trackId", ParseUUIDPipe) trackId: string,
  ) {
    return this.subscriptionsService.getOfflineTrack(userId, trackId);
  }

  // ─── POST /subscriptions/checkout ─────────────────────────────────────────
  @ApiOperation({
    summary: "Create a checkout session to subscribe to PRO or GO+",
    description:
      "Canonical Module-12 checkout endpoint. Enforces trial eligibility via TrialRedemption. " +
      "Returns a checkoutUrl to redirect the user to (mock in dev; real Stripe URL in prod).",
  })
  @ApiBody({ type: CheckoutDto })
  @ApiResponse({ status: 200, description: "Checkout session created." })
  @ApiResponse({
    status: 400,
    description: "Invalid plan or already subscribed.",
  })
  @ApiResponse({ status: 403, description: "EMAIL_NOT_VERIFIED." })
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
    summary: "Open billing portal / payment method management",
    description:
      "Creates a Stripe Customer Portal session. The user is redirected to a secure, " +
      "hosted page where they can add, update, or remove payment methods, view invoices, " +
      "cancel, or change plans. The response includes a safe payment method summary for " +
      "display on the settings page (brand, last4, expiry - never full card data). " +
      'Pass flow="payment_methods" to open the payment-methods screen directly.',
  })
  @ApiBody({ type: PaymentMethodPortalDto, required: false })
  @ApiQuery({
    name: "returnUrl",
    required: false,
    description: "Backward-compat: returnUrl as query param",
  })
  @ApiResponse({
    status: 200,
    description: "Portal session created.",
    schema: {
      example: {
        portalSessionId: "bps_mock_abc123",
        portalUrl:
          "https://mock-portal.example.com/billing?session=bps_mock_abc123",
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
    summary: "Stripe webhook receiver",
    description:
      "Receives Stripe webhook events. The raw request body is used for signature " +
      "verification (configured in main.ts). This endpoint is public.",
  })
  @ApiResponse({ status: 200, schema: { example: { received: true } } })
  @ApiResponse({ status: 400, description: "Invalid signature or payload." })
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
