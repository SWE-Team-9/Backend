import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, Profile } from "passport-google-oauth20";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(private prisma: PrismaService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ["email", "profile"],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
  ) {
    const { id: googleId, displayName, emails, photos } = profile;

    // Get or create user based on email
    const email = emails?.[0]?.value;
    if (!email) {
      throw new Error("No email provided by Google");
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Create new user if doesn't exist
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          isVerified: true,
          dateOfBirth: new Date("1990-01-01"), // Placeholder
          gender: "PREFER_NOT_TO_SAY",
          profile: {
            create: {
              handle:
                email.split("@")[0] +
                "_" +
                Math.random().toString(36).slice(2, 9),
              displayName: displayName || email.split("@")[0],
            },
          },
          authIdentities: {
            create: {
              provider: "GOOGLE",
              providerUserId: googleId,
              providerEmail: email,
              accessTokenEncrypted: accessToken,
              refreshTokenEncrypted: refreshToken || null,
            },
          },
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      googleId: googleId,
    };
  }
}
