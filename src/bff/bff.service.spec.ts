import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { BffService } from "./bff.service";
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

// ─── Mock factories ───────────────────────────────────────────────────────────

const mockMe = {
  id: "user-1",
  email: "test@example.com",
  display_name: "Test User",
  handle: "testuser",
  avatar_url: null,
  is_verified: true,
  account_type: "LISTENER",
  system_role: "USER",
  subscription_tier: "FREE",
};

const mockProfile = {
  id: "user-1",
  user_id: "user-1",
  handle: "testuser",
  display_name: "Test User",
  bio: null,
  avatarUrl: null,
  coverPhotoUrl: null,
  account_type: "LISTENER",
  visibility: "PUBLIC",
  is_private: false,
  followers_count: 0,
  following_count: 0,
  track_count: 0,
  favorite_genres: [],
  social_links: [],
};

const mockSession = {
  currentTrack: null,
  positionSeconds: 0,
  isPlaying: false,
  volume: 0.8,
  queue: [],
  shuffle: false,
  repeatMode: "OFF",
};

const mockEntitlements = {
  planCode: "FREE",
  isPremium: false,
  uploadLimit: 3,
  uploadedCount: 0,
  remainingUploads: 3,
  canUpload: true,
  adsEnabled: true,
  canDownload: false,
  supportLevel: "community",
  trialEnd: null,
};

const mockSubscription = {
  userId: "user-1",
  subscriptionType: "FREE",
  uploadLimit: 3,
  uploadedTracks: 0,
  remainingUploads: 3,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  paymentMethodSummary: null,
  perks: { adFree: false, offlineListening: false },
};

// ─── Mock services ────────────────────────────────────────────────────────────

