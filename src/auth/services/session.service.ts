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
}
