import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { JwtPayload } from "../interfaces/jwt-payload.interface";
import { PrismaService } from "../../prisma/prisma.service";

// Extract the JWT from the "access_token" httpOnly cookie (primary - browser / web clients)
function cookieExtractor(req: Request): string | null {
  if (req && req.cookies) {
    return req.cookies["access_token"] || null;
  }
  return null;
}

// Fallback extractor: accept Bearer tokens from the Authorization header.
// This allows non-browser clients (Postman, Swagger UI, mobile HTTP clients)
// to authenticate without a cookie jar. The token itself is identical - it is
// the same short-lived JWT signed by the same secret. Clients that receive the
// token from the login response body or another secure channel can pass it here.
const bearerExtractor = ExtractJwt.fromAuthHeaderAsBearerToken();

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(
  Strategy,
  "jwt-cookie",
) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Try the httpOnly cookie first; fall back to Authorization: Bearer.
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        bearerExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("security.jwtSecret"),
      issuer: configService.get<string>("security.jwtIssuer") ?? "spotly-api",
      audience:
        configService.get<string>("security.jwtAudience") ?? "spotly-client",
    });
  }

  // This runs after the JWT signature is verified.
  // Return value gets attached to request.user; returning null causes a 401.
  async validate(payload: JwtPayload) {
    // ── Session revocation check ────────────────────────────────────────────
    // When the JWT was signed with a session ID (jti), verify that session is
    // still active. This makes logout effective immediately: revoking the
    // session denies all subsequent requests that carry the same access token,
    // even before the token's own expiry window closes.
    if (payload.jti) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.jti },
        select: {
          revokedAt: true,
          expiresAt: true,
          user: { select: { accountStatus: true } },
        },
      });

      // Deny: session revoked, expired, or unknown
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt < new Date()
      ) {
        return null;
      }

      // Deny: user account deleted (session row exists but user was removed)
      if (!session.user) return null;

      return {
        userId: payload.sub,
        role: payload.role,
        accountStatus: session.user.accountStatus,
      };
    }

    // ── Legacy path (tokens without jti) ───────────────────────────────────
    // Tokens issued before this fix don't carry a jti; fall back to a simple
    // user-existence + account-status check.  These tokens expire within 15 min
    // at most, so the revocation gap is bounded.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { accountStatus: true },
    });

    // Bug fix: deleted users must be rejected (previously defaulted to "ACTIVE").
    if (!user) return null;

    return {
      userId: payload.sub,
      role: payload.role,
      accountStatus: user.accountStatus,
    };
  }
}
