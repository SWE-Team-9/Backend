import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum PlanCodeEnum {
  PRO = 'PRO',
  GO_PLUS = 'GO_PLUS',
}

export class CheckoutDto {
  @ApiProperty({
    enum: PlanCodeEnum,
    example: 'PRO',
    description: 'Plan to subscribe to',
  })
  @IsEnum(PlanCodeEnum)
  planCode!: PlanCodeEnum;

  @ApiPropertyOptional({
    description: 'URL to redirect to after successful checkout',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;

  @ApiPropertyOptional({
    description: 'URL to redirect to if checkout is cancelled',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelUrl?: string;
}
