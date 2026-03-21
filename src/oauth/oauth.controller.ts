import { Controller, Get, Post, Body, Query, Redirect, BadRequestException, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { AuthorizeDto, TokenDto, RevokeDto } from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ThrottlePolicy } from '../common/decorators/throttle-policy.decorator';

/**
 * OAuth2 Provider Controller (RFC 6749, RFC 7009, RFC 7636)
 *
 * Implements the authorization server role for OAuth2 authorization code flow.
 * Allows third-party applications to:
 * 1. Request user authorization (GET /oauth/authorize)
 * 2. Exchange authorization code for tokens (POST /oauth/token)
 * 3. Revoke access/refresh tokens (POST /oauth/revoke)
 *
 * Security Notes:
 * - All tokens are stored as SHA-256 hashes in the database (never raw)
 * - Tokens are random (not JWTs) generated via crypto.randomBytes
 * - Client secrets are stored as SHA-256 hashes (appropriate for long random secrets)
 * - All comparisons use timing-safe functions to prevent enumeration attacks
 * - Authorization codes are single-use and expire in 60 seconds
 * - Refresh tokens are rotated on every use (RFC 6749 recommendation)
 * - PKCE support for public clients (mobile apps, SPAs)
 * - Token and revoke endpoints are rate-limited to stop brute-force attacks
 */
