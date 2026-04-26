import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

// Extract the JWT from the "access_token" httpOnly cookie (primary — browser / web clients)
function cookieExtractor(req: Request): string | null {
  if (req && req.cookies) {
    return req.cookies["access_token"] || null;
  }
  return null;
}

// Fallback extractor: accept Bearer tokens from the Authorization header.
// This allows non-browser clients (Postman, Swagger UI, mobile HTTP clients)
// to authenticate without a cookie jar. The token itself is identical — it is
// the same short-lived JWT signed by the same secret. Clients that receive the
// token from the login response body or another secure channel can pass it here.
const bearerExtractor = ExtractJwt.fromAuthHeaderAsBearerToken();

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(Strategy, "jwt-cookie") {
  constructor(configService: ConfigService) {
    super({
      // Try the httpOnly cookie first; fall back to Authorization: Bearer.
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, bearerExtractor]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("security.jwtSecret"),
      issuer: configService.get<string>("security.jwtIssuer") ?? "spotly-api",
      audience: configService.get<string>("security.jwtAudience") ?? "spotly-client",
    });
  }

  // This runs after the JWT signature is verified.
  // Return value gets attached to request.user
  validate(payload: JwtPayload) {
    // Return the shape that @CurrentUser("userId") expects
    return {
      userId: payload.sub,
      role: payload.role,
    };
  }
}
