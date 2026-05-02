import { Injectable } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { UsersService } from "../users/users.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PlayerService } from "../player/player.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { MessagesService } from "../messages/messages.service";
import { SocialService } from "../social/social.service";
import { TracksService } from "../tracks/tracks.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BffService {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly playerService: PlayerService,
    private readonly entitlementsService: EntitlementsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly messagesService: MessagesService,
    private readonly socialService: SocialService,
    private readonly tracksService: TracksService,
    private readonly prisma: PrismaService,
  ) {}

  // ── GET /app/bootstrap ──────────────────────────────────────────────────────
  // Returns all data needed for the authenticated app shell in a single round-trip.
  // Fails fast with 401 when the session is invalid — the caller handles redirect.

  async getBootstrap(userId: string) {
    const [
      me,
      profile,
      notificationsResult,
      messagesUnread,
      playerSession,
      entitlements,
      subscription,
    ] = await Promise.all([
      this.authService.getMe(userId),
      this.usersService.getMyProfile(userId).catch(() => null),
      this.notificationsService
        .getNotifications(userId, { page: 1, limit: 10 })
        .catch(() => ({ notifications: [], total: 0 })),
      this.messagesService.getUnreadCount(userId).catch(() => 0),
      this.playerService.getSession(userId).catch(() => null),
      this.entitlementsService.getUserEntitlements(userId).catch(() => null),
      this.subscriptionsService.getMySubscription(userId).catch(() => null),
    ]);

    const unreadCount = await this.notificationsService
      .getUnreadCountForUser(userId)
      .catch(() => 0);

    return {
      me,
      profile: profile
        ? {
            id: (profile as any).id ?? (profile as any).user_id,
            handle: (profile as any).handle,
            displayName: (profile as any).display_name,
            avatarUrl: (profile as any).avatarUrl,
            coverUrl: (profile as any).coverPhotoUrl ?? null,
            accountType: (profile as any).account_type,
            followersCount: (profile as any).followers_count ?? 0,
            followingCount: (profile as any).following_count ?? 0,
            tracksCount: (profile as any).track_count ?? 0,
          }
        : null,
      notifications: {
        unreadCount,
        latest: notificationsResult.notifications,
      },
      messages: {
        unreadCount: messagesUnread,
      },
      player: {
        session: playerSession,
      },
      entitlements,
      subscription,
    };
  }

  // ── GET /pages/profile/:handle ──────────────────────────────────────────────
  // Returns all data needed to render a profile page in one request.
  // Works for guests (viewer = null) and authenticated users.

  async getProfilePageData(
    handle: string,
    requesterId: string | undefined,
    page: number,
    limit: number,
  ) {
    const profile = await this.usersService.getProfileByHandle(handle, requesterId);

    // Private or blocked — return minimal shape; callers redirect/render gated UI
    const isPrivate =
      (profile as any).is_private === true && !(requesterId && (profile as any).id === requesterId);
    if (isPrivate && !(requesterId && (profile as any).id === requesterId)) {
      return {
        viewer: requesterId ? await this.getViewerSummary(requesterId) : null,
        profile,
        relationship: requesterId
          ? await this.getRelationship(requesterId, (profile as any).id ?? (profile as any).user_id)
          : null,
        tracks: { items: [], page: 1, limit, total: 0, hasMore: false },
        counts: {
          followers: (profile as any).followers_count ?? 0,
          following: (profile as any).following_count ?? 0,
          tracks: (profile as any).track_count ?? 0,
        },
        viewerInteractions: null,
        permissions: {
          canEditProfile: false,
          canViewPrivateTracks: false,
        },
      };
    }

    const profileId: string = (profile as any).id ?? (profile as any).user_id;

    const [tracksResult, viewerInteractions, relationship] = await Promise.all([
      this.tracksService
        .getUserTracks(profileId, requesterId, page, limit)
        .catch(() => ({ tracks: [], totalTracks: 0 })),
      requesterId ? this.getViewerInteractions(requesterId, profileId).catch(() => null) : null,
      requesterId ? this.getRelationship(requesterId, profileId).catch(() => null) : null,
    ]);

    const viewer = requesterId ? await this.getViewerSummary(requesterId).catch(() => null) : null;

    const canEditProfile = requesterId === profileId;
    const canViewPrivateTracks = canEditProfile;

    return {
      viewer,
      profile,
      relationship,
      tracks: {
        items: (tracksResult as any).tracks ?? [],
        page,
        limit,
        total: (tracksResult as any).totalTracks ?? 0,
        hasMore: page * limit < ((tracksResult as any).totalTracks ?? 0),
      },
      counts: {
        followers: (profile as any).followers_count ?? 0,
        following: (profile as any).following_count ?? 0,
        tracks: (profile as any).track_count ?? 0,
      },
      viewerInteractions,
      permissions: {
        canEditProfile,
        canViewPrivateTracks,
      },
    };
  }

  // ── GET /pages/settings ─────────────────────────────────────────────────────
  // Returns all data needed to render the settings page in one request.

  async getSettingsPageData(userId: string) {
    const [me, profile, subscription, entitlements, notificationPreferences, sessionCount] =
      await Promise.all([
        this.authService.getMe(userId),
        this.usersService.getMyProfile(userId).catch(() => null),
        this.subscriptionsService.getMySubscription(userId).catch(() => null),
        this.entitlementsService.getUserEntitlements(userId).catch(() => null),
        this.notificationsService.getPreferences(userId).catch(() => null),
        this.prisma.userSession
          .count({
            where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
          })
          .catch(() => 0),
      ]);

    return {
      me,
      profile,
      subscription,
      entitlements,
      notificationPreferences,
      sessionsSummary: { count: sessionCount },
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getViewerSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        profile: {
          select: {
            handle: true,
            displayName: true,
            avatarUrl: true,
            accountType: true,
          },
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      handle: user.profile?.handle ?? null,
      displayName: user.profile?.displayName ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      accountType: user.profile?.accountType ?? "LISTENER",
    };
  }

  private async getRelationship(requesterId: string, targetId: string) {
    if (!requesterId || !targetId || requesterId === targetId) {
      return {
        isFollowing: false,
        isBlocked: false,
        isBlockedBy: false,
        canMessage: requesterId !== targetId,
      };
    }

    const [follow, block, blockedBy] = await Promise.all([
      this.prisma.userFollow.findUnique({
        where: {
          followerId_followingId: {
            followerId: requesterId,
            followingId: targetId,
          },
        },
        select: { followerId: true },
      }),
      this.prisma.userBlock.findUnique({
        where: {
          blockerId_blockedId: { blockerId: requesterId, blockedId: targetId },
        },
        select: { blockerId: true },
      }),
      this.prisma.userBlock.findUnique({
        where: {
          blockerId_blockedId: { blockerId: targetId, blockedId: requesterId },
        },
        select: { blockerId: true },
      }),
    ]);

    const isBlocked = Boolean(block);
    const isBlockedBy = Boolean(blockedBy);

    return {
      isFollowing: Boolean(follow),
      isBlocked,
      isBlockedBy,
      canMessage: !isBlocked && !isBlockedBy,
    };
  }

  private async getViewerInteractions(requesterId: string, profileId: string) {
    const trackIds = await this.prisma.track.findMany({
      where: { uploaderId: profileId, deletedAt: null },
      select: { id: true },
    });
    const ids = trackIds.map((t) => t.id);

    if (ids.length === 0) {
      return { likedTrackIds: [], repostedTrackIds: [] };
    }

    const [likes, reposts] = await Promise.all([
      this.prisma.like.findMany({
        where: { userId: requesterId, trackId: { in: ids }, track: { deletedAt: null } },
        select: { trackId: true },
      }),
      this.prisma.repost.findMany({
        where: { userId: requesterId, trackId: { in: ids } },
        select: { trackId: true },
      }),
    ]);

    return {
      likedTrackIds: likes.map((l) => l.trackId),
      repostedTrackIds: reposts.map((r) => r.trackId),
    };
  }
}
