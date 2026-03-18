import { Controller, Get, UseGuards, Request, Res } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { TokenService } from "./services/token.service";
import { SessionManagementService } from "./services/session-management.service";

@ApiTags("Auth")
@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private tokenService: TokenService,
    private sessionManagement: SessionManagementService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Google OAuth Initiation
  // ────────────────────────────────────────────────────────────────────────────

  @Get("google")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Initiate Google OAuth flow" })
  @ApiResponse({ status: 302, description: "Redirects to Google login" })
  initiateGoogleAuth() {
    // This is handled by the Google Passport guard
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Google OAuth Callback
  // ────────────────────────────────────────────────────────────────────────────

  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Google OAuth callback handler" })
  @ApiResponse({ status: 200, description: "Login successful, token returned" })
  @ApiResponse({ status: 401, description: "Authentication failed" })
  async googleCallback(@Request() req: any, @Res() res: Response) {
    // User is attached by Passport and GoogleStrategy.validate()
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    // Generate tokens
    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      role: "USER",
    });

    const { rawToken: refreshTokenRaw, tokenHash } =
      this.tokenService.createRefreshToken();

    // Create session in Session table
    await this.sessionManagement.createSession(
      user.id,
      req.headers["user-agent"] || "unknown",
      req.ip || req.connection.remoteAddress || "unknown",
      tokenHash,
    );

    // Return tokens to frontend
    return res.json({
      accessToken,
      refreshToken: refreshTokenRaw,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  }
}
