import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CallbackDto {
  @ApiProperty({ example: 'internal_auth_code_abc123', description: 'Internal authorization code from Google OAuth callback' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @ApiProperty({ example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', description: 'PKCE code verifier' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  code_verifier!: string;

  @ApiProperty({ example: 'myapp://oauth/callback', description: 'Redirect URI used in the original authorize request' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirect_uri!: string;
}
