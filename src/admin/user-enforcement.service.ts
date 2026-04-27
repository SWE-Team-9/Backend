import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  WarnUserDto,
  SuspendUserDto,
  BanUserDto,
  RestoreUserDto,
} from "./dto/user-enforcement.dto";

@Injectable()
export class UserEnforcementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Re-auth helpers ─────────────────────────────────────────────────────────

  private async reVerifyAdminRole(adminId: string): Promise<void> {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { systemRole: true },
    });
    if (!admin || admin.systemRole !== "ADMIN") {
      throw new ForbiddenException({
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Admin role verification failed.",
      });
    }
  }

  private async verifyAdminPassword(
    adminId: string,
    password: string,
  ): Promise<void> {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { passwordHash: true },
    });
    if (!admin?.passwordHash) {
      throw new UnauthorizedException({
        code: "INCORRECT_PASSWORD",
        message: "Cannot verify password.",
      });
    }
    const valid = await argon2.verify(admin.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException({
        code: "INCORRECT_PASSWORD",
        message: "Incorrect password.",
      });
    }
  }

  private async ensureTargetUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accountStatus: true,
        systemRole: true,
        profile: { select: { displayName: true, handle: true } },
      },
    });
    if (!user || user.accountStatus === "DELETED") {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User not found.",
      });
    }
    return user;
  }

  // ─── Warn ────────────────────────────────────────────────────────────────────

  async warnUser(adminId: string, targetUserId: string, dto: WarnUserDto) {
    const target = await this.ensureTargetUser(targetUserId);

    if (target.accountStatus === "BANNED") {
      throw new ConflictException({
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      });
    }

    await this.reVerifyAdminRole(adminId);
    await this.verifyAdminPassword(adminId, dto.currentPassword);

    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId,
        actionType: "WARN_USER",
        notes: dto.reason,
        reportId: dto.reportId ?? null,
      },
    });

    await this.notificationsService.createNotification({
      recipientId: targetUserId,
      actorId: adminId,
      entityType: "USER",
      eventType: "REPORT_RESOLVED",
      metadata: { actionType: "WARN_USER", message: dto.reason },
    });

    return {
      action_id: action.id,
      action_type: action.actionType,
      target_user: {
        id: targetUserId,
        display_name: target.profile?.displayName ?? null,
        handle: target.profile?.handle ?? null,
      },
      admin_id: adminId,
      notes: dto.reason,
      created_at: action.createdAt,
    };
  }

  // ─── Suspend ─────────────────────────────────────────────────────────────────

  async suspendUser(
    adminId: string,
    targetUserId: string,
    dto: SuspendUserDto,
  ) {
    const target = await this.ensureTargetUser(targetUserId);

    if (target.systemRole === "ADMIN" || target.systemRole === "MODERATOR") {
      throw new ForbiddenException({
        code: "CANNOT_SUSPEND_ADMIN",
        message: "Cannot suspend an admin or moderator.",
      });
    }
    if (target.accountStatus === "BANNED") {
      throw new ConflictException({
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      });
    }

    await this.reVerifyAdminRole(adminId);
    await this.verifyAdminPassword(adminId, dto.currentPassword);

    const suspendedUntil = new Date();
    suspendedUntil.setDate(suspendedUntil.getDate() + dto.durationDays);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { accountStatus: "SUSPENDED", suspendedUntil },
      }),
      // Revoke all active sessions
      this.prisma.userSession.deleteMany({ where: { userId: targetUserId } }),
    ]);

    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId,
        actionType: "SUSPEND_USER",
        notes: dto.reason,
        reportId: dto.reportId ?? null,
      },
    });

    await this.notificationsService.createNotification({
      recipientId: targetUserId,
      actorId: adminId,
      entityType: "USER",
      eventType: "REPORT_RESOLVED",
      metadata: { actionType: "SUSPEND_USER", suspendedUntil },
    });

    return {
      action_id: action.id,
      action_type: action.actionType,
      target_user: {
        id: targetUserId,
        display_name: target.profile?.displayName ?? null,
        handle: target.profile?.handle ?? null,
        account_status: "SUSPENDED",
        suspended_until: suspendedUntil,
      },
      admin_id: adminId,
      notes: dto.reason,
      created_at: action.createdAt,
    };
  }

  // ─── Ban ─────────────────────────────────────────────────────────────────────

  async banUser(adminId: string, targetUserId: string, dto: BanUserDto) {
    const target = await this.ensureTargetUser(targetUserId);

    if (target.systemRole === "ADMIN") {
      throw new ForbiddenException({
        code: "CANNOT_BAN_ADMIN",
        message: "Cannot ban an admin.",
      });
    }
    if (target.accountStatus === "BANNED") {
      throw new ConflictException({
        code: "USER_ALREADY_BANNED",
        message: "User is already banned.",
      });
    }

    await this.reVerifyAdminRole(adminId);
    await this.verifyAdminPassword(adminId, dto.currentPassword);

    // Hide all visible tracks and playlists, ban user, revoke sessions atomically
    const txResults = await this.prisma.$transaction([
      this.prisma.track.updateMany({
        where: { uploaderId: targetUserId, moderationState: "VISIBLE" },
        data: { moderationState: "HIDDEN" },
      }),
      this.prisma.playlist.updateMany({
        where: { ownerId: targetUserId, moderationState: "VISIBLE" },
        data: { moderationState: "HIDDEN" },
      }),
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { accountStatus: "BANNED" },
      }),
      this.prisma.userSession.deleteMany({ where: { userId: targetUserId } }),
    ]);
    const tracksResult = txResults[0] as { count: number };
    const playlistsResult = txResults[1] as { count: number };
    void playlistsResult;

    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId,
        actionType: "BAN_USER",
        notes: dto.reason,
        reportId: dto.reportId ?? null,
      },
    });

    await this.notificationsService.createNotification({
      recipientId: targetUserId,
      actorId: adminId,
      entityType: "USER",
      eventType: "REPORT_RESOLVED",
      metadata: { actionType: "BAN_USER" },
    });

    return {
      action_id: action.id,
      action_type: action.actionType,
      target_user: {
        id: targetUserId,
        display_name: target.profile?.displayName ?? null,
        handle: target.profile?.handle ?? null,
        account_status: "BANNED",
      },
      admin_id: adminId,
      notes: dto.reason,
      tracks_hidden: tracksResult.count,
      created_at: action.createdAt,
    };
  }

  // ─── Restore ─────────────────────────────────────────────────────────────────

  async restoreUser(
    adminId: string,
    targetUserId: string,
    dto: RestoreUserDto,
  ) {
    const target = await this.ensureTargetUser(targetUserId);

    if (
      target.accountStatus !== "SUSPENDED" &&
      target.accountStatus !== "BANNED"
    ) {
      throw new ConflictException({
        code: "USER_ALREADY_ACTIVE",
        message: "User is already active.",
      });
    }

    await this.reVerifyAdminRole(adminId);

    let tracksRestored = 0;
    let playlistsRestored = 0;

    if (dto.restoreContent) {
      const [tr, pr] = await this.prisma.$transaction([
        this.prisma.track.updateMany({
          where: { uploaderId: targetUserId, moderationState: "HIDDEN" },
          data: { moderationState: "VISIBLE" },
        }),
        this.prisma.playlist.updateMany({
          where: { ownerId: targetUserId, moderationState: "HIDDEN" },
          data: { moderationState: "VISIBLE" },
        }),
      ]);
      tracksRestored = tr.count;
      playlistsRestored = pr.count;
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: "ACTIVE", suspendedUntil: null },
    });

    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId,
        actionType: "RESTORE_CONTENT",
        notes: dto.reason,
      },
    });

    await this.notificationsService.createNotification({
      recipientId: targetUserId,
      actorId: adminId,
      entityType: "USER",
      eventType: "REPORT_RESOLVED",
      metadata: { actionType: "RESTORE_CONTENT" },
    });

    return {
      action_id: action.id,
      action_type: action.actionType,
      target_user: {
        id: targetUserId,
        display_name: target.profile?.displayName ?? null,
        handle: target.profile?.handle ?? null,
        account_status: "ACTIVE",
      },
      admin_id: adminId,
      notes: dto.reason,
      tracks_restored: tracksRestored,
      playlists_restored: playlistsRestored,
      created_at: action.createdAt,
    };
  }
}
