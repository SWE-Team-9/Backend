import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Profile, Strategy, VerifyCallback } from "passport-google-oauth20";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.get<string>("google.clientId"),
      clientSecret: configService.get<string>("google.clientSecret"),
      callbackURL: GoogleStrategy.getGoogleCallbackUrl(configService),
      scope: ["email", "profile"],
    });
  }

  private static getGoogleCallbackUrl(configService: ConfigService): string {
    const callbackUrl = configService.get<string>("GOOGLE_CALLBACK_URL");

    if (!callbackUrl) {
      throw new InternalServerErrorException("GOOGLE_CALLBACK_URL is not configured.");
    }

    return callbackUrl;
  }

  // Called after Google sends back user info
  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
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
