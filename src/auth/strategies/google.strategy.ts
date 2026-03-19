import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback, Profile } from "passport-google-oauth20";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>("google.clientId"),
      clientSecret: configService.get<string>("google.clientSecret"),
      callbackURL: configService.get<string>("google.callbackUrl"),
      scope: ["email", "profile"],
    });
  }

  // Called after Google sends back user info
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    // Pull out the fields we need
    const googleUser = {
      googleId: profile.id,
      email: profile.emails?.[0]?.value ?? "",
      displayName: profile.displayName ?? "",
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };

    done(null, googleUser);
  }
}
