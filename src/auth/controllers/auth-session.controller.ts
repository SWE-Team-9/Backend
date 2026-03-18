import { Controller, Post, Body, UseGuards, Request, HttpCode, Get, Delete, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiBearerAuth, ApiTags, ApiParam } from '@nestjs/swagger';
import { TokenService } from '../services/token.service';
import { SessionManagementService } from '../services/session-management.service';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RequestEmailChangeDto } from '../dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from '../dto/confirm-email-change.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthSessionController {
  constructor(
    private tokenService: TokenService,
    private sessionManagement: SessionManagementService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Token Refresh
  // ────────────────────────────────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'New tokens generated' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    const session = await this.sessionManagement.getSessionByToken(
      refreshTokenDto.refreshToken,
    );

    if (!session || new Date() > session.expiresAt) {
      throw new Error('Invalid or expired refresh token');
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: session.userId,
      role: 'USER',
    });
    const { rawToken: newRefreshToken, tokenHash } = this.tokenService.createRefreshToken();

    // Update session with new refresh token
    await this.sessionManagement.deleteSessionByToken(
      refreshTokenDto.refreshToken,
    );
    await this.sessionManagement.createSession(
      session.userId,
      session.deviceInfo,
      session.ipAddress,
      tokenHash,
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600, // 1 hour
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Session Management
  // ────────────────────────────────────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active sessions for the current user' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveSessions(@Request() req: any) {
    const userId = req.user.sub;
    const sessions = await this.sessionManagement.getActiveSessionsByUserId(userId);
    return {
      sessions,
      count: sessions.length,
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({ name: 'sessionId', description: 'Session ID to revoke' })
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(@Param('sessionId') sessionId: string, @Request() req: any) {
    const userId = req.user.sub;
    await this.sessionManagement.deleteSessionById(sessionId, userId);
    return { message: 'Session revoked successfully' };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from all devices (delete all sessions)' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Request() req: any) {
    const userId = req.user.sub; // From JWT payload

    // Delete all sessions for the user
    await this.sessionManagement.deleteUserSessions(userId);

    return { message: 'Logged out from all devices' };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Email Change Flow
  // ────────────────────────────────────────────────────────────────────────────

  @Post('email-change/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request an email change' })
  @ApiResponse({ status: 200, description: 'Email change request created. Check your current email for verification link.' })
  @ApiResponse({ status: 400, description: 'Email already in use or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async requestEmailChange(
    @Body() requestEmailChangeDto: RequestEmailChangeDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub;
    const token = await this.sessionManagement.requestEmailChange(
      userId,
      requestEmailChangeDto.newEmail,
    );

    return {
      message: 'Email change request created. Verification link sent to your current email.',
      // In production, send token via email
      // token should NOT be returned here but sent via email
    };
  }

  @Post('email-change/confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm email change with verification token' })
  @ApiResponse({ status: 200, description: 'Email changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async confirmEmailChange(
    @Body() confirmEmailChangeDto: ConfirmEmailChangeDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub;
    const user = await this.sessionManagement.confirmEmailChange(
      userId,
      confirmEmailChangeDto.token,
    );

    return {
      message: 'Email changed successfully',
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }
}
