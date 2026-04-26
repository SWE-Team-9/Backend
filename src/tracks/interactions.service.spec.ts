import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TrackStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { InteractionsGateway } from "./interactions.gateway";
import { InteractionsService } from "./interactions.service";
import { EventEmitter2 } from "@nestjs/event-emitter";

describe("InteractionsService", () => {
  let service: InteractionsService;

  const prismaMock = {
    track: {
      findUnique: jest.fn(),
    },
    like: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    repost: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const gatewayMock = {
    emitTrackInteraction: jest.fn(),
  } as unknown as InteractionsGateway;

  const finishedTrack = {
    id: "track-uuid",
    uploaderId: "uploader-uuid",
    status: TrackStatus.FINISHED,
    title: "Test Track",
    slug: "test-track",
    coverArtUrl: null,
    publishedAt: null,
    _count: {
      likes: 0,
      reposts: 0,
    },
  };

  const eventEmitterMock = { emit: jest.fn() } as unknown as EventEmitter2;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InteractionsService(prismaMock, gatewayMock, eventEmitterMock);
  });

  describe("likeTrack", () => {
    it("should like a track successfully", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.like.create as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
        trackId: "track-uuid",
      });

      await service.likeTrack("listener-uuid", "track-uuid");

      expect(prismaMock.like.create).toHaveBeenCalledWith({
        data: {
          userId: "listener-uuid",
          trackId: "track-uuid",
        },
      });
      expect(gatewayMock.emitTrackInteraction).toHaveBeenCalledWith(
        "track-uuid",
        expect.objectContaining({
          type: "LIKE",
          userId: "listener-uuid",
          trackId: "track-uuid",
        }),
      );
    });

    it("should throw ForbiddenException when trying to like own track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        uploaderId: "listener-uuid",
      });

      await expect(service.likeTrack("listener-uuid", "track-uuid")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.like.create).not.toHaveBeenCalled();
    });

    it("should throw ConflictException when track status is not FINISHED", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      await expect(service.likeTrack("listener-uuid", "track-uuid")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.like.create).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.likeTrack("listener-uuid", "missing-track")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.like.create).not.toHaveBeenCalled();
    });

    it("should throw ConflictException when the track is already liked", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.findUnique as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
      });

      await expect(service.likeTrack("listener-uuid", "track-uuid")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.like.create).not.toHaveBeenCalled();
    });

    it("should reflect incremented global likes count in engagement lists", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.like.create as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
        trackId: "track-uuid",
      });
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([1, []]);

      await service.likeTrack("listener-uuid", "track-uuid");
      const result = await service.getTrackLikers("track-uuid", 1, 20);

      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });
  });

  describe("getInteractionStatus", () => {
    it("should return isLiked and isReposted flags", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        { userId: "listener-uuid" },
        null,
      ]);

      await expect(
        service.getInteractionStatus("listener-uuid", "track-uuid"),
      ).resolves.toEqual({
        isLiked: true,
        isReposted: false,
      });
    });
  });

  describe("createComment", () => {
    it("should create comment and emit COMMENT interaction event", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.comment.create as jest.Mock).mockResolvedValue({
        id: "comment-uuid",
        content: "Great track",
        timestampAt: 42,
        user: {
          id: "listener-uuid",
          profile: {
            displayName: "Listener",
            avatarUrl: "https://cdn.example.com/avatar.png",
          },
        },
      });

      const result = await service.createComment(
        "listener-uuid",
        "track-uuid",
        "Great track",
        42,
      );

      expect(result).toEqual({
        id: "comment-uuid",
        content: "Great track",
        timestampAt: 42,
        user: {
          userId: "listener-uuid",
          displayName: "Listener",
          avatarUrl: "https://cdn.example.com/avatar.png",
        },
      });

      expect(gatewayMock.emitTrackInteraction).toHaveBeenCalledWith(
        "track-uuid",
        expect.objectContaining({
          type: "COMMENT",
          userId: "listener-uuid",
          trackId: "track-uuid",
          commentId: "comment-uuid",
          timestampAt: 42,
        }),
      );
    });

    it("should throw BadRequestException when timestampAt is negative", async () => {
      await expect(
        service.createComment("listener-uuid", "track-uuid", "Hello", -1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createComment("listener-uuid", "missing-track", "Hello", 0),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should handle user with null profile", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.comment.create as jest.Mock).mockResolvedValue({
        id: "c-1",
        content: "Nice",
        timestampAt: 0,
        user: { id: "u-1", profile: null },
      });

      const result = await service.createComment("u-1", "track-uuid", "Nice", 0);
      expect(result.user.displayName).toBeNull();
      expect(result.user.avatarUrl).toBeNull();
    });
  });

  // ── unlikeTrack ──────────────────────────────────────────────────────────
  describe("unlikeTrack", () => {
    it("should unlike a track successfully", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unlikeTrack("listener-uuid", "track-uuid");

      expect(prismaMock.like.deleteMany).toHaveBeenCalledWith({
        where: { userId: "listener-uuid", trackId: "track-uuid" },
      });
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.unlikeTrack("listener-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should throw NotFoundException when like does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.unlikeTrack("listener-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── repostTrack ──────────────────────────────────────────────────────────
  describe("repostTrack", () => {
    it("should repost a track successfully", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.repost.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.repost.create as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
        trackId: "track-uuid",
      });

      await service.repostTrack("listener-uuid", "track-uuid");

      expect(prismaMock.repost.create).toHaveBeenCalledWith({
        data: { userId: "listener-uuid", trackId: "track-uuid" },
      });
      expect(gatewayMock.emitTrackInteraction).toHaveBeenCalledWith(
        "track-uuid",
        expect.objectContaining({ type: "REPOST" }),
      );
    });

    it("should throw ForbiddenException when reposting own track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        uploaderId: "listener-uuid",
      });

      await expect(
        service.repostTrack("listener-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("should throw ConflictException when track is not FINISHED", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      await expect(
        service.repostTrack("listener-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw ConflictException when already reposted", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.repost.findUnique as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
      });

      await expect(
        service.repostTrack("listener-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.repostTrack("listener-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should reflect incremented global reposts count in engagement lists", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.repost.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.repost.create as jest.Mock).mockResolvedValue({
        userId: "listener-uuid",
        trackId: "track-uuid",
      });
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([1, []]);

      await service.repostTrack("listener-uuid", "track-uuid");
      const result = await service.getTrackReposters("track-uuid", 1, 20);

      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });
  });

  // ── unrepostTrack ────────────────────────────────────────────────────────
  describe("unrepostTrack", () => {
    it("should unrepost a track successfully", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.repost.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unrepostTrack("listener-uuid", "track-uuid");

      expect(prismaMock.repost.deleteMany).toHaveBeenCalledWith({
        where: { userId: "listener-uuid", trackId: "track-uuid" },
      });
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.unrepostTrack("listener-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should throw NotFoundException when repost does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.repost.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.unrepostTrack("listener-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getMyLikedTracks ─────────────────────────────────────────────────────
  describe("getMyLikedTracks", () => {
    const mockLikeItem = {
      createdAt: new Date("2026-04-01"),
      track: {
        id: "trk-1",
        title: "Hit Song",
        slug: "hit-song",
        coverArtUrl: null,
        publishedAt: new Date("2026-03-01"),
        _count: { likes: 10, reposts: 5 },
      },
    };

    it("should return paginated liked tracks", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([1, [mockLikeItem]]);

      const result = await service.getMyLikedTracks("user-1", 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].track.likesCount).toBe(10);
      expect(result.items[0].track.repostsCount).toBe(5);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it("should return empty items when no likes", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([0, []]);

      const result = await service.getMyLikedTracks("user-1");
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it("should cap limit at 100", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([0, []]);

      const result = await service.getMyLikedTracks("user-1", 1, 999);
      expect(result.pagination.limit).toBe(100);
    });
  });

  // ── getMyRepostedTracks ──────────────────────────────────────────────────
  describe("getMyRepostedTracks", () => {
    const mockRepostItem = {
      createdAt: new Date("2026-04-02"),
      track: {
        id: "trk-2",
        title: "Cool Beat",
        slug: "cool-beat",
        coverArtUrl: "https://cdn.example.com/cover.jpg",
        publishedAt: new Date("2026-03-15"),
        _count: { likes: 3, reposts: 1 },
      },
    };

    it("should return paginated reposted tracks", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([1, [mockRepostItem]]);

      const result = await service.getMyRepostedTracks("user-1", 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].track.id).toBe("trk-2");
      expect(result.items[0].track.likesCount).toBe(3);
    });

    it("should return empty items when no reposts", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([0, []]);

      const result = await service.getMyRepostedTracks("user-1");
      expect(result.items).toEqual([]);
    });
  });

  // ── getTrackLikers ───────────────────────────────────────────────────────
  describe("getTrackLikers", () => {
    it("should return users who liked the track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            createdAt: new Date("2026-04-01"),
            user: {
              id: "liker-1",
              profile: { displayName: "Fan One", avatarUrl: null },
            },
          },
        ],
      ]);

      const result = await service.getTrackLikers("track-uuid", 1, 20);

      expect(result.track.id).toBe("track-uuid");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].user.userId).toBe("liker-1");
      expect(result.items[0].user.displayName).toBe("Fan One");
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getTrackLikers("missing", 1, 20),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should handle user with null profile", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [{ createdAt: new Date(), user: { id: "u-1", profile: null } }],
      ]);

      const result = await service.getTrackLikers("track-uuid", 1, 20);
      expect(result.items[0].user.displayName).toBeNull();
      expect(result.items[0].user.avatarUrl).toBeNull();
    });

    it("should fetch likers with pagination", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        25,
        [
          {
            createdAt: new Date("2026-04-03"),
            user: {
              id: "liker-11",
              profile: { displayName: "Liker Eleven", avatarUrl: null },
            },
          },
        ],
      ]);

      const result = await service.getTrackLikers("track-uuid", 2, 10);

      expect(prismaMock.like.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { trackId: "track-uuid" },
          orderBy: { createdAt: "desc" },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });
  });

  // ── getTrackReposters ────────────────────────────────────────────────────
  describe("getTrackReposters", () => {
    it("should return users who reposted the track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            createdAt: new Date("2026-04-01"),
            user: {
              id: "reposter-1",
              profile: { displayName: "Fan Two", avatarUrl: "https://cdn.example.com/av.jpg" },
            },
          },
        ],
      ]);

      const result = await service.getTrackReposters("track-uuid", 1, 20);

      expect(result.track.id).toBe("track-uuid");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].user.userId).toBe("reposter-1");
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getTrackReposters("missing", 1, 20),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should fetch reposters with pagination", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        21,
        [
          {
            createdAt: new Date("2026-04-05"),
            user: {
              id: "reposter-11",
              profile: { displayName: "Reposter Eleven", avatarUrl: null },
            },
          },
        ],
      ]);

      const result = await service.getTrackReposters("track-uuid", 2, 10);

      expect(prismaMock.repost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { trackId: "track-uuid" },
          orderBy: { createdAt: "desc" },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 21,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });
  });

  // ── getTrackComments ─────────────────────────────────────────────────────
  describe("getTrackComments", () => {
    it("should return comments ordered by timestampAt", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.comment.findMany as jest.Mock).mockResolvedValue([
        {
          id: "c-1",
          content: "Nice intro",
          timestampAt: 5,
          user: {
            id: "u-1",
            profile: { displayName: "User A", avatarUrl: null },
          },
        },
        {
          id: "c-2",
          content: "Great drop",
          timestampAt: 42,
          user: {
            id: "u-2",
            profile: { displayName: "User B", avatarUrl: "https://cdn.example.com/b.jpg" },
          },
        },
      ]);

      const result = await service.getTrackComments("track-uuid");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("c-1");
      expect(result[0].user.userId).toBe("u-1");
      expect(result[1].timestampAt).toBe(42);
    });

    it("should return empty array when no comments", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.comment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getTrackComments("track-uuid");
      expect(result).toEqual([]);
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getTrackComments("missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── deleteComment ──────────────────────────────────────────────────────
  describe("deleteComment", () => {
    it("should delete a comment successfully", async () => {
      (prismaMock.comment.findUnique as jest.Mock).mockResolvedValue({
        id: "comment-uuid",
        userId: "listener-uuid",
      });
      (prismaMock.comment.delete as jest.Mock).mockResolvedValue({});

      const result = await service.deleteComment("listener-uuid", "comment-uuid");

      expect(result).toEqual({ message: "Comment deleted successfully" });
      expect(prismaMock.comment.delete).toHaveBeenCalledWith({
        where: { id: "comment-uuid" },
      });
    });

    it("should throw NotFoundException when comment does not exist", async () => {
      (prismaMock.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteComment("listener-uuid", "missing-comment"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should throw ForbiddenException when deleting another user's comment", async () => {
      (prismaMock.comment.findUnique as jest.Mock).mockResolvedValue({
        id: "comment-uuid",
        userId: "other-user-uuid",
      });

      await expect(
        service.deleteComment("listener-uuid", "comment-uuid"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });
  });

  // ── getInteractionStatus (extended) ──────────────────────────────────────
  describe("getInteractionStatus", () => {
    it("should return isLiked and isReposted flags", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        { userId: "listener-uuid" },
        null,
      ]);

      await expect(
        service.getInteractionStatus("listener-uuid", "track-uuid"),
      ).resolves.toEqual({
        isLiked: true,
        isReposted: false,
      });
    });

    it("should return false for both when no interactions", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([null, null]);

      const result = await service.getInteractionStatus("listener-uuid", "track-uuid");
      expect(result).toEqual({ isLiked: false, isReposted: false });
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getInteractionStatus("listener-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── pagination edge cases ────────────────────────────────────────────────
  describe("pagination edge cases", () => {
    it("should throw BadRequestException for page < 1", async () => {
      await expect(
        service.getMyLikedTracks("user-1", 0, 20),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should throw BadRequestException for non-integer page", async () => {
      await expect(
        service.getMyLikedTracks("user-1", 1.5, 20),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should throw BadRequestException for limit < 1", async () => {
      await expect(
        service.getMyLikedTracks("user-1", 1, 0),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should compute hasNextPage and hasPreviousPage correctly", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([50, []]);

      const result = await service.getMyLikedTracks("user-1", 2, 20);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPreviousPage).toBe(true);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ── handlePrismaWriteError ───────────────────────────────────────────────
  describe("handlePrismaWriteError (via likeTrack race condition)", () => {
    it("should re-throw non-Prisma errors from create", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.like.create as jest.Mock).mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(
        service.likeTrack("listener-uuid", "track-uuid"),
      ).rejects.toThrow("connection lost");
    });
  });
});
