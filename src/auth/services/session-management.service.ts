import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class SessionManagementService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new session for a user
   * @param userId - The user ID
   * @param deviceInfo - Device/browser information
   * @param ipAddress - Client IP address
   * @param refreshToken - Hashed refresh token
   * @returns The created session
   */
  async createSession(
    userId: string,
    deviceInfo: string,
    ipAddress: string,
    refreshToken: string,
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    return this.prisma.session.create({
      data: {
        userId,
        deviceInfo,
        ipAddress,
        refreshToken,
        expiresAt,
      },
    });
  }

  /**
   * Delete a session by refresh token
   * @param refreshToken - The refresh token to identify the session
   */
  async deleteSessionByToken(refreshToken: string) {
    return this.prisma.session.deleteMany({
      where: {
        refreshToken,
      },
    });
  }

  /**
   * Delete all sessions for a user
   * @param userId - The user ID
   */
  async deleteUserSessions(userId: string) {
    return this.prisma.session.deleteMany({
      where: {
        userId,
      },
    });
  }

  /**
   * Get a session by refresh token
   * @param refreshToken - The refresh token
   */
  async getSessionByToken(refreshToken: string) {
    return this.prisma.session.findFirst({
      where: {
        refreshToken,
      },
    });
  }

  /**
   * Get all active sessions for a user
   * @param userId - The user ID
   */
  async getActiveSessionsByUserId(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        expiresAt: {
          gt: new Date(), // Only sessions that haven't expired
        },
      },
      select: {
        id: true,
        deviceInfo: true,
        ipAddress: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Delete a specific session by session ID
   * @param sessionId - The session ID
   * @param userId - The user ID (for authorization check)
   */
  async deleteSessionById(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new BadRequestException('Session not found or unauthorized');
    }

    return this.prisma.session.delete({
      where: { id: sessionId },
    });
  }

  /**
   * Request an email change
   * @param userId - The user ID
   * @param newEmail - The new email address
   * @returns The raw token to send in verification email
   */
  async requestEmailChange(userId: string, newEmail: string) {
    // Check if new email is already in use
    const existingUser = await this.prisma.user.findUnique({
      where: { email: newEmail },
    });

    if (existingUser) {
      throw new BadRequestException('Email is already in use');
    }

    // Generate token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);

    // Expire in 24 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Create email change request
    await this.prisma.emailChangeRequest.create({
      data: {
        userId,
        newEmail,
        tokenHash,
        expiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Confirm email change with token
   * @param userId - The user ID
   * @param token - The verification token
   */
  async confirmEmailChange(userId: string, token: string) {
    const tokenHash = this.hashToken(token);

    // Find email change request
    const emailChangeRequest = await this.prisma.emailChangeRequest.findFirst({
      where: {
        userId,
        tokenHash,
      },
    });

    if (!emailChangeRequest) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (new Date() > emailChangeRequest.expiresAt) {
      throw new BadRequestException('Token has expired');
    }

    if (emailChangeRequest.consumedAt) {
      throw new BadRequestException('Token has already been used');
    }

    // Update user email and mark request as consumed
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { email: emailChangeRequest.newEmail },
    });

    // Mark request as consumed
    await this.prisma.emailChangeRequest.update({
      where: { id: emailChangeRequest.id },
      data: { consumedAt: new Date() },
    });

    return user;
  }

  /**
   * SHA-256 hash helper
   * @param value - The value to hash
   */
  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
