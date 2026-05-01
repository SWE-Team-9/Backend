import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResolveSecretPlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  secretToken!: string;
}

export class ResolveSecretPlaylistResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ enum: ['PRIVATE'], example: 'PRIVATE' })
  visibility!: 'PRIVATE';

  @ApiProperty({ example: 'Access granted via secret token' })
  message!: string;
}
