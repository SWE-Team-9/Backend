import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TrackStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PlayerService } from "./player.service";

describe("PlayerService", () => {
  let service: PlayerService;

  const prismaMock = {
    track: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    trackFile: {
      findFirst: jest.fn(),
    },
    playbackProgress: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    playlist: {
      findFirst: jest.fn(),
    },
    playEvent: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    playerSession: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const finishedTrack = {
    id: "track-uuid",
    uploaderId: "uploader-uuid",
    title: "Test Track",
    status: TrackStatus.FINISHED,
    visibility: "PUBLIC",
    accessLevel: "PLAYABLE",
    durationMs: 240000,
  };

  const configMock = {
    get: jest.fn((key: string, fallback?: any) => {
      const map: Record<string, any> = {
        "storage.provider": "s3",
        "storage.localUploadUrl": "http://localhost:3000/uploads",
        "storage.s3Bucket": "test-bucket",
        "storage.s3Region": "eu-north-1",
        "storage.cdnUrl": "",
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlayerService(prismaMock, configMock);
  });

  // ── getPlaybackSource ─────────────────────────────────────────────────
  describe("getPlaybackSource", () => {
    it("should return stream URL for a playable track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: "audio/trk_123.mp3",
      });

      const result = await service.getPlaybackSource("user-uuid", "track-uuid");

      expect(result.trackId).toBe("track-uuid");
      expect(result.streamUrl).toBe(
        "https://test-bucket.s3.eu-north-1.amazonaws.com/audio/trk_123.mp3",
      );
      expect(result.accessState).toBe("PLAYABLE");
      expect(result.expiresAt).toBeDefined();
    });

    it("should throw ConflictException when track is processing", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      await expect(
        service.getPlaybackSource("user-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw NotFoundException when track is not finished", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.FAILED,
      });

      await expect(
        service.getPlaybackSource("user-uuid", "track-uuid"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should throw ForbiddenException for private track not owned by user", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        visibility: "PRIVATE",
      });

      await expect(
        service.getPlaybackSource("other-user", "track-uuid"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("should allow owner to access private track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        visibility: "PRIVATE",
      });
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getPlaybackSource(
        "uploader-uuid",
        "track-uuid",
      );
      expect(result.accessState).toBe("PLAYABLE");
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getPlaybackSource("user-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getPlaybackState ──────────────────────────────────────────────────
  describe("getPlaybackState", () => {
    it("should return PLAYABLE for finished track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );

      const result = await service.getPlaybackState("track-uuid");

      expect(result).toEqual({
        trackId: "track-uuid",
        accessState: "PLAYABLE",
        reason: null,
      });
    });

    it("should return PROCESSING for processing track", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      const result = await service.getPlaybackState("track-uuid");
      expect(result.accessState).toBe("PROCESSING");
      expect(result.reason).toBeTruthy();
    });

    it("should return BLOCKED for blocked access level", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        accessLevel: "BLOCKED",
      });

      const result = await service.getPlaybackState("track-uuid");
      expect(result.accessState).toBe("BLOCKED");
    });

    it("should return PREVIEW for preview access level", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        accessLevel: "PREVIEW",
      });

      const result = await service.getPlaybackState("track-uuid");
      expect(result.accessState).toBe("PREVIEW");
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getPlaybackState("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── registerProgress ──────────────────────────────────────────────────
  describe("registerProgress", () => {
    it("should save progress successfully", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.playbackProgress.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.registerProgress(
        "user-uuid",
        "track-uuid",
        97,
        240,
        false,
      );

      expect(result).toEqual({
        message: "Playback progress saved successfully",
        trackId: "track-uuid",
        positionSeconds: 97,
      });
      expect(prismaMock.playbackProgress.upsert).toHaveBeenCalledWith({
        where: {
          userId_trackId: { userId: "user-uuid", trackId: "track-uuid" },
        },
        update: {
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
        create: {
          userId: "user-uuid",
          trackId: "track-uuid",
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
      });
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.registerProgress("user-uuid", "missing", 97, 240, false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── markPlayed ────────────────────────────────────────────────────────
  describe("markPlayed", () => {
    it("should record play event and return count", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.playEvent.create as jest.Mock).mockResolvedValue({});
      (prismaMock.playEvent.count as jest.Mock).mockResolvedValue(4821);

      const result = await service.markPlayed("user-uuid", "track-uuid");

      expect(result).toEqual({
        message: "Play event recorded successfully",
        trackId: "track-uuid",
        playCount: 4821,
      });
    });

    it("should record playlist context when provided", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.playlist.findFirst as jest.Mock).mockResolvedValue({ id: "pl-1" });
      (prismaMock.playEvent.create as jest.Mock).mockResolvedValue({});
      (prismaMock.playEvent.count as jest.Mock).mockResolvedValue(1);

      await service.markPlayed("user-uuid", "track-uuid", "pl-1");

      expect(prismaMock.playEvent.create).toHaveBeenCalledWith({
        data: {
          userId: "user-uuid",
          trackId: "track-uuid",
          playlistId: "pl-1",
          source: "TRACK",
          deviceType: "WEB",
        },
      });
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markPlayed("user-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getRecentlyPlayed ─────────────────────────────────────────────────
  describe("getRecentlyPlayed", () => {
    it("should return recently played tracks", async () => {
      (prismaMock.playEvent.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            trackId: "track-1",
            startedAt: new Date("2026-03-07T17:15:00Z"),
            track: {
              id: "track-1",
              title: "Layali",
              uploader: {
                id: "usr-1",
                profile: { displayName: "Ahmed Hassan" },
              },
            },
          },
        ])
        .mockResolvedValueOnce([{ trackId: "track-1" }]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([
        { trackId: "track-1", positionSeconds: 97 },
      ]);

      const result = await service.getRecentlyPlayed("user-uuid", 1, 20);

      expect(result.total).toBe(1);
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0].title).toBe("Layali");
      expect(result.tracks[0].lastPositionSeconds).toBe(97);
    });

    it("should return empty when no play history", async () => {
      (prismaMock.playEvent.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRecentlyPlayed("user-uuid");
      expect(result.tracks).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────
  describe("getHistory", () => {
    it("should return paginated listening history", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            trackId: "track-1",
            startedAt: new Date("2026-03-07T17:15:00Z"),
            track: { title: "Layali", durationMs: 240000 },
          },
        ],
      ]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([
        {
          trackId: "track-1",
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
      ]);

      const result = await service.getHistory("user-uuid", 1, 20);

      expect(result.total).toBe(1);
      expect(result.history).toHaveLength(1);
      expect(result.history[0].positionSeconds).toBe(97);
    });

    it("should use track durationMs when no progress exists", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            trackId: "track-1",
            startedAt: new Date(),
            track: { title: "Test", durationMs: 180000 },
          },
        ],
      ]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getHistory("user-uuid", 1, 20);

      expect(result.history[0].durationSeconds).toBe(180);
      expect(result.history[0].positionSeconds).toBe(0);
      expect(result.history[0].isCompleted).toBe(false);
    });
  });

  // ── clearHistory ──────────────────────────────────────────────────────
  describe("clearHistory", () => {
    it("should clear all play events for user", async () => {
      (prismaMock.playEvent.deleteMany as jest.Mock).mockResolvedValue({
        count: 10,
      });

      const result = await service.clearHistory("user-uuid");

      expect(result).toEqual({
        message: "Listening history cleared successfully",
      });
      expect(prismaMock.playEvent.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-uuid" },
      });
    });
  });

  // ── getResumePosition ─────────────────────────────────────────────────
  describe("getResumePosition", () => {
    it("should return resume position when progress exists", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.playbackProgress.findUnique as jest.Mock).mockResolvedValue({
        positionSeconds: 97,
      });

      const result = await service.getResumePosition("user-uuid", "track-uuid");

      expect(result).toEqual({
        trackId: "track-uuid",
        resumePositionSeconds: 97,
      });
    });

    it("should return 0 when no progress exists", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.playbackProgress.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getResumePosition("user-uuid", "track-uuid");

      expect(result.resumePositionSeconds).toBe(0);
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getResumePosition("user-uuid", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getSession ────────────────────────────────────────────────────────
  describe("getSession", () => {
    it("should return default session when none exists", async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getSession("user-uuid");

      expect(result).toEqual({
        currentTrack: null,
        positionSeconds: 0,
        isPlaying: false,
        volume: 0.8,
        queue: [],
        shuffle: false,
        repeatMode: "OFF",
      });
    });

    it("should return session with queue tracks", async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        currentTrackId: "track-1",
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queueTrackIds: ["track-2", "track-3"],
        shuffle: false,
        repeatMode: "OFF",
        currentTrack: { id: "track-1", title: "Layali" },
      });
      (prismaMock.track.findMany as jest.Mock).mockResolvedValue([
        { id: "track-2", title: "Sahar" },
        { id: "track-3", title: "Nostalgia Mix" },
      ]);

      const result = await service.getSession("user-uuid");

      expect(result.currentTrack).toEqual({
        trackId: "track-1",
        title: "Layali",
      });
      expect(result.isPlaying).toBe(true);
      expect(result.queue).toHaveLength(2);
      expect(result.queue[0].title).toBe("Sahar");
    });

    it("should return empty queue for session with no queue tracks", async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        currentTrackId: null,
        positionSeconds: 0,
        isPlaying: false,
        volume: 0.5,
        queueTrackIds: [],
        shuffle: false,
        repeatMode: "OFF",
        currentTrack: null,
      });

      const result = await service.getSession("user-uuid");

      expect(result.currentTrack).toBeNull();
      expect(result.queue).toEqual([]);
    });
  });

  // ── updateSession ─────────────────────────────────────────────────────
  describe("updateSession", () => {
    it("should upsert player session", async () => {
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.updateSession("user-uuid", {
        currentTrackId: "track-1",
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queueTrackIds: ["track-2"],
      });

      expect(result).toEqual({
        message: "Player session updated successfully",
      });
      expect(prismaMock.playerSession.upsert).toHaveBeenCalled();
    });

    it("should use defaults when body fields are missing", async () => {
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.updateSession("user-uuid", {});

      expect(result.message).toBe("Player session updated successfully");
    });
  });

  // ── getTrackPreview ───────────────────────────────────────────────────
  describe("getTrackPreview", () => {
    it("should return preview URL", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: "previews/trk_555.mp3",
      });

      const result = await service.getTrackPreview("track-uuid");

      expect(result).toEqual({
        trackId: "track-uuid",
        previewUrl: "previews/trk_555.mp3",
        previewDurationSeconds: 30,
        accessState: "PREVIEW",
      });
    });

    it("should return null previewUrl when no preview file", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(
        finishedTrack,
      );
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getTrackPreview("track-uuid");

      expect(result.previewUrl).toBeNull();
    });

    it("should throw NotFoundException when track does not exist", async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getTrackPreview("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
