import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

// Extract the JWT from the "access_token" cookie
function cookieExtractor(req: Request): string | null {
  if (req && req.cookies) {
    return req.cookies["access_token"] || null;
  }
  return null;
}

@Injectable()
export class JwtCookieStrategy extends PassportStrategy(Strategy, "jwt-cookie") {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: cookieExtractor,
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
