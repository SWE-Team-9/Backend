import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PaymentMethodsService } from "./payment-methods.service";
import { AttachPaymentMethodDto } from "./dto/attach-payment-method.dto";

@ApiTags("Payment Methods")
@ApiBearerAuth()
@Controller("payment-methods")
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  /**
   * POST /payment-methods/setup-intent
   *
   * Step 1 of adding a card.
   * Returns a Stripe SetupIntent clientSecret that the frontend passes to
   * Stripe.js to securely collect card details. The card number never
   * touches this server.
   */
  @Post("setup-intent")
  @HttpCode(200)
  @ApiOperation({
    summary: "Create a Stripe SetupIntent to collect card details",
  })
  async createSetupIntent(
    @CurrentUser() user: { id: string },
  ): Promise<{ clientSecret: string }> {
    return this.service.createSetupIntent(user.id);
  }

  /**
   * POST /payment-methods/attach
   *
   * Step 2 of adding a card.
   * After the frontend confirms the SetupIntent with Stripe.js it receives a
   * paymentMethodId. Call this endpoint with that ID to save the card in the
   * user's account.
   */
  @Post("attach")
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Attach a confirmed payment method to the account" })
  async attachPaymentMethod(
    @CurrentUser() user: { id: string },
    @Body() dto: AttachPaymentMethodDto,
  ): Promise<object> {
    return this.service.attachPaymentMethod(user.id, dto);
  }

  /**
   * GET /payment-methods
   * Lists all saved payment methods for the authenticated user.
   */
  @Get()
  @ApiOperation({ summary: "List the user's saved payment methods" })
  async listPaymentMethods(
    @CurrentUser() user: { id: string },
  ): Promise<object[]> {
    return this.service.listPaymentMethods(user.id);
  }

  /**
   * POST /payment-methods/:id/default
   * Sets a payment method as the default for future charges.
   */
  @Post(":id/default")
  @HttpCode(200)
  @ApiOperation({ summary: "Set a payment method as the default" })
  @ApiParam({ name: "id", description: "Payment method UUID" })
  async setDefault(
    @CurrentUser() user: { id: string },
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.setDefault(user.id, id);
  }

  /**
   * DELETE /payment-methods/:id
   * Detaches the payment method from Stripe and removes it from the account.
   */
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a saved payment method" })
  @ApiParam({ name: "id", description: "Payment method UUID" })
  async deletePaymentMethod(
    @CurrentUser() user: { id: string },
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deletePaymentMethod(user.id, id);
  }
}
