import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAppealDto {
  @ApiProperty({
    description: 'ID of the report being appealed',
    example: 'b1c2d3e4-f5a6-4890-abcd-ef1234567890',
  })
  @IsUUID('4')
  reportId!: string;

  @ApiProperty({
    description: 'Appeal message from the user',
    example: 'I believe this report was made in error. Please review.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}
