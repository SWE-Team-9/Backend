import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { NotificationEntityType, NotificationEventType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsQueryDto } from "./dto/notifications-query.dto";
import { NotificationPreferencesDto } from "./dto/notification-preferences.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";

export interface INotificationsGateway {
  emitToUser(userId: string, event: string, payload: unknown): void;
}

export interface CreateNotificationData {
  recipientId: string;
  actorId?: string;
  entityType: NotificationEntityType;
  eventType: NotificationEventType;
  trackId?: string;
  playlistId?: string;
  commentId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private gateway?: INotificationsGateway;

  constructor(private readonly prisma: PrismaService) {}

  setGateway(gateway: INotificationsGateway): void {
    this.gateway = gateway;
  }

  // ─── Internal: create notification ──────────────────────────────────────────

  async createNotification(data: CreateNotificationData): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        recipientId: data.recipientId,
        actorId: data.actorId ?? null,
        entityType: data.entityType,
        eventType: data.eventType,
        trackId: data.trackId ?? null,
        playlistId: data.playlistId ?? null,
        commentId: data.commentId ?? null,
        messageId: data.messageId ?? null,
        metadata: data.metadata
          ? (data.metadata as import("@prisma/client").Prisma.InputJsonValue)
          : undefined,
      },
      select: { id: true, eventType: true, entityType: true, createdAt: true },
    });

    const unreadCount = await this.getUnreadCountForUser(data.recipientId);

    this.gateway?.emitToUser(data.recipientId, "new_notification", {
      type: "NEW_NOTIFICATION",
      notificationId: notification.id,
      eventType: notification.eventType,
      entityType: notification.entityType,
      currentUnreadCount: unreadCount,
    });
  }

  // ─── Get notifications ───────────────────────────────────────────────────────

  async getNotifications(userId: string, query: NotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      recipientId: userId,
      ...(query.type ? { eventType: query.type } : {}),
      ...(query.isRead === true ? { readAt: { not: null } } : {}),
      ...(query.isRead === false ? { readAt: null } : {}),
    };

    const [total, notifications] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          eventType: true,
          entityType: true,
          actorId: true,
          trackId: true,
          playlistId: true,
          commentId: true,
          messageId: true,
          metadata: true,
          readAt: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              profile: {
                select: { displayName: true, handle: true, avatarUrl: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.eventType.toLowerCase(),
        message: this.buildMessage(n),
        actorId: n.actorId,
        actorDisplayName: n.actor?.profile?.displayName ?? null,
        actorHandle: n.actor?.profile?.handle ?? null,
        actorAvatarUrl: n.actor?.profile?.avatarUrl ?? null,
        entityType: n.entityType.toLowerCase(),
        entityId:
          n.trackId ?? n.playlistId ?? n.commentId ?? n.messageId ?? null,
        isRead: n.readAt !== null,
        createdAt: n.createdAt,
      })),
    };
  }

  private buildMessage(n: {
    eventType: NotificationEventType;
    actor: {
      id: string;
      profile: {
        displayName: string;
        handle: string;
        avatarUrl: string | null;
      } | null;
    } | null;
    metadata?: unknown;
  }): string {
    const name = n.actor?.profile?.displayName ?? "Someone";
    const meta = n.metadata as Record<string, unknown> | null | undefined;
    switch (n.eventType) {
      case "LIKE":
        return `${name} liked your track`;
      case "REPOST":
        return `${name} reposted your track`;
      case "COMMENT":
        return `${name} commented on your track`;
      case "FOLLOW":
        return `${name} started following you`;
      case "MESSAGE":
        return `${name} sent you a message`;
      case "REPORT_RESOLVED":
        return "Your report has been resolved";
      case "SUBSCRIPTION":
        return "Your subscription was updated";
      case "ACCOUNT_SUSPENDED": {
        const until = (meta?.["suspendedUntil"] as string) ?? null;
        return until
          ? `Your account has been suspended until ${new Date(until).toLocaleDateString()}`
          : "Your account has been suspended";
      }
      case "ACCOUNT_BANNED":
        return "Your account has been permanently banned";
      case "ACCOUNT_RESTORED":
        return "Your account has been restored";
      default:
        return (
          (meta?.["batchMessage"] as string) ?? "You have a new notification"
        );
    }
  }

  // ─── Unread count ────────────────────────────────────────────────────────────

  async getUnreadCount(userId: string) {
    const count = await this.getUnreadCountForUser(userId);
    return { count };
  }

  async getUnreadCountForUser(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId: userId, readAt: null },
    });
  }

  // ─── Mark as read ────────────────────────────────────────────────────────────

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, recipientId: true },
    });

    if (!notification) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found.",
      });
    }

    if (notification.recipientId !== userId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Not your notification.",
      });
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    const unreadCount = await this.getUnreadCountForUser(userId);
    this.gateway?.emitToUser(userId, "unread_count_updated", { unreadCount });

    return { message: "Notification marked as read" };
  }

  // ─── Mark all read ───────────────────────────────────────────────────────────

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    this.gateway?.emitToUser(userId, "unread_count_updated", {
      unreadCount: 0,
    });

    return { message: "All notifications marked as read" };
  }

  // ─── Delete notification ─────────────────────────────────────────────────────

  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, recipientId: true },
    });

    if (!notification) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found.",
      });
    }

    if (notification.recipientId !== userId) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Not your notification.",
      });
    }

    await this.prisma.notification.delete({ where: { id: notificationId } });
    return { message: "Notification deleted" };
  }

  // ─── Preferences ─────────────────────────────────────────────────────────────

  async getPreferences(userId: string) {
    const prefs = await this.prisma.userNotificationPreference.findUnique({
      where: { userId },
      select: { likes: true, comments: true, follows: true, reposts: true },
    });

    return (
      prefs ?? { likes: true, comments: true, follows: true, reposts: true }
    );
  }

  async updatePreferences(userId: string, dto: NotificationPreferencesDto) {
    await this.prisma.userNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        likes: dto.likes ?? true,
        comments: dto.comments ?? true,
        follows: dto.follows ?? true,
        reposts: dto.reposts ?? true,
      },
      update: {
        ...(dto.likes !== undefined ? { likes: dto.likes } : {}),
        ...(dto.comments !== undefined ? { comments: dto.comments } : {}),
        ...(dto.follows !== undefined ? { follows: dto.follows } : {}),
        ...(dto.reposts !== undefined ? { reposts: dto.reposts } : {}),
      },
    });

    return { message: "Notification preferences updated" };
  }

  // ─── Push device ─────────────────────────────────────────────────────────────

  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    // Upsert by pushToken to avoid duplicates
    const existing = await this.prisma.userDevice.findFirst({
      where: { userId, pushToken: dto.deviceToken },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.userDevice.update({
        where: { id: existing.id },
        data: { isActive: true, lastSeenAt: new Date() },
      });
    } else {
      await this.prisma.userDevice.create({
        data: {
          userId,
          platform: dto.platform,
          pushToken: dto.deviceToken,
          isActive: true,
          lastSeenAt: new Date(),
        },
      });
    }

    return { message: "Device registered for push notifications" };
  }

  async removeDevice(userId: string, deviceId: string) {
    const device = await this.prisma.userDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, userId: true },
    });

    if (!device || device.userId !== userId) {
      throw new NotFoundException({
        code: "DEVICE_NOT_FOUND",
        message: "Device not found.",
      });
    }

    await this.prisma.userDevice.update({
      where: { id: deviceId },
      data: { isActive: false },
    });

    return { message: "Device removed successfully" };
  }
}
