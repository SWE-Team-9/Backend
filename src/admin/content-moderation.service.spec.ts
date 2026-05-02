import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ContentModerationService } from "./content-moderation.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const mockPrisma = {
  track: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  comment: { findUnique: jest.fn(), update: jest.fn() },
  playlist: { findUnique: jest.fn(), update: jest.fn() },
  report: { updateMany: jest.fn() },
  moderationReport: { findUnique: jest.fn(), updateMany: jest.fn() },
  moderationAction: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = {
  createNotification: jest.fn(),
};

describe("ContentModerationService", () => {
  let service: ContentModerationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentModerationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<ContentModerationService>(ContentModerationService);
    jest.clearAllMocks();
    mockPrisma.moderationReport.findUnique.mockResolvedValue(null);
    (mockPrisma.moderationReport as any).update = jest.fn().mockResolvedValue({});
    mockPrisma.report.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.moderationReport.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma));
  });

  // 1. moderateTrack - 404 when track not found
  it("moderateTrack: throws 404 when track does not exist", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.moderateTrack("admin-1", "no-track", {
        moderationState: "HIDDEN",
        reason: "test violation reason here",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 2. moderateTrack - 400 NO_STATE_CHANGE when state is unchanged
  it("moderateTrack: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-1",
      title: "My Track",
      uploaderId: "user-1",
      moderationState: "HIDDEN",
    });
    await expect(
      service.moderateTrack("admin-1", "track-1", {
        moderationState: "HIDDEN",
        reason: "test reason no change",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 3. moderateTrack - inserts ModerationAction on success
  it("moderateTrack: inserts ModerationAction when state changes", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-1",
      title: "My Track",
      uploaderId: "user-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-1",
      actionType: "HIDE_TRACK",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    const result = await service.moderateTrack("admin-1", "track-1", {
      moderationState: "HIDDEN",
      reason: "This content violates community guidelines.",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          trackId: "track-1",
          actionType: "HIDE_TRACK",
        }),
      }),
    );
    expect(mockPrisma.track.update).toHaveBeenCalledWith({
      where: { id: "track-1" },
      data: { moderationState: "HIDDEN" },
    });
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "LIKE" }),
    );
    expect(result.action_type).toBe("HIDE_TRACK");
  });

  it("moderateTrack: ignores unknown reportId when linking moderation action", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-legacy",
      title: "Legacy Track",
      uploaderId: "user-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.moderationReport.findUnique.mockResolvedValueOnce(null);
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-legacy",
      actionType: "HIDE_TRACK",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    await service.moderateTrack("admin-1", "track-legacy", {
      moderationState: "HIDDEN",
      reason: "This content violates community guidelines.",
      reportId: "not-a-legacy-moderation-report-id",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: undefined,
        }),
      }),
    );
  });

  it("moderateTrack: does not emit LIKE notification for admin moderation", async () => {
    const uploaderId = "uploader-X";
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-2",
      title: "Other Track",
      uploaderId,
      moderationState: "VISIBLE",
    });
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-2",
      actionType: "REMOVE_TRACK",
      createdAt: new Date(),
    });

    await service.moderateTrack("admin-1", "track-2", {
      moderationState: "REMOVED",
      reason: "Serious policy violation requiring removal.",
    });

    expect(mockPrisma.track.delete).toHaveBeenCalledWith({ where: { id: "track-2" } });
    expect(mockPrisma.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetType: "TRACK",
          targetId: "track-2",
          status: { in: ["PENDING", "UNDER_REVIEW"] },
        }),
        data: expect.objectContaining({
          status: "RESOLVED",
          resolvedBy: "admin-1",
        }),
      }),
    );
    expect(mockPrisma.moderationReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          trackId: "track-2",
          status: { in: ["PENDING", "UNDER_REVIEW"] },
        }),
        data: expect.objectContaining({ status: "RESOLVED" }),
      }),
    );
    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: uploaderId,
          actionType: "REMOVE_TRACK",
        }),
      }),
    );
    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ trackId: "track-2" }),
      }),
    );
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "LIKE" }),
    );
  });

  it("moderateTrack: hard-deletes an already REMOVED track when removal is requested", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-2b",
      title: "Other Track",
      uploaderId: "uploader-X",
      moderationState: "REMOVED",
    });
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-2b",
      actionType: "REMOVE_TRACK",
      createdAt: new Date(),
    });

    await expect(
      service.moderateTrack("admin-1", "track-2b", {
        moderationState: "REMOVED",
        reason: "Policy violation",
      }),
    ).resolves.toMatchObject({ action_type: "REMOVE_TRACK" });
    expect(mockPrisma.track.delete).toHaveBeenCalledWith({ where: { id: "track-2b" } });
  });

  // 5. moderateComment - 404 when comment not found
  it("moderateComment: throws 404 when comment does not exist", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.moderateComment("admin-1", "comment-1", {
        isHidden: true,
        reason: "Comment violates policy",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 6. moderateComment - 400 NO_STATE_CHANGE when state is unchanged
  it("moderateComment: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce({
      id: "comment-1",
      userId: "user-1",
      trackId: "track-1",
      moderationState: "HIDDEN",
    });

    await expect(
      service.moderateComment("admin-1", "comment-1", {
        isHidden: true,
        reason: "No change needed",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 7. moderateComment - success path and notification
  it("moderateComment: updates comment and emits notification", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce({
      id: "comment-1",
      userId: "user-1",
      trackId: "track-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.comment.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-3",
      actionType: "HIDE_COMMENT",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    const result = await service.moderateComment("admin-1", "comment-1", {
      isHidden: true,
      reason: "Comment violates policy",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          commentId: "comment-1",
          actionType: "HIDE_COMMENT",
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "user-1",
        entityType: "COMMENT",
        eventType: "REPORT_RESOLVED",
        metadata: expect.objectContaining({
          batchMessage: expect.stringContaining("comment"),
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "LIKE" }),
    );
    expect(result.action_type).toBe("HIDE_COMMENT");
  });

  it("moderateComment: notifies reporter (not target report-status) when linked moderation report exists", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce({
      id: "comment-2",
      userId: "target-user",
      trackId: "track-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.moderationReport.findUnique
      .mockResolvedValueOnce({ id: "mod-report-1" })
      .mockResolvedValueOnce({
        id: "mod-report-1",
        reporterId: "reporter-user",
        status: "PENDING",
      });
    mockPrisma.comment.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-linked",
      actionType: "HIDE_COMMENT",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    await service.moderateComment("admin-1", "comment-2", {
      isHidden: true,
      reason: "Policy violation",
      reportId: "mod-report-1",
    });

    expect((mockPrisma.moderationReport as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mod-report-1" } }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        recipientId: "target-user",
        eventType: "REPORT_RESOLVED",
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        recipientId: "reporter-user",
        eventType: "REPORT_RESOLVED",
        metadata: expect.objectContaining({
          outcome: "ACTION_TAKEN",
        }),
      }),
    );
  });

  // 8. moderatePlaylist - 404 when playlist not found
  it("moderatePlaylist: throws 404 when playlist does not exist", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.moderatePlaylist("admin-1", "playlist-1", {
        moderationState: "HIDDEN",
        reason: "Playlist violates policy",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 9. moderatePlaylist - 400 NO_STATE_CHANGE when state is unchanged
  it("moderatePlaylist: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "playlist-1",
      title: "My Playlist",
      ownerId: "user-1",
      moderationState: "HIDDEN",
    });

    await expect(
      service.moderatePlaylist("admin-1", "playlist-1", {
        moderationState: "HIDDEN",
        reason: "No change needed",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 10. moderatePlaylist - success path and notification
  it("moderatePlaylist: updates playlist and emits notification", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "playlist-1",
      title: "My Playlist",
      ownerId: "user-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.playlist.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-4",
      actionType: "REMOVE_PLAYLIST",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    const result = await service.moderatePlaylist("admin-1", "playlist-1", {
      moderationState: "REMOVED",
      reason: "Playlist violates policy",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          playlistId: "playlist-1",
          actionType: "REMOVE_PLAYLIST",
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "user-1",
        entityType: "PLAYLIST",
        eventType: "REPORT_RESOLVED",
      }),
    );
    expect(result.action_type).toBe("REMOVE_PLAYLIST");
  });

  it("moderatePlaylist: succeeds even if notification dispatch fails", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "playlist-2",
      title: "Mix",
      ownerId: "user-2",
      moderationState: "VISIBLE",
    });
    mockPrisma.playlist.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-5",
      actionType: "HIDE_PLAYLIST",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockRejectedValueOnce(
      new Error("Notification provider timeout"),
    );

    await expect(
      service.moderatePlaylist("admin-1", "playlist-2", {
        moderationState: "HIDDEN",
        reason: "Policy violation",
      }),
    ).resolves.toMatchObject({ action_type: "HIDE_PLAYLIST" });
  });
});
