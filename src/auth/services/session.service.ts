import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

// How long sessions last
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Create a new session with a device record
  async createSession(params: {
    userId: string;
    refreshTokenHash: string;
    ipAddress: string;
    userAgent: string;
    rememberMe?: boolean;
  }): Promise<string> {
    // Find or create a device for this user + user-agent combo
    const deviceName = this.parseDeviceName(params.userAgent);

    let device = await this.prisma.userDevice.findFirst({
      where: {
        userId: params.userId,
        deviceName,
        isActive: true,
      },
    });

    if (!device) {
      device = await this.prisma.userDevice.create({
        data: {
          userId: params.userId,
          platform: "WEB",
          deviceName,
          isActive: true,
        },
      });
    }

    // Update device last seen
    await this.prisma.userDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    // Calculate expiry
    const ttl = params.rememberMe ? THIRTY_DAYS_MS : SEVEN_DAYS_MS;
    const expiresAt = new Date(Date.now() + ttl);

    // Create the session
    const session = await this.prisma.userSession.create({
      data: {
        userId: params.userId,
        deviceId: device.id,
        refreshTokenHash: params.refreshTokenHash,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent?.substring(0, 512) || null,
        expiresAt,
      },
    });

    return session.id;
  }

  // Find a session by its refresh token hash (must be active)
  async findActiveSessionByHash(hash: string) {
    return this.prisma.userSession.findFirst({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: true,
        device: true,
      },
    });
  }

  // Check if a token hash belongs to a revoked session (reuse detection)
  // If someone replays an old refresh token, it'll match a revoked session
  async wasTokenReusedFromRevokedSession(hash: string) {
    return this.prisma.userSession.findFirst({
      where: {
        refreshTokenHash: hash,
        revokedAt: { not: null },
      },
    });
  }

  // Rotate the refresh token (revoke old session, create new one)
  // This keeps the old hash in the DB so we can detect token reuse
  async rotateRefreshToken(oldSession: {
    id: string;
    userId: string;
    deviceId: string;
    ipAddress: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }, newHash: string): Promise<string> {
    // Revoke the old session (keeps old hash in DB for reuse detection)
    await this.prisma.userSession.update({
      where: { id: oldSession.id },
      data: { revokedAt: new Date() },
    });

    // Create a new session with the new hash
    const newSession = await this.prisma.userSession.create({
      data: {
        userId: oldSession.userId,
        deviceId: oldSession.deviceId,
        refreshTokenHash: newHash,
        ipAddress: oldSession.ipAddress,
        userAgent: oldSession.userAgent,
        expiresAt: oldSession.expiresAt,
      },
    });

    return newSession.id;
  }

  // Revoke a single session
  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  // Revoke all sessions for a user, return count
  async revokeAllUserSessions(userId: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  // Revoke all sessions EXCEPT a specific one
  async revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        id: { not: keepSessionId },
      },
      data: { revokedAt: new Date() },
    });
  }

  // Get all active sessions for a user
  async getActiveSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { device: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // Find a specific session owned by a user
  async findSessionByIdAndUser(sessionId: string, userId: string) {
    return this.prisma.userSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
    });
  }

  // Simple user-agent to device name parser
  private parseDeviceName(userAgent: string): string {
    if (!userAgent) return "Unknown Device";

    if (userAgent.includes("Chrome")) return "Chrome Browser";
    if (userAgent.includes("Firefox")) return "Firefox Browser";
    if (userAgent.includes("Safari")) return "Safari Browser";
    if (userAgent.includes("Edge")) return "Edge Browser";
    if (userAgent.includes("okhttp")) return "Android App";
    if (userAgent.includes("Darwin")) return "iOS App";

    return "Unknown Device";
  }
}
