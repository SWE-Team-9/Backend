import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  async createSession(params: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<{ sessionId: string }> {
    const userDevice = await this.db.userDevice.create({
      data: {
        userId: params.userId,
        platform: "WEB",
        deviceName: params.userAgent ?? null,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    const session = await this.db.userSession.create({
      data: {
        userId: params.userId,
        deviceId: userDevice.id,
        refreshTokenHash: params.refreshTokenHash,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        expiresAt: params.expiresAt,
      },
      select: { id: true },
    });

    return { sessionId: session.id };
  }

  async revokeSessionByRefreshHash(refreshTokenHash: string): Promise<void> {
    await this.db.userSession.updateMany({
      where: {
        refreshTokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async getActiveSessionByRefreshHash(refreshTokenHash: string) {
    return this.db.userSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
      },
    });
  }

  async rotateSessionRefreshToken(params: {
    sessionId: string;
    newRefreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.db.userSession.update({
      where: { id: params.sessionId },
      data: {
        refreshTokenHash: params.newRefreshTokenHash,
        expiresAt: params.expiresAt,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
      },
    });
  }

  async listActiveUserSessions(userId: string) {
    return this.db.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        expiresAt: true,
        createdAt: true,
        device: {
          select: {
            platform: true,
            deviceName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeUserSessionById(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const result = await this.db.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return result.count > 0;
  }
}
