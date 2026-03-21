import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength } from 'class-validator';

/**
 * OAuth2 Token Revocation Request DTO (RFC 7009)
 * POST /api/v1/oauth/revoke body
 */
export class RevokeDto {
  /**
   * REQUIRED. The token to revoke.
   * Can be either an access_token or refresh_token.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  /**
   * OPTIONAL. A hint about the type of token being revoked.
   * Can be "access_token" or "refresh_token".
   * Helps the server search the token faster, but neither value changes the outcome.
   */
  @IsOptional()
  @IsString()
  @IsIn(['access_token', 'refresh_token'])
  token_type_hint?: 'access_token' | 'refresh_token';

  /**
   * REQUIRED. Client identifier for authentication.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  client_id!: string;

  /**
   * REQUIRED. Client secret for authentication.
   * Verified against client_secret_hash in DB.
   */
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
