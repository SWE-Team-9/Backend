import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-google-oauth20";

// TODO: Member 3

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID ?? "TODO",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "TODO",
      callbackURL: process.env.GOOGLE_CALLBACK_URL ?? "TODO",
      scope: ["email", "profile"],
    });
  }
}
