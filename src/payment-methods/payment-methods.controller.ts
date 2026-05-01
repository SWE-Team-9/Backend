import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PaymentMethodsService } from "./payment-methods.service";
import { AttachPaymentMethodDto } from "./dto/attach-payment-method.dto";

@ApiTags("Payment Methods")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("payment-methods")
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post("setup-intent")
  @HttpCode(200)
  @ApiOperation({
    summary: "Step 1 of adding a card — create a Stripe SetupIntent",
    description:
      "Returns a Stripe `clientSecret` that the frontend passes to `stripe.confirmCardSetup()` " +
      "(Stripe.js). The user's card number is collected directly by Stripe and never " +
      "passes through this server.\n\n" +
      "**Full card-add flow:**\n" +
      "1. Call `POST /payment-methods/setup-intent` → get `clientSecret`\n" +
      "2. Mount a Stripe Elements card form; call `stripe.confirmCardSetup(clientSecret)`\n" +
      "3. On success Stripe returns `setupIntent.payment_method` or a `pm_xxx` ID\n" +
      "4. Call `POST /payment-methods/attach` with that ID to persist the card metadata",
  })
  @ApiResponse({
    status: 200,
    description: "SetupIntent created",
    schema: {
      example: { clientSecret: "seti_xxx_secret_yyy" },
    },
  })
  @ApiResponse({ status: 400, description: "Failed to create Setup Intent" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async createSetupIntent(
    @CurrentUser() user: { id: string },
  ): Promise<{ clientSecret: string }> {
    return this.service.createSetupIntent(user.id);
  }

  @Post("attach")
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: "Step 2 of adding a card — attach a confirmed payment method",
    description:
      "Attaches a Stripe `pm_xxx` payment method returned by Stripe.js confirmation " +
      "to the user's Stripe customer and persists display metadata only: brand, last4, and expiry.\n\n" +
      "**Auto-default rule:** the very first card added is always made the default. " +
      "For subsequent cards pass `setAsDefault: true` to override.\n\n" +
      "Returns the saved card object, same shape as `GET /payment-methods` entries.",
  })
  @ApiResponse({
    status: 200,
    description: "Payment method saved",
    schema: {
      example: {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2028,
        cardholderName: "Jane Doe",
        isDefault: true,
        createdAt: "2026-04-28T10:00:00.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Only card payment methods are supported or payment method belongs to another customer",
  })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({
    status: 409,
    description: "This payment method is already saved",
  })
  @ApiBody({ type: AttachPaymentMethodDto })
  async attachPaymentMethod(
    @CurrentUser() user: { id: string },
    @Body() dto: AttachPaymentMethodDto,
  ): Promise<object> {
    return this.service.attachPaymentMethod(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List all saved payment methods",
    description:
      "Returns all cards saved to the account, sorted with the default card first " +
      "and then newest-first.\n\n" +
      "Each entry contains display metadata only: brand, last4, and expiry. " +
      "Full card numbers are never stored.",
  })
  @ApiResponse({
    status: 200,
    description: "Array of saved payment methods, may be empty",
    schema: {
      example: [
        {
          id: "uuid-1",
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2028,
          cardholderName: "Jane Doe",
          isDefault: true,
          createdAt: "2026-04-28T10:00:00.000Z",
        },
        {
          id: "uuid-2",
          brand: "mastercard",
          last4: "5555",
          expMonth: 6,
          expYear: 2027,
          cardholderName: null,
          isDefault: false,
          createdAt: "2026-03-01T08:00:00.000Z",
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async listPaymentMethods(
    @CurrentUser() user: { id: string },
  ): Promise<object[]> {
    return this.service.listPaymentMethods(user.id);
  }

  @Post(":id/default")
  @HttpCode(200)
  @ApiOperation({
    summary: "Set a payment method as the default",
    description:
      "Makes the given card the default for future charges. " +
      "The previous default card is unset automatically.\n\n" +
      "Also updates the `default_payment_method` on the Stripe Customer so that " +
      "the next subscription renewal invoice is charged to this card.",
  })
  @ApiParam({
    name: "id",
    description: "Payment method UUID from GET /payment-methods",
    type: "string",
    format: "uuid",
    example: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  })
  @ApiResponse({
    status: 200,
    description: "Updated card with isDefault: true",
    schema: {
      example: {
        id: "uuid-2",
        brand: "mastercard",
        last4: "5555",
        expMonth: 6,
        expYear: 2027,
        cardholderName: null,
        isDefault: true,
        createdAt: "2026-03-01T08:00:00.000Z",
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 404, description: "Payment method not found" })
  async setDefault(
    @CurrentUser() user: { id: string },
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.setDefault(user.id, id);
  }

  @Delete(":id")
  @HttpCode(200)
  @ApiOperation({
    summary: "Remove a saved payment method",
    description:
      "Detaches the card from Stripe and removes it from the account.\n\n" +
      "**Normal case:** card is removed. If it was the default, the next most recent " +
      "card is promoted to default. Response: `{}`\n\n" +
      "**Last card + active paid subscription:** subscription is scheduled to cancel " +
      "at the end of the current billing period. User keeps access until `expiresAt`. " +
      "Response: `{ subscriptionScheduledToCancel: true, expiresAt }`",
  })
  @ApiParam({
    name: "id",
    description: "Payment method UUID from GET /payment-methods",
    type: "string",
    format: "uuid",
    example: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  })
  @ApiResponse({
    status: 200,
    description:
      "Card removed. Body is {} if no subscription was affected, or includes " +
      "subscriptionScheduledToCancel when the last card was removed while subscribed.",
    schema: {
      examples: {
        normal: {
          summary: "Card removed, no subscription impact",
          value: {},
        },
        autoCancel: {
          summary: "Last card removed — subscription scheduled to cancel",
          value: {
            subscriptionScheduledToCancel: true,
            expiresAt: "2026-05-28T00:00:00.000Z",
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 404, description: "Payment method not found" })
  @ApiResponse({
    status: 503,
    description: "Stripe operation failed; local database was not changed",
  })
  async deletePaymentMethod(
    @CurrentUser() user: { id: string },
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.deletePaymentMethod(user.id, id);
  }
}