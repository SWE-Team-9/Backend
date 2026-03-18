import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../constants/auth.constants";

@Injectable()
export class CookieService {
  constructor(private readonly configService: ConfigService) {}

  setAuthCookies(params: {
    response: Response;
    accessToken: string;
    refreshToken: string;
    rememberMe?: boolean;
  }) {
    const { response, accessToken, refreshToken, rememberMe = false } = params;
    const isSecureCookie = this.configService.get<boolean>(
      "security.authCookieSecure",
      false,
    );

    response.cookie(ACCESS_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "strict",
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: "/",
    });

    response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "strict",
      maxAge:
        (rememberMe
          ? REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS
          : REFRESH_TOKEN_TTL_SECONDS) * 1000,
      path: "/",
    });
  }

  clearAuthCookies(response: Response) {
    const isSecureCookie = this.configService.get<boolean>(
      "security.authCookieSecure",
      false,
    );

    response.cookie(ACCESS_COOKIE_NAME, "", {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "strict",
      maxAge: 0,
      path: "/",
    });

    response.cookie(REFRESH_COOKIE_NAME, "", {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "strict",
      maxAge: 0,
      path: "/",
    });
  }
}
