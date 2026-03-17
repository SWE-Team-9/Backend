import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "crypto";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  JWT_ISSUER,
  JWT_AUDIENCE,
} from "../constants/auth.constants";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  // ---------------------------------------------------------------------------
  // Access token signing
  // OWASP A08 — Software and Data Integrity Failures
  //   • issuer   (iss) : identifies this API as the token producer.
  //                      A token signed by a different service cannot be
  //                      accepted here even if the secret leaks.
  //   • audience (aud) : restricts the token to the intended consumer.
  //                      Prevents a token meant for service A being replayed
  //                      against service B (token-confusion / confused deputy).
  // ---------------------------------------------------------------------------

  signAccessToken(payload: Pick<JwtPayload, "sub" | "role">): string {
    return this.jwtService.sign(
      {
        sub: payload.sub,
        role: payload.role,
      },
      {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Access token expiry date helper
  // Used by callers that need to store the expiry alongside the token.
  // ---------------------------------------------------------------------------

  getAccessTokenExpiryDate(): Date {
    return new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  }

  // ---------------------------------------------------------------------------
  // Opaque refresh token creation
  //
  // Refresh tokens are NOT JWTs — they are high-entropy random byte strings
  // stored as SHA-256 hashes in the database.  This design means:
  //   • A DB compromise exposes only hashes, not live tokens.
  //   • Tokens cannot be forged or decoded without the raw value.
  //   • Rotation and reuse detection are implemented at the session layer.
  // ---------------------------------------------------------------------------

  createRefreshToken(rememberMe = false): {
    rawToken: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    // 48 random bytes → 64+ base64url characters (sufficient entropy)
    const rawToken = randomBytes(48).toString("base64url");
    const tokenHash = this.hashToken(rawToken);

    const ttlSeconds = rememberMe
      ? REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS
      : REFRESH_TOKEN_TTL_SECONDS;

    return {
      rawToken,
      tokenHash,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  // ---------------------------------------------------------------------------
  // SHA-256 hash helper
  //
  // Used for:
  //   • Hashing refresh tokens before DB storage (breach resistance)
  //   • Hashing one-time tokens (email verification, password reset, etc.)
  //
  // Output is a 64-character lowercase hex string.
  // ---------------------------------------------------------------------------

  hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