const mockAuthService = { getMe: jest.fn() };
const mockUsersService = { getMyProfile: jest.fn(), getProfileByHandle: jest.fn() };
const mockNotificationsService = {
  getNotifications: jest.fn(),
  getUnreadCountForUser: jest.fn(),
  getPreferences: jest.fn(),
};
const mockPlayerService = { getSession: jest.fn() };
const mockEntitlementsService = { getUserEntitlements: jest.fn() };
const mockSubscriptionsService = { getMySubscription: jest.fn() };
const mockMessagesService = { getUnreadCount: jest.fn() };
const mockSocialService = {};
const mockTracksService = { getUserTracks: jest.fn() };
const mockPrisma = {
  userFollow: { findUnique: jest.fn() },
  userBlock: { findUnique: jest.fn() },
  like: { findMany: jest.fn() },
  repost: { findMany: jest.fn() },
  track: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  userSession: { count: jest.fn() },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BffService", () => {
  let service: BffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BffService,
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: EntitlementsService, useValue: mockEntitlementsService },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
        { provide: MessagesService, useValue: mockMessagesService },
        { provide: SocialService, useValue: mockSocialService },
        { provide: TracksService, useValue: mockTracksService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BffService>(BffService);
    jest.clearAllMocks();
  });

  // ── bootstrap ───────────────────────────────────────────────────────────────

  describe("getBootstrap", () => {
    it("returns aggregated shell data for an authenticated user", async () => {
      mockAuthService.getMe.mockResolvedValue(mockMe);
      mockUsersService.getMyProfile.mockResolvedValue(mockProfile);
      mockNotificationsService.getNotifications.mockResolvedValue({
        notifications: [],
        total: 0,
      });
      mockNotificationsService.getUnreadCountForUser.mockResolvedValue(3);
      mockMessagesService.getUnreadCount.mockResolvedValue(1);
      mockPlayerService.getSession.mockResolvedValue(mockSession);
      mockEntitlementsService.getUserEntitlements.mockResolvedValue(mockEntitlements);
      mockSubscriptionsService.getMySubscription.mockResolvedValue(mockSubscription);

      const result = await service.getBootstrap("user-1");

      expect(result.me).toEqual(mockMe);
      expect(result.notifications.unreadCount).toBe(3);
      expect(result.messages.unreadCount).toBe(1);
      expect(result.player.session).toEqual(mockSession);
      expect(result.entitlements).toEqual(mockEntitlements);
      expect(result.subscription).toEqual(mockSubscription);
    });

    it("still returns me when auxiliary services fail", async () => {
      mockAuthService.getMe.mockResolvedValue(mockMe);
      mockUsersService.getMyProfile.mockRejectedValue(new Error("db error"));
      mockNotificationsService.getNotifications.mockRejectedValue(new Error("err"));
      mockNotificationsService.getUnreadCountForUser.mockResolvedValue(0);
      mockMessagesService.getUnreadCount.mockRejectedValue(new Error("err"));
      mockPlayerService.getSession.mockRejectedValue(new Error("err"));
      mockEntitlementsService.getUserEntitlements.mockRejectedValue(new Error("err"));
      mockSubscriptionsService.getMySubscription.mockRejectedValue(new Error("err"));

      const result = await service.getBootstrap("user-1");

      expect(result.me).toEqual(mockMe);
      expect(result.profile).toBeNull();
      expect(result.notifications.unreadCount).toBe(0);
      expect(result.messages.unreadCount).toBe(0);
    });

    it("propagates error when getMe fails (session invalid)", async () => {
      mockAuthService.getMe.mockRejectedValue(new Error("Unauthorized"));

      await expect(service.getBootstrap("bad-user")).rejects.toThrow();
    });
  });

  // ── profile page ────────────────────────────────────────────────────────────

  describe("getProfilePageData", () => {
    it("returns public profile data for a guest (no requesterId)", async () => {
      mockUsersService.getProfileByHandle.mockResolvedValue(mockProfile);
      mockTracksService.getUserTracks.mockResolvedValue({
        tracks: [],
        totalTracks: 0,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getProfilePageData("testuser", undefined, 1, 10);

      expect(result.viewer).toBeNull();
      expect(result.relationship).toBeNull();
      expect(result.viewerInteractions).toBeNull();
      expect(result.permissions.canEditProfile).toBe(false);
    });

    it("includes viewer state for authenticated requester", async () => {
      mockUsersService.getProfileByHandle.mockResolvedValue(mockProfile);
      mockTracksService.getUserTracks.mockResolvedValue({ tracks: [], totalTracks: 0 });
      mockPrisma.userFollow.findUnique.mockResolvedValue(null);
      mockPrisma.userBlock.findUnique.mockResolvedValue(null);
      mockPrisma.track.findMany.mockResolvedValue([]);
      mockPrisma.like.findMany.mockResolvedValue([]);
      mockPrisma.repost.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "viewer-1",
        profile: {
          handle: "viewer",
          displayName: "Viewer",
          avatarUrl: null,
          accountType: "LISTENER",
        },
      });

      const result = await service.getProfilePageData("testuser", "viewer-1", 1, 10);

      expect(result.viewer).not.toBeNull();
      expect(result.relationship).not.toBeNull();
      expect(result.relationship!.isFollowing).toBe(false);
      expect(result.viewerInteractions).not.toBeNull();
    });

    it("returns canEditProfile=true for the profile owner", async () => {
      mockUsersService.getProfileByHandle.mockResolvedValue(mockProfile);
      mockTracksService.getUserTracks.mockResolvedValue({ tracks: [], totalTracks: 0 });
      mockPrisma.userFollow.findUnique.mockResolvedValue(null);
      mockPrisma.userBlock.findUnique.mockResolvedValue(null);
      mockPrisma.track.findMany.mockResolvedValue([]);
      mockPrisma.like.findMany.mockResolvedValue([]);
      mockPrisma.repost.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        profile: {
          handle: "testuser",
          displayName: "Test User",
          avatarUrl: null,
          accountType: "LISTENER",
        },
      });

      const result = await service.getProfilePageData("testuser", "user-1", 1, 10);

      expect(result.permissions.canEditProfile).toBe(true);
      expect(result.permissions.canViewPrivateTracks).toBe(true);
    });

    it("marks isBlocked when viewer has blocked the target", async () => {
      mockUsersService.getProfileByHandle.mockResolvedValue(mockProfile);
      mockTracksService.getUserTracks.mockResolvedValue({ tracks: [], totalTracks: 0 });
      mockPrisma.userFollow.findUnique.mockResolvedValue(null);
      mockPrisma.userBlock.findUnique
        .mockResolvedValueOnce({ blockerId: "viewer-1" }) // viewer blocked target
        .mockResolvedValueOnce(null);
      mockPrisma.track.findMany.mockResolvedValue([]);
      mockPrisma.like.findMany.mockResolvedValue([]);
      mockPrisma.repost.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "viewer-1",
        profile: {
          handle: "viewer",
          displayName: "Viewer",
          avatarUrl: null,
          accountType: "LISTENER",
        },
      });

      const result = await service.getProfilePageData("testuser", "viewer-1", 1, 10);

      expect(result.relationship!.isBlocked).toBe(true);
      expect(result.relationship!.canMessage).toBe(false);
    });

    it("throws NotFoundException when profile does not exist", async () => {
      mockUsersService.getProfileByHandle.mockRejectedValue(
        new NotFoundException("Profile not found."),
      );

      await expect(service.getProfilePageData("ghost", undefined, 1, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── settings page ────────────────────────────────────────────────────────────

  describe("getSettingsPageData", () => {
    it("returns all settings data for an authenticated user", async () => {
      mockAuthService.getMe.mockResolvedValue(mockMe);
      mockUsersService.getMyProfile.mockResolvedValue(mockProfile);
      mockSubscriptionsService.getMySubscription.mockResolvedValue(mockSubscription);
      mockEntitlementsService.getUserEntitlements.mockResolvedValue(mockEntitlements);
      mockNotificationsService.getPreferences.mockResolvedValue({
        likes: true,
        comments: true,
        follows: true,
        reposts: true,
      });
      mockPrisma.userSession.count.mockResolvedValue(2);

      const result = await service.getSettingsPageData("user-1");

      expect(result.me).toEqual(mockMe);
      expect(result.subscription).toEqual(mockSubscription);
      expect(result.entitlements).toEqual(mockEntitlements);
      expect(result.notificationPreferences).toEqual({
        likes: true,
        comments: true,
        follows: true,
        reposts: true,
      });
      expect(result.sessionsSummary.count).toBe(2);
    });

    it("does not expose raw session tokens or payment secrets", async () => {
      mockAuthService.getMe.mockResolvedValue(mockMe);
      mockUsersService.getMyProfile.mockResolvedValue(mockProfile);
      mockSubscriptionsService.getMySubscription.mockResolvedValue(mockSubscription);
      mockEntitlementsService.getUserEntitlements.mockResolvedValue(mockEntitlements);
      mockNotificationsService.getPreferences.mockResolvedValue({});
      mockPrisma.userSession.count.mockResolvedValue(1);

      const result = await service.getSettingsPageData("user-1");

      // Only a session count is returned, not raw session tokens
      expect(typeof result.sessionsSummary.count).toBe("number");
      expect((result as any).sessions).toBeUndefined();
      expect((result as any).rawTokens).toBeUndefined();
    });

    it("propagates error when auth fails", async () => {
      mockAuthService.getMe.mockRejectedValue(new Error("Unauthorized"));

      await expect(service.getSettingsPageData("bad-user")).rejects.toThrow();
    });
  });
});
