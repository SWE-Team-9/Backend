import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
  client_id!: string;

  /**
   * Redirect URI for authorization code response.
   * Must match exactly with registered redirect URI.
   */
  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;

  /**
   * Response type. MUST be "code" for authorization code flow.
   */
  @IsString()
  @IsNotEmpty()
  response_type!: 'code';

  /**
   * Space-separated list of scopes (e.g., "read write").
   */
  @IsString()
  @IsNotEmpty()
  scope!: string;

  /**
   * Opaque state parameter to prevent CSRF.
   * The authorization server must include this unchanged in the redirect.
   */
  @IsString()
  @IsNotEmpty()
  state!: string;

  /**
   * PKCE: Code challenge (base64-url-encoded SHA256 hash of code_verifier).
   * Recommended for public clients like mobile apps.
   */
  @IsOptional()
  @IsString()
  code_challenge?: string;

  /**
   * PKCE: Code challenge method. Must be "S256" if code_challenge provided.
   */
  @IsOptional()
  @IsString()
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
