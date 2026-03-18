import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

/**
 * OAuth2 Token Request DTO (RFC 6749)
 * POST /api/v1/oauth/token body
 * 
 * Supports two grant types:
 * 1. grant_type=authorization_code (exchange code for tokens)
 * 2. grant_type=refresh_token (exchange refresh token for new access token)
 */
export class TokenDto {
  /**
   * REQUIRED. Grant type. Must be one of:
   * - "authorization_code" (RFC 6749, section 1.3.1)
   * - "refresh_token" (RFC 6749, section 6)
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  /**
   * REQUIRED. Client identifier (issued during client registration).
   */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /**
   * REQUIRED. Client secret for authentication.
   * Confidential clients must include this;verified against client_secret_hash in DB.
   */
  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  /**
   * REQUIRED for grant_type=authorization_code.
   * The authorization code previously issued by the authorization endpoint.
   */
  @IsOptional()
  @IsString()
  code?: string;

  /**
   * REQUIRED for grant_type=authorization_code.
   * Must match the redirect_uri from the authorization request.
   */
  @IsOptional()
  @IsString()
  redirect_uri?: string;

  /**
   * REQUIRED if PKCE was used during authorization request.
   * The original code_verifier (server verifies SHA256(code_verifier) matches code_challenge).
   */
  @IsOptional()
  @IsString()
  code_verifier?: string;

  /**
   * REQUIRED for grant_type=refresh_token.
   * The refresh token issued by the authorization server.
   */
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

/**
 * Successful token response (RFC 6749, section 5.1)
 */
export class TokenResponseDto {
  /**
   * The access token issued by the authorization server.
   * Can be in any format but typically JWT.
   */
  access_token!: string;

  /**
   * Access token type. Always "Bearer" per RFC 6749.
   */
  token_type!: 'Bearer';

  /**
   * Lifetime of the access token in seconds.
   * Typically 3600 (1 hour) for OAuth2 provider tokens.
   */
  expires_in!: number;

  /**
   * Refresh token to obtain new access token when current one expires.
   * Typically valid for 30 days.
   * Included only if offline access is requested or by policy.
   */
  refresh_token?: string;

  /**
   * Scope of the access token. Space-separated list.
   */
  scope?: string;
}

/**
 * Error response (RFC 6749, section 5.2)
 */
export class TokenErrorResponseDto {
  error!: string; // error code: invalid_request, invalid_client, invalid_grant, unauthorized_client, etc.
  error_description?: string;
  error_uri?: string;
}
