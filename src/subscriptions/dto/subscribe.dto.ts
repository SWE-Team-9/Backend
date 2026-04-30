import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum SubscriptionTypeEnum {
  PRO = "PRO",
  GO_PLUS = "GO_PLUS",
}

export class SubscribeDto {
  @ApiProperty({
    enum: SubscriptionTypeEnum,
    description: "The subscription tier to activate",
    example: "PRO",
  })
  @IsEnum(SubscriptionTypeEnum)
  subscriptionType!: SubscriptionTypeEnum;

  @ApiPropertyOptional({
    description: "Payment method identifier (optional - handled via checkout flow)",
    example: "pm_mock_1234567890",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentMethodId?: string;
}
