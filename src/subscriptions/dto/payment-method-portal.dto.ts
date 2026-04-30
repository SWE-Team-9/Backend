import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Body for POST /subscriptions/portal.
 *
 * Both fields are optional:
 * - returnUrl: where to send the user after they close the billing portal.
 * - flow: hint to the portal session. 'payment_methods' focuses the portal on
 *   the payment-method management screen. 'billing' opens the general billing page.
 *   Defaults to 'payment_methods' when not provided (aligns with this endpoint's
 *   primary use-case from the profile/settings billing area).
 *
 * Backward compat: if a caller passes returnUrl as a query-string parameter
 * instead of a body field, the controller also accepts @Query('returnUrl').
 */
export class PaymentMethodPortalDto {
  @ApiPropertyOptional({
    description: "URL to redirect the user to after they finish in the billing portal.",
    maxLength: 500,
    example: "https://app.example.com/settings/billing",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;

  @ApiPropertyOptional({
    description:
      "Billing portal flow to open. 'payment_methods' focuses on adding/updating/removing " +
      "payment methods. 'billing' opens the general billing management page.",
    enum: ["payment_methods", "billing"],
    example: "payment_methods",
  })
  @IsOptional()
  @IsIn(["payment_methods", "billing"])
  flow?: "payment_methods" | "billing";
}
