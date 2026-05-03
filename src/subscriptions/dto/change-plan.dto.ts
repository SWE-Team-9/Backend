import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum ChangePlanCodeEnum {
  PRO = 'PRO',
  GO_PLUS = 'GO_PLUS',
}

export class ChangePlanDto {
  @ApiProperty({
    enum: ChangePlanCodeEnum,
    description: 'Target plan to switch to',
    example: 'GO_PLUS',
  })
  @IsEnum(ChangePlanCodeEnum)
  planCode!: ChangePlanCodeEnum;
}
