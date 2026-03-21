import { IsString, IsNotEmpty, IsOptional, MaxLength, IsIn } from 'class-validator';

/**
 * OAuth2 Authorization Request DTO (RFC 6749)
 * GET /api/v1/oauth/authorize query parameters
 */
export class AuthorizeDto {
  /**
   * Client identifier issued to the client during registration.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  client_id!: string;

  /**
   * Redirect URI for authorization code response.
   * Must match exactly with registered redirect URI.
   * 2048 chars matches the limit used by most browsers for URL length.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirect_uri!: string;

  /**
   * Response type. MUST be "code" for authorization code flow.
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(['code'])
  response_type!: 'code';

  /**
   * Space-separated list of scopes (e.g., "read write").
   * Limit to 256 chars — plenty of room for multiple scopes.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  scope!: string;

  /**
   * Opaque state parameter to prevent CSRF.
   * The authorization server must include this unchanged in the redirect.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state!: string;

  /**
   * PKCE: Code challenge (base64-url-encoded SHA256 hash of code_verifier).
   * SHA256 output base64url-encoded is exactly 43 chars.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  code_challenge?: string;

  /**
   * PKCE: Code challenge method. Must be "S256" if code_challenge provided.
   */
  @IsOptional()
  @IsString()
  @IsIn(['S256'])
  code_challenge_method?: 'S256';
}

/**
 * Authorization approval response structure.
 * Returned after user confirms permission to authorize the client.
 */
export class AuthorizeResponseDto {
  code!: string;
  state!: string;
}
