import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DirectConversationDto {
  @ApiProperty({ description: 'UUID of the user to start a conversation with', format: 'uuid', example: 'usr_456' })
  @IsUUID()
  receiverId!: string;
}
