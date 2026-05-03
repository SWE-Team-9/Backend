import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AiChatContextDto {
  @ApiPropertyOptional({ description: 'Current track ID in context' })
  @IsOptional()
  @IsUUID(4)
  trackId?: string;

  @ApiPropertyOptional({ description: 'Current playlist ID in context' })
  @IsOptional()
  @IsUUID(4)
  playlistId?: string;

  @ApiPropertyOptional({ description: 'Conversation ID for context continuity' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Current page the user is on' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentPage?: string;

  @ApiPropertyOptional({ description: 'Pending AI intent awaiting a short follow-up answer' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  pendingIntent?: string;

  @ApiPropertyOptional({ description: 'Pending genre for a playlist/search clarification' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  pendingGenre?: string;

  @ApiPropertyOptional({ description: 'Pending track limit for a playlist/search clarification' })
  @IsOptional()
  pendingLimit?: number;
}

export class AiChatDto {
  @ApiProperty({ description: 'User message to the AI assistant', maxLength: 1000, example: 'find sha3by tracks' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;

  @ApiPropertyOptional({ type: AiChatContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiChatContextDto)
  context?: AiChatContextDto;
}
