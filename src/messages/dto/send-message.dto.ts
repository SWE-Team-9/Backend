import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ description: 'UUID of the recipient user', format: 'uuid', example: 'usr_456' })
  @IsUUID()
  receiverId!: string;

  @ApiProperty({ description: 'Message text', minLength: 1, maxLength: 2000, example: 'Hey, loved your track!' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
