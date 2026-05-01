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
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentMethodsService } from './payment-methods.service';
import { AttachPaymentMethodDto } from './dto/attach-payment-method.dto';

@ApiTags('Payment Methods')
@ApiBearerAuth()
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  // ── POST /payment-methods/setup-intent ─────────────────────────────────────
  //
  // Step 1 of adding a card.
  // Card details are never sent to this server — they go directly to Stripe via
  // Stripe.js running in the browser.
  //
  // Frontend flow:
  //   1. Call this endpoint → receive { clientSecret }
  //   2. stripe.confirmCardSetup(clientSecret, { payment_method: { card: elements.getElement('card') } })
  //   3. On success, Stripe returns paymentMethod.id → call POST /payment-methods/attach

  @Post('setup-intent')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step 1 of adding a card — create a Stripe SetupIntent',
    description:
      'Returns a Stripe `clientSecret` that the frontend passes to `stripe.confirmCardSetup()` ' +
      "(Stripe.js). The user's card number is collected directly by Stripe and never " +
      'passes through this server.\n\n' +
      '**Full card-add flow:**\n' +
      '1. Call `POST /payment-methods/setup-intent` → get `clientSecret`\n' +
      '2. Mount a Stripe Elements card form; call `stripe.confirmCardSetup(clientSecret)`\n' +
      '3. On success Stripe returns `setupIntent.payment_method` (a `pm_xxx` ID)\n' +
      '4. Call `POST /payment-methods/attach` with that ID to persist the card',
  })
  @ApiResponse({
    status: 200,
    description: 'SetupIntent created',
    schema: {
      example: { clientSecret: 'seti_xxx_secret_yyy' },
    },
  })
  @ApiResponse({ status: 400, description: 'Failed to create Setup Intent' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async createSetupIntent(@CurrentUser() user: { id: string }): Promise<{ clientSecret: string }> {
    return this.service.createSetupIntent(user.id);
  }

  // ── POST /payment-methods/attach ───────────────────────────────────────────
  //
  // Step 2 of adding a card.
  // After stripe.confirmCardSetup succeeds the frontend receives a pm_xxx ID.
  // Call this endpoint to attach it to the Stripe customer and persist the
  // card metadata (brand, last4, expiry) in the database for display.
  //
  // The first card saved is automatically made the default.
  // Set setAsDefault: true to override the default for subsequent cards.

  @Post('attach')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Step 2 of adding a card — attach a confirmed payment method',
    description:
      'Attaches a Stripe `pm_xxx` payment method (returned by `stripe.confirmCardSetup`) ' +
      "to the user's account and persists display metadata (brand, last4, expiry).\n\n" +
      '**Auto-default rule:** the very first card added is always made the default. ' +
      'For subsequent cards pass `setAsDefault: true` to override.\n\n' +
      'Returns the saved card object (same shape as `GET /payment-methods` entries).',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment method saved',
    schema: {
      example: {
        id: 'uuid',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2028,
        cardholderName: 'Jane Doe',
        isDefault: true,
        createdAt: '2026-04-28T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Only card payment methods are supported',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 409,
    description: 'This payment method is already saved',
  })
  @ApiBody({ type: AttachPaymentMethodDto })
  async attachPaymentMethod(
    @CurrentUser() user: { id: string },
    @Body() dto: AttachPaymentMethodDto,
  ): Promise<object> {
    return this.service.attachPaymentMethod(user.id, dto);
  }

  // ── GET /payment-methods ───────────────────────────────────────────────────
  //
  // Returns all saved cards sorted: default first, then newest first.

  @Get()
  @ApiOperation({
    summary: 'List all saved payment methods',
    description:
      'Returns all cards saved to the account, sorted with the default card first ' +
      'and then newest-first.\n\n' +
      'Each entry contains display metadata only (brand, last4, expiry). ' +
      'Full card numbers are never stored.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of saved payment methods (may be empty)',
    schema: {
      example: [
        {
          id: 'uuid-1',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2028,
          cardholderName: 'Jane Doe',
          isDefault: true,
          createdAt: '2026-04-28T10:00:00.000Z',
        },
        {
          id: 'uuid-2',
          brand: 'mastercard',
          last4: '5555',
          expMonth: 6,
          expYear: 2027,
          cardholderName: null,
          isDefault: false,
          createdAt: '2026-03-01T08:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listPaymentMethods(@CurrentUser() user: { id: string }): Promise<object[]> {
    return this.service.listPaymentMethods(user.id);
  }

  // ── POST /payment-methods/:id/default ─────────────────────────────────────
  //
  // Sets the given card as the default for future charges.
  // Also updates the default_payment_method on the Stripe Customer object so
  // Stripe uses this card for the next renewal invoice.

  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a payment method as the default',
    description:
      'Makes the given card the default for future charges. ' +
      'The previous default card is unset automatically.\n\n' +
      'Also updates the `default_payment_method` on the Stripe Customer so that ' +
      'the next subscription renewal invoice is charged to this card.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment method UUID (from GET /payment-methods)',
    type: 'string',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated card with isDefault: true',
    schema: {
      example: {
        id: 'uuid-2',
        brand: 'mastercard',
        last4: '5555',
        expMonth: 6,
        expYear: 2027,
        cardholderName: null,
        isDefault: true,
        createdAt: '2026-03-01T08:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async setDefault(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.setDefault(user.id, id);
  }

  // ── DELETE /payment-methods/:id ────────────────────────────────────────────
  //
  // Removes a saved card. Always succeeds (200) — never blocks deletion.
  //
  // Special case — last card + active paid subscription:
  //   The card is removed AND the subscription is automatically scheduled to
  //   cancel at the end of the current billing period (cancel_at_period_end).
  //   The user keeps full PRO/GO+ access until the period expires; they will
  //   simply not be renewed. The response includes { subscriptionScheduledToCancel,
  //   expiresAt } so the frontend can show a confirmation banner.
  //
  // Normal case (user has another card, or no active paid sub):
  //   The card is removed. If it was the default, the next most recent card is
  //   automatically promoted to default (both in our DB and on the Stripe Customer).
  //   Response body is {}.

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove a saved payment method',
    description:
      'Detaches the card from Stripe and removes it from the account. Always returns 200.\n\n' +
      '**Normal case** (user has another card, or no active subscription): card is removed, ' +
      'if it was the default the next most recent card is auto-promoted. Response: `{}`\n\n' +
      '**Last card + active paid subscription:** the card is still removed, but the ' +
      'subscription is **automatically scheduled to cancel at the end of the current ' +
      'billing period** (`cancel_at_period_end = true`). The user keeps full access ' +
      'until `expiresAt`. Response: `{ subscriptionScheduledToCancel: true, expiresAt }`\n\n' +
      'The frontend should inspect the response and show a banner when ' +
      '`subscriptionScheduledToCancel` is true, e.g. *"Card removed. Your PRO ' +
      'subscription will expire on May 28 — add a new card to keep it active."*',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment method UUID (from GET /payment-methods)',
    type: 'string',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiResponse({
    status: 200,
    description:
      'Card removed. Body is {} if no subscription was affected, or includes ' +
      'subscriptionScheduledToCancel when the last card was removed while subscribed.',
    schema: {
      examples: {
        normal: {
          summary: 'Card removed, no subscription impact',
          value: {},
        },
        autoCancel: {
          summary: 'Last card removed — subscription scheduled to cancel',
          value: {
            subscriptionScheduledToCancel: true,
            expiresAt: '2026-05-28T00:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async deletePaymentMethod(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.deletePaymentMethod(user.id, id);
  }
}
