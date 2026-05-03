import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { MessageSentEvent } from '../messages/messages.service';

export interface TrackLikedEvent {
  trackId: string;
  actorId: string;
  ownerId: string;
}

export interface TrackCommentedEvent {
  trackId: string;
  actorId: string;
  ownerId: string;
  commentId: string;
}

export interface TrackRepostedEvent {
  trackId: string;
  actorId: string;
  ownerId: string;
}

export interface UserFollowedEvent {
  followerId: string;
  followingId: string;
}

export interface ReportCreatedEvent {
  reportId: string;
  reporterId: string;
  category: string;
  targetType: string;
  targetId?: string;
  targetTitle?: string;
}

interface DebounceEntry {
  timer: NodeJS.Timeout;
  count: number;
  firstEventData: unknown;
}

@Injectable()
export class NotificationsListener {
  private readonly debounceMap = new Map<string, DebounceEntry>();
  private readonly DEBOUNCE_MS = 10_000; // 10 seconds
  private readonly BATCH_THRESHOLD = 5;
  private readonly REPORT_DEBOUNCE_MS = 60_000; // 60 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Track liked ─────────────────────────────────────────────────────────────

  @OnEvent('track.liked')
  async handleTrackLiked(event: TrackLikedEvent): Promise<void> {
    if (event.actorId === event.ownerId) return;

    const prefs = await this.getPrefs(event.ownerId);
    if (!prefs.likes) return;

    const key = `like:${event.ownerId}:${event.trackId}`;
    this.debounceNotification(key, this.DEBOUNCE_MS, async (count: number) => {
      const message = count > 1 ? `${count} new likes on your track` : undefined;

      await this.notificationsService.createNotification({
        recipientId: event.ownerId,
        actorId: count === 1 ? event.actorId : undefined,
        entityType: 'TRACK',
        eventType: 'LIKE',
        trackId: event.trackId,
        metadata: message ? { batchMessage: message, count } : undefined,
      });
    });
  }

  // ─── Track commented ─────────────────────────────────────────────────────────

  @OnEvent('track.commented')
  async handleTrackCommented(event: TrackCommentedEvent): Promise<void> {
    if (event.actorId === event.ownerId) return;

    const prefs = await this.getPrefs(event.ownerId);
    if (!prefs.comments) return;

    await this.notificationsService.createNotification({
      recipientId: event.ownerId,
      actorId: event.actorId,
      entityType: 'COMMENT',
      eventType: 'COMMENT',
      trackId: event.trackId,
      commentId: event.commentId,
    });
  }

  // ─── Track reposted ──────────────────────────────────────────────────────────

  @OnEvent('track.reposted')
  async handleTrackReposted(event: TrackRepostedEvent): Promise<void> {
    if (event.actorId === event.ownerId) return;

    const prefs = await this.getPrefs(event.ownerId);
    if (!prefs.reposts) return;

    await this.notificationsService.createNotification({
      recipientId: event.ownerId,
      actorId: event.actorId,
      entityType: 'TRACK',
      eventType: 'REPOST',
      trackId: event.trackId,
    });
  }

  // ─── User followed ───────────────────────────────────────────────────────────

  @OnEvent('user.followed')
  async handleUserFollowed(event: UserFollowedEvent): Promise<void> {
    const prefs = await this.getPrefs(event.followingId);
    if (!prefs.follows) return;

    await this.notificationsService.createNotification({
      recipientId: event.followingId,
      actorId: event.followerId,
      entityType: 'USER',
      eventType: 'FOLLOW',
    });
  }

  // ─── Report created ──────────────────────────────────────────────────────────

  @OnEvent('report.created')
  async handleReportCreated(event: ReportCreatedEvent): Promise<void> {
    const key = `report:${event.targetType}:${event.reportId}`;

    this.debounceNotification(key, this.REPORT_DEBOUNCE_MS, async (count: number) => {
      const reportedUserId = await this.findReportedUserId(event);

      // Notify all ADMIN + MODERATOR users
      const admins = await this.prisma.user.findMany({
        where: {
          systemRole: { in: ['ADMIN', 'MODERATOR'] },
          deletedAt: null,
          ...(reportedUserId ? { id: { not: reportedUserId } } : {}),
        },
        select: { id: true },
      });

      const message =
        count >= this.BATCH_THRESHOLD
          ? `${count} new reports for ${event.targetType.toLowerCase()} '${event.targetTitle ?? 'content'}'`
          : `New report: ${event.category} on ${event.targetType.toLowerCase()} '${event.targetTitle ?? 'content'}'`;

      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.createNotification({
            recipientId: admin.id,
            actorId: event.reporterId,
            entityType: 'USER',
            eventType: 'REPORT_RESOLVED',
            metadata: {
              batchMessage: message,
              count,
              reportId: event.reportId,
            },
          }),
        ),
      );
    });
  }

  private async findReportedUserId(event: ReportCreatedEvent): Promise<string | undefined> {
    if (!event.targetId) return undefined;

    if (event.targetType === 'USER') {
      return event.targetId;
    }

    if (event.targetType === 'TRACK') {
      const track = await this.prisma.track.findUnique({
        where: { id: event.targetId },
        select: { uploaderId: true },
      });
      return track?.uploaderId;
    }

    if (event.targetType === 'COMMENT') {
      const comment = await this.prisma.comment.findUnique({
        where: { id: event.targetId },
        select: { userId: true },
      });
      return comment?.userId;
    }

    if (event.targetType === 'PLAYLIST') {
      const playlist = await this.prisma.playlist.findUnique({
        where: { id: event.targetId },
        select: { ownerId: true },
      });
      return playlist?.ownerId;
    }

    return undefined;
  }

  // ─── Debounce helper ─────────────────────────────────────────────────────────

  private debounceNotification(
    key: string,
    delayMs: number,
    handler: (count: number) => Promise<void>,
  ): void {
    const existing = this.debounceMap.get(key);

    if (existing) {
      existing.count += 1;
      clearTimeout(existing.timer);
    }

    const entry: DebounceEntry = {
      count: existing ? existing.count : 1,
      firstEventData: null,
      timer: setTimeout(async () => {
        const finalEntry = this.debounceMap.get(key);
        this.debounceMap.delete(key);
        if (finalEntry) {
          await handler(finalEntry.count);
        }
      }, delayMs),
    };

    this.debounceMap.set(key, entry);
  }

  // ─── Message sent ─────────────────────────────────────────────────────────────

  @OnEvent('message.sent')
  async handleMessageSent(event: MessageSentEvent): Promise<void> {
    const senderName = event.senderName ?? 'Someone';
    const preview = event.messagePreview;
    const body =
      event.messageType === 'TRACK_SHARE'
        ? `${senderName} shared a track with you`
        : event.messageType === 'PLAYLIST_SHARE'
          ? `${senderName} shared a playlist with you`
          : preview
            ? `${senderName}: ${preview}`
            : `${senderName} sent you a message`;

    await this.notificationsService.createNotification({
      recipientId: event.receiverId,
      actorId: event.senderId,
      entityType: 'USER',
      eventType: 'MESSAGE',
      messageId: event.messageId,
      metadata: {
        senderName,
        messagePreview: preview,
        messageType: event.messageType,
        conversationId: event.conversationId,
        fcmBody: body,
      },
    });
  }

  // ─── Get preferences ─────────────────────────────────────────────────────────

  private async getPrefs(userId: string) {
    const prefs = await this.prisma.userNotificationPreference.findUnique({
      where: { userId },
      select: { likes: true, comments: true, follows: true, reposts: true },
    });
    return prefs ?? { likes: true, comments: true, follows: true, reposts: true };
  }
}
