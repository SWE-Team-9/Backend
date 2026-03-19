import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";

// Cookie names
const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

// TTLs in milliseconds
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CookieService {
  private readonly isSecure: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isSecure =
      this.configService.get<boolean>("security.authCookieSecure") ?? false;
  }

  // Set both access and refresh token cookies on the response
  setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    rememberMe = false,
  ): void {
    // Access token cookie — short-lived
    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: this.isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: FIFTEEN_MINUTES,
    });

    // Refresh token cookie — longer-lived
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: rememberMe ? THIRTY_DAYS : SEVEN_DAYS,
    });
  }

  // Clear both auth cookies (used on logout)
  clearAuthCookies(res: Response): void {
    res.cookie(ACCESS_COOKIE, "", {
      httpOnly: true,
      secure: this.isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    res.cookie(REFRESH_COOKIE, "", {
      httpOnly: true,
      secure: this.isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
