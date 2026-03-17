import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import {
  ACCESS_COOKIE_NAME,
  JWT_ISSUER,
  JWT_AUDIENCE,
} from "../constants/auth.constants";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

// =============================================================================
// JwtCookieStrategy — Member 1 (Backend Lead + Security Owner)
//
// Extracts the access token from the httpOnly "access_token" cookie and
// validates it using the shared JWT secret.
//
// OWASP coverage:
//   A02 — Cryptographic Failures   : secret loaded from env, never hardcoded
//   A07 — Auth Failures            : rejects tokens with missing sub or role
//   A08 — Data Integrity Failures  : validates issuer + audience on every token
//                                    to prevent token-confusion / confused-deputy
//                                    attacks where a JWT signed for one service
//                                    is replayed against another
// =============================================================================

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  "jwt-cookie",
) {
  constructor(configService: ConfigService) {
    super({
      // ── Token extraction ───────────────────────────────────────────────────
      // Read the JWT exclusively from the httpOnly "access_token" cookie.
      // This cookie is inaccessible to JavaScript (XSS-safe) and is only
      // transmitted over HTTPS in production (secure: true).
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => request?.cookies?.[ACCESS_COOKIE_NAME] ?? null,
      ]),

      // ── Expiry enforcement ─────────────────────────────────────────────────
      // Never accept a token whose exp claim has passed.
      ignoreExpiration: false,

      // ── Signature verification ─────────────────────────────────────────────
      // The shared HS256 secret used to sign all access tokens.
      secretOrKey: configService.getOrThrow<string>("security.jwtSecret"),

      // ── Issuer validation (OWASP A08) ──────────────────────────────────────
      // Ensures the token was produced by THIS API.
      // A token signed by a different service — even with the same algorithm —
      // will be rejected because its iss claim will not match.
      issuer: configService.get<string>("security.jwtIssuer") ?? JWT_ISSUER,

      // ── Audience validation (OWASP A08) ────────────────────────────────────
      // Ensures the token was intended for THIS client.
      // Prevents a token issued for an admin dashboard being silently accepted
      // by the user-facing API (confused-deputy / token-confusion attack).
      audience:
        configService.get<string>("security.jwtAudience") ?? JWT_AUDIENCE,
    });
  }

  // ---------------------------------------------------------------------------
  // validate()
  //
  // Called by Passport AFTER the token has already been:
  //   1. Extracted from the cookie
  //   2. Verified against the secret
  //   3. Checked for expiry
  //   4. Checked for issuer match
  //   5. Checked for audience match
  //
  // By the time this method runs, the signature and claims are trusted.
  // We perform one final layer of application-level validation:
  //   • sub must be a non-empty string  — identifies the user
  //   • role must be a non-empty string — required by RolesGuard
  //
  // The returned object is attached to req.user by Passport and is read
  // by the @CurrentUser() decorator throughout the application.
  // ---------------------------------------------------------------------------

  validate(payload: JwtPayload): { userId: string; role: string } {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException({
        code: "NOT_AUTHENTICATED",
        message: "Invalid authentication token.",
      });
    }

    return {
      userId: payload.sub,
      role: payload.role,
    };
  }
}
