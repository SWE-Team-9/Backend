import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

/**
 * Mirrors the shape of a Stripe webhook event object.
 * Used for the mock webhook endpoint - no real Stripe signature verification.
 *
 * Supported event types:
 *   invoice.payment_succeeded  - renews/activates the subscription
 *   invoice.payment_failed     - marks subscription PAST_DUE
 *   customer.subscription.updated  - syncs plan / status changes
 *   customer.subscription.deleted  - cancels the subscription
 */
export class StripeWebhookDto {
  @ApiProperty({
    description: "Unique Stripe event ID (mock format: evt_mock_xxxx)",
    example: "evt_mock_1a2b3c4d5e6f",
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: "Stripe event type",
    example: "invoice.payment_succeeded",
    enum: [
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
  })
  @IsString()
  type!: string;

  @ApiPropertyOptional({
    description: "Event data payload (mirrors Stripe data.object structure)",
    example: {
      object: {
        id: "sub_mock_abc123",
        customer: "cus_mock_xyz789",
        status: "active",
        invoice: "in_mock_def456",
        amount_paid: 999,
        currency: "usd",
      },
    },
  })
  @IsOptional()
  data?: { object?: Record<string, unknown> };
}
