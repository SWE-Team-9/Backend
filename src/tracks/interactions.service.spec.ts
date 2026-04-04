import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TrackStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { InteractionsGateway } from "./interactions.gateway";
import { InteractionsService } from "./interactions.service";

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
    },
    repost: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InteractionsService(prismaMock, gatewayMock);
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
  });
});