@ApiTags('OAuth2 Provider')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  // ---------------------------------------------------------------------------
  // Endpoint 18: Authorization Endpoint (User Consent)
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: '[RFC 6749] OAuth2 authorization request',
    description: `
**Purpose:** First step of OAuth2 authorization code flow. User's browser is redirected here by third-party app. User sees consent screen ("App X wants access to your account"). After approval, redirect back to the third-party app with authorization code.

**Flow:**
1. Third-party app redirects user: \`GET /api/v1/oauth/authorize?client_id=abc&response_type=code&...\`
2. User must be authenticated (logged in)
3. System validates client and requested scopes
4. User reviews permissions and clicks "Approve"
5. System generates single-use authorization code (60-second TTL)
6. Browser redirects to: \`{redirect_uri}?code={code}&state={state}\`
7. Third-party app's backend receives code, exchanges it for tokens at /oauth/token endpoint

**PKCE Support (RFC 7636):** For public clients (mobile apps, SPAs), use PKCE to prevent authorization code interception attacks:
- Generate code_verifier: random 43-128 char string
- Calculate code_challenge: BASE64-URL(SHA256(code_verifier))
- Include code_challenge in authorize request
- Later, exchange code with code_verifier in token request

**Security:**
- Response Type must be "code" (not "code id_token" or others)
- Redirect URI must match exactly with registered URI (prevents open redirect)
- State parameter prevents CSRF (third-party app generates it, we return unchanged)
- Code expires in 60 seconds (window for interception is minimal)
- Code is single-use (consuming same code twice returns error)

**Permissions Model:** Scopes define what the third-party app can do:
- "read" — Read access to user profile, library
- "write" — Write access to playlists, reposts, likes
- Third-party app cannot request scopes beyond what your admin allowed

**Error Behavior:**
- Invalid client_id: Response with 400 bad request (client not found/inactive)
- Mismatched redirect_uri: Don't redirect (to prevent open redirect). Response with 400 bad request
- User denies: Redirect to redirect_uri?error=access_denied&state={state}
    `,
  })
  @ApiResponse({
    status: 302,
    description:
      'Redirect to redirect_uri with authorization code. Format: {redirect_uri}?code={code}&state={state}',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Single-use authorization code (60-second TTL)' },
        state: { type: 'string', description: 'Original state parameter (unchanged)' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid request (missing params, invalid client, mismatched redirect_uri, unsupported response_type)',
  })
  @ApiResponse({
    status: 302,
    description: 'User denied. Redirect: {redirect_uri}?error=access_denied&state={state}',
  })
  @ApiQuery({ name: 'client_id', required: true, description: 'Third-party app client ID' })
  @ApiQuery({ name: 'redirect_uri', required: true, description: 'Must match registered URI' })
  @ApiQuery({
    name: 'response_type',
    required: true,
    description: 'Must be "code"',
    enum: ['code'],
  })
  @ApiQuery({ name: 'scope', required: true, description: 'Space-separated list (e.g., "read write")' })
  @ApiQuery({
    name: 'state',
    required: true,
    description: 'CSRF protection token generated by client',
  })
  @ApiQuery({
    name: 'code_challenge',
    required: false,
    description: 'PKCE: BASE64-URL(SHA256(code_verifier))',
  })
  @ApiQuery({
    name: 'code_challenge_method',
    required: false,
    description: 'PKCE: Must be "S256"',
  })
  @Get('authorize')
  @Redirect()
  async authorize(
    @Query() query: AuthorizeDto,
    @CurrentUser('userId') userId: string,
  ) {
    if (query.response_type !== 'code') {
      throw new BadRequestException('unsupported_response_type');
    }

    // Validate code_challenge_method if code_challenge is present
    if (query.code_challenge && query.code_challenge_method !== 'S256') {
      throw new BadRequestException('unsupported_code_challenge_method');
    }

    // Generate authorization code
    const { code, state } = await this.oauthService.generateAuthorizationCode(
      query.client_id,
      userId,
      query.redirect_uri,
      query.scope,
      query.state,
      query.code_challenge
        ? { challenge: query.code_challenge, method: 'S256' }
        : undefined,
    );

    // Redirect back to the client with the code.
    // encodeURIComponent on state prevents special characters in the
    // state value from breaking the URL or being misused as an injection.
    // The code is already base64url-safe so no encoding needed there.
    return {
      url: `${query.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Endpoint 19: Token Endpoint (Exchange Code for Tokens)
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: '[RFC 6749] OAuth2 token exchange',
    description: `
**Purpose:** Second step of OAuth2 flow. Third-party app's backend calls this endpoint (server-to-server) to exchange the authorization code for access+refresh tokens.

**Two Grant Types Supported:**

**1. grant_type=authorization_code** (initial token acquisition)
- Input: client_id, client_secret, code (from user's authorize redirect), redirect_uri (must match), code_verifier (if PKCE)
- Output: access_token (1 hour), refresh_token (30 days), expires_in
- Flow:
  1. Validate client credentials (client_id + client_secret)
  2. Verify authorization code exists, not expired (60 sec), not already consumed
  3. If PKCE: verify code_verifier matches original code_challenge
  4. Mark code as consumed (one-time use)
  5. Generate new opaque access + refresh tokens (hashed in database)
  6. Return tokens

**2. grant_type=refresh_token** (token renewal)
- Input: client_id, client_secret, refresh_token (from previous token response)
- Output: NEW access_token + NEW refresh_token, expires_in
- Flow:
  1. Validate client credentials
  2. Verify refresh token exists, not expired (30 days), not revoked
  3. Revoke the OLD token pair (refresh token rotation)
  4. Generate brand new token pair
  5. Return new tokens
  6. Benefit: If attacker steals the old refresh token, they can't use it after legitimate app has refreshed

**Token Format:** Both access and refresh tokens are:
- Cryptographically random (32 bytes = 256 bits)
- Opaque (not JWTs) — no structure the third-party app can parse
- Hashed with SHA256 before storage (database breaches don't leak raw tokens)
- Subject to rate limiting by client (default 1000 reqs/hour)

**Security:**
- No tokens returned in URL (response body only)
- Client authentication via client_id + client_secret (timing-safe comparison)
- PKCE support for public clients to prevent authorization code interception
- Refresh token rotation on every use (recommended by RFC 6749 section 10.4)

**Error Handling:**
- invalid_client: Client not found or secret incorrect
- invalid_grant: Code expired, already used, or doesn't match client
- invalid_request: Missing required fields
- invalid_pkce: code_verifier doesn't match code_challenge (if PKCE was used)
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Token exchange successful',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description: 'Opaque access token (1 hour TTL)',
        },
        refresh_token: {
          type: 'string',
          description: 'Opaque refresh token (30 day TTL)',
        },
        token_type: {
          type: 'string',
          default: 'Bearer',
        },
        expires_in: {
          type: 'number',
          description: 'Access token lifetime in seconds (3600)',
        },
        scope: {
          type: 'string',
          description: 'Authorized scopes',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'invalid_grant (code expired/not found) or invalid_pkce',
  })
  @ApiResponse({
    status: 401,
    description: 'invalid_client (bad credentials)',
  })
  // Rate limit: 20 attempts per minute per IP.
  // This stops attackers from brute-forcing client secrets.
  @Post('token')
  @Public()
  @ThrottlePolicy(20, 60_000)
  @HttpCode(200)
  async token(@Body() body: TokenDto) {
    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.redirect_uri) {
        throw new BadRequestException('invalid_request');
      }

      return await this.oauthService.exchangeAuthorizationCode(
        body.client_id,
        body.client_secret,
        body.code,
        body.redirect_uri,
        body.code_verifier,
      );
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        throw new BadRequestException('invalid_request');
      }

      return await this.oauthService.refreshAccessToken(
        body.client_id,
        body.client_secret,
        body.refresh_token,
      );
    }

    throw new BadRequestException('unsupported_grant_type');
  }

  // ---------------------------------------------------------------------------
  // Endpoint 20: Revocation Endpoint
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: '[RFC 7009] OAuth2 token revocation',
    description: `
**Purpose:** Allow third-party app to revoke access/refresh tokens when they're no longer needed. Used when:
- User disconnects the app from their account
- User uninstalles the app
- App wants to clean up after logout

**Flow:**
1. Third-party app sends PUT_or POST with token, client_id, client_secret
2. System validates client credentials
3. If token found and not already revoked, mark as revoked
4. Always return 200 OK (even if token not found) per RFC 7009

**Why Always 200?** (RFC 7009 Section 2.2)
RFC 7009 states that to prevent information leakage about token existence, the endpoint MUST return the same response regardless of whether:
- Token was found and revoked
- Token was already revoked
- Token doesn't exist
- Client doesn't own the token

This prevents attackers from enumerating valid tokens.

**Token Type Hints:** (optional, helps with performance)
- "access_token" — search access_token_hash first
- "refresh_token" — search refresh_token_hash first
- Without hint, search both (slower)

**Security:**
- Client authentication (client_id + client_secret)
- Timing-safe comparisons prevent enumeration
- Revocation is immediate (next API call with that token returns 401)
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Token revocations (successful or was already revoked—same response)',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          default: 'Token revoked successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized (invalid client credentials)',
  })
  // Rate limit: 20 attempts per minute per IP.
  @Post('revoke')
  @Public()
  @ThrottlePolicy(20, 60_000)
  @HttpCode(200)
  async revoke(@Body() body: RevokeDto) {
    return await this.oauthService.revokeToken(
      body.client_id,
      body.client_secret,
      body.token,
    );
  }
}
