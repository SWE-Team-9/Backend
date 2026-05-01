import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SharePlaylistDto {
  @ApiProperty({ description: 'UUID of the recipient user', format: 'uuid', example: 'usr_456' })
  @IsUUID()
  receiverId!: string;

  @ApiProperty({ description: 'UUID of the playlist to share', format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567891' })
  @IsUUID()
  playlistId!: string;

  @ApiPropertyOptional({ description: 'Optional caption', maxLength: 2000, example: "You'll love this set!" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
