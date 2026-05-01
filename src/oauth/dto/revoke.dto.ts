import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * OAuth2 Token Revocation Request DTO (RFC 7009)
 * POST /api/v1/oauth/revoke body
 */
export class RevokeDto {
  /**
   * REQUIRED. The token to revoke.
   * Can be either an access_token or refresh_token.
   */
  @ApiProperty({ example: 'access_token_abc123', description: 'The token to revoke (access or refresh token)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  /**
   * OPTIONAL. A hint about the type of token being revoked.
   * Can be "access_token" or "refresh_token".
   * Helps the server search the token faster, but neither value changes the outcome.
   */
  @ApiPropertyOptional({ enum: ['access_token', 'refresh_token'], example: 'access_token', description: 'Hint about token type (improves lookup performance)' })
  @IsOptional()
  @IsString()
  @IsIn(['access_token', 'refresh_token'])
  token_type_hint?: 'access_token' | 'refresh_token';

  /**
   * REQUIRED. Client identifier for authentication.
   */
  @ApiProperty({ example: 'client_abc123', description: 'Client identifier for authentication' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  client_id!: string;

  /**
   * REQUIRED. Client secret for authentication.
   * Verified against client_secret_hash in DB.
   */
  @ApiProperty({ example: 'client_secret_xyz', description: 'Client secret for authentication' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  client_secret!: string;
}

/**
 * Token revocation success response
 * Per RFC 7009, always returns 200 OK even if token was invalid/already revoked.
 * This prevents information leakage about token existence.
 */
export class RevokeResponseDto {
  message!: string;
}
