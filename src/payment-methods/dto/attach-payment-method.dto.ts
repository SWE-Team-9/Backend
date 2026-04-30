import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AttachPaymentMethodDto {
  @ApiProperty({
    description:
      "The Stripe PaymentMethod ID returned by Stripe.js after confirming a SetupIntent.",
    example: "pm_1NnBCc2eZvKYlo2CxwSUkEoc",
  })
  @IsString()
  @MaxLength(100)
  stripePaymentMethodId!: string;

  @ApiPropertyOptional({
    description: "Set this payment method as the default.",
  })
  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean;
}
