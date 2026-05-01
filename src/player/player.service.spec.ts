import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PlayerService } from './player.service';

describe('PlayerService', () => {
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
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    playerSession: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    like: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    repost: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const finishedTrack = {
    id: 'track-uuid',
    uploaderId: 'uploader-uuid',
    title: 'Test Track',
    status: TrackStatus.FINISHED,
    visibility: 'PUBLIC',
    accessLevel: 'PLAYABLE',
    durationMs: 240000,
  };

  /** Rich track object that satisfies both findTrackOrFail and buildQueueTrackMetadata shapes. */
  const queueTrackMock = {
    id: 'track-1',
    uploaderId: 'uploader-uuid',
    title: 'Queue Track',
    status: 'FINISHED',
    visibility: 'PUBLIC',
    accessLevel: 'PLAYABLE',
    durationMs: 210000,
    coverArtUrl: null,
    uploader: {
      id: 'uploader-uuid',
      profile: { displayName: 'Test Artist', handle: 'test-artist', avatarUrl: null },
    },
    primaryGenre: { name: 'Electronic' },
  };

  const configMock = {
    get: jest.fn((key: string, fallback?: any) => {
      const map: Record<string, any> = {
        'storage.provider': 's3',
        'storage.localUploadUrl': 'http://localhost:3000/uploads',
        'storage.s3Bucket': 'test-bucket',
        'storage.s3Region': 'eu-north-1',
        'storage.cdnUrl': '',
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;

  /** StorageService mock — S3 mode (isS3 = true), presigned URL returned. */
  const storageMockS3 = {
    isS3: true,
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned?token=abc'),
  } as unknown as StorageService;

  /** StorageService mock — local mode (isS3 = false). */
  const storageMockLocal = {
    isS3: false,
    getPresignedUrl: jest.fn(),
  } as unknown as StorageService;

  /** Default: FREE user (ads enabled). Override with mockResolvedValueOnce for premium tests. */
  const entitlementsMock = {
    getUserEntitlements: jest.fn().mockResolvedValue({
      planCode: 'FREE',
      isPremium: false,
      adsEnabled: true,
      canDownload: false,
      canUpload: true,
      uploadLimit: 3,
      uploadedCount: 0,
      remainingUploads: 3,
      supportLevel: 'community',
      trialEnd: null,
    }),
  } as unknown as EntitlementsService;

  /** Helper: configure entitlements mock to return a premium plan for the next call(s). */
  const setPremiumUser = () => {
    (entitlementsMock.getUserEntitlements as jest.Mock).mockResolvedValueOnce({
      planCode: 'PRO',
      isPremium: true,
      adsEnabled: false,
      canDownload: true,
      canUpload: true,
      uploadLimit: 100,
      uploadedCount: 0,
      remainingUploads: 100,
      supportLevel: 'priority',
      trialEnd: null,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply the default FREE entitlement after clearAllMocks wipes the mockResolvedValue
    (entitlementsMock.getUserEntitlements as jest.Mock).mockResolvedValue({
      planCode: 'FREE',
      isPremium: false,
      adsEnabled: true,
      canDownload: false,
      canUpload: true,
      uploadLimit: 3,
      uploadedCount: 0,
      remainingUploads: 3,
      supportLevel: 'community',
      trialEnd: null,
    });
    // Default: S3 storage mode
    service = new PlayerService(prismaMock, configMock, storageMockS3, entitlementsMock);
  });

  // ── getPlaybackSource ─────────────────────────────────────────────────
  describe('getPlaybackSource', () => {
    it('should return a presigned S3 stream URL for a playable track', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: 'audio/trk_123.mp3',
      });

      const result = await service.getPlaybackSource('user-uuid', 'track-uuid');

      expect(result.trackId).toBe('track-uuid');
      // S3 mode → presigned URL from StorageService
      expect(result.streamUrl).toBe('https://s3.example.com/presigned?token=abc');
      expect(storageMockS3.getPresignedUrl).toHaveBeenCalledWith('audio/trk_123.mp3', 3600);
      expect(result.accessState).toBe('PLAYABLE');
      expect(result.expiresAt).toBeDefined();
    });

    it('should return a local file URL for a playable track in local storage mode', async () => {
      // Use a local-mode config so buildFileUrl returns the local URL
      const localConfigMock = {
        get: jest.fn((key: string, fallback?: any) => {
          const map: Record<string, any> = {
            'storage.provider': 'local',
            'storage.localUploadUrl': 'http://localhost:3000/uploads',
            'storage.s3Bucket': 'test-bucket',
            'storage.s3Region': 'eu-north-1',
            'storage.cdnUrl': '',
          };
          return map[key] ?? fallback;
        }),
      } as unknown as ConfigService;

      // Rebuild service with local storage mock and local config
      const localService = new PlayerService(
        prismaMock,
        localConfigMock,
        storageMockLocal,
        entitlementsMock,
      );

      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: 'audio/trk_123.mp3',
      });

      const result = await localService.getPlaybackSource('user-uuid', 'track-uuid');

      expect(result.trackId).toBe('track-uuid');
      // Local mode → direct URL (protected by the auth middleware in main.ts)
      expect(result.streamUrl).toBe('http://localhost:3000/uploads/audio/trk_123.mp3');
      expect(storageMockLocal.getPresignedUrl).not.toHaveBeenCalled();
      expect(result.accessState).toBe('PLAYABLE');
    });

    it('should throw ConflictException when track is processing', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      await expect(service.getPlaybackSource('user-uuid', 'track-uuid')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('should throw NotFoundException when track is not finished', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.FAILED,
      });

      await expect(service.getPlaybackSource('user-uuid', 'track-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for private track not owned by user', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        visibility: 'PRIVATE',
      });

      await expect(service.getPlaybackSource('other-user', 'track-uuid')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('should allow owner to access private track', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        visibility: 'PRIVATE',
      });
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getPlaybackSource('uploader-uuid', 'track-uuid');
      expect(result.accessState).toBe('PLAYABLE');
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getPlaybackSource('user-uuid', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── getPlaybackState ──────────────────────────────────────────────────
  describe('getPlaybackState', () => {
    it('should return PLAYABLE for finished track', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);

      const result = await service.getPlaybackState('track-uuid');

      expect(result).toEqual({
        trackId: 'track-uuid',
        accessState: 'PLAYABLE',
        reason: null,
      });
    });

    it('should return PROCESSING for processing track', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        status: TrackStatus.PROCESSING,
      });

      const result = await service.getPlaybackState('track-uuid');
      expect(result.accessState).toBe('PROCESSING');
      expect(result.reason).toBeTruthy();
    });

    it('should return BLOCKED for blocked access level', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        accessLevel: 'BLOCKED',
      });

      const result = await service.getPlaybackState('track-uuid');
      expect(result.accessState).toBe('BLOCKED');
    });

    it('should return PREVIEW for preview access level', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue({
        ...finishedTrack,
        accessLevel: 'PREVIEW',
      });

      const result = await service.getPlaybackState('track-uuid');
      expect(result.accessState).toBe('PREVIEW');
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getPlaybackState('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── registerProgress ──────────────────────────────────────────────────
  describe('registerProgress', () => {
    it('should save progress successfully', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.playbackProgress.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.playEvent.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.registerProgress('user-uuid', 'track-uuid', 97, 240, false);

      expect(result).toEqual({
        message: 'Playback progress saved successfully',
        trackId: 'track-uuid',
        positionSeconds: 97,
      });
      expect(prismaMock.playbackProgress.upsert).toHaveBeenCalledWith({
        where: {
          userId_trackId: { userId: 'user-uuid', trackId: 'track-uuid' },
        },
        update: {
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
        create: {
          userId: 'user-uuid',
          trackId: 'track-uuid',
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
      });
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.registerProgress('user-uuid', 'missing', 97, 240, false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── markPlayed ────────────────────────────────────────────────────────
  describe('markPlayed', () => {
    it('should record play event and return count', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.playEvent.create as jest.Mock).mockResolvedValue({});
      (prismaMock.playEvent.count as jest.Mock).mockResolvedValue(4821);

      const result = await service.markPlayed('user-uuid', 'track-uuid');

      expect(result).toEqual({
        message: 'Play event recorded successfully',
        trackId: 'track-uuid',
        playCount: 4821,
      });
    });

    it('should record playlist context when provided', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.playlist.findFirst as jest.Mock).mockResolvedValue({
        id: 'pl-1',
      });
      (prismaMock.playEvent.create as jest.Mock).mockResolvedValue({});
      (prismaMock.playEvent.count as jest.Mock).mockResolvedValue(1);

      await service.markPlayed('user-uuid', 'track-uuid', 'pl-1');

      expect(prismaMock.playEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid',
          trackId: 'track-uuid',
          playlistId: 'pl-1',
          source: 'TRACK',
          deviceType: 'WEB',
        },
      });
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.markPlayed('user-uuid', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── getRecentlyPlayed ─────────────────────────────────────────────────
  describe('getRecentlyPlayed', () => {
    it('should return recently played tracks', async () => {
      (prismaMock.playEvent.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            trackId: 'track-1',
            startedAt: new Date('2026-03-07T17:15:00Z'),
            track: {
              id: 'track-1',
              title: 'Layali',
              slug: 'layali',
              coverArtUrl: null,
              durationMs: 240000,
              waveformData: [0.1, 0.3, 0.5],
              _count: { likes: 250, reposts: 70 },
              uploader: {
                id: 'usr-1',
                profile: { displayName: 'Ahmed Hassan', handle: 'ahmed-hassan', avatarUrl: null },
              },
            },
          },
        ])
        .mockResolvedValueOnce([{ trackId: 'track-1' }]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([
        { trackId: 'track-1', positionSeconds: 97 },
      ]);
      (prismaMock.like.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.repost.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRecentlyPlayed('user-uuid', 1, 20);

      expect(result.total).toBe(1);
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0].title).toBe('Layali');
      expect(result.tracks[0].slug).toBe('layali');
      expect(result.tracks[0].durationMs).toBe(240000);
      expect(result.tracks[0].durationSeconds).toBe(240);
      expect(result.tracks[0].likesCount).toBe(250);
      expect(result.tracks[0].repostsCount).toBe(70);
      expect(result.tracks[0].liked).toBe(false);
      expect(result.tracks[0].lastPositionSeconds).toBe(97);
    });

    it('should return empty when no play history', async () => {
      (prismaMock.playEvent.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.like.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.repost.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRecentlyPlayed('user-uuid');
      expect(result.tracks).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────
  describe('getHistory', () => {
    it('should return paginated listening history', async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            trackId: 'track-1',
            startedAt: new Date('2026-03-07T17:15:00Z'),
            track: {
              title: 'Layali',
              slug: 'layali',
              coverArtUrl: null,
              durationMs: 240000,
              waveformData: [0.1, 0.3, 0.5],
              _count: { likes: 250, reposts: 70 },
              uploader: {
                id: 'usr-1',
                profile: { displayName: 'Ahmed Hassan', handle: 'ahmed-hassan', avatarUrl: null },
              },
            },
          },
        ],
      ]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([
        {
          trackId: 'track-1',
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
      ]);
      (prismaMock.like.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.repost.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getHistory('user-uuid', 1, 20);

      expect(result.total).toBe(1);
      expect(result.history).toHaveLength(1);
      expect(result.history[0].positionSeconds).toBe(97);
      expect(result.history[0].slug).toBe('layali');
      expect(result.history[0].likesCount).toBe(250);
      expect(result.history[0].liked).toBe(false);
    });

    it('should use track durationMs when no progress exists', async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            trackId: 'track-1',
            startedAt: new Date(),
            track: {
              title: 'Test',
              slug: 'test',
              coverArtUrl: null,
              durationMs: 180000,
              waveformData: [],
              _count: { likes: 0, reposts: 0 },
              uploader: {
                id: 'usr-1',
                profile: { displayName: 'Artist', handle: 'artist', avatarUrl: null },
              },
            },
          },
        ],
      ]);
      (prismaMock.playbackProgress.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.like.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.repost.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getHistory('user-uuid', 1, 20);

      expect(result.history[0].durationSeconds).toBe(180);
      expect(result.history[0].positionSeconds).toBe(0);
      expect(result.history[0].isCompleted).toBe(false);
    });
  });

  // ── clearHistory ──────────────────────────────────────────────────────
  describe('clearHistory', () => {
    it('should clear all play events for user', async () => {
      (prismaMock.playEvent.deleteMany as jest.Mock).mockResolvedValue({
        count: 10,
      });

      const result = await service.clearHistory('user-uuid');

      expect(result).toEqual({
        message: 'Listening history cleared successfully',
      });
      expect(prismaMock.playEvent.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
      });
    });
  });

  // ── getResumePosition ─────────────────────────────────────────────────
  describe('getResumePosition', () => {
    it('should return resume position when progress exists', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.playbackProgress.findUnique as jest.Mock).mockResolvedValue({
        positionSeconds: 97,
      });

      const result = await service.getResumePosition('user-uuid', 'track-uuid');

      expect(result).toEqual({
        trackId: 'track-uuid',
        resumePositionSeconds: 97,
      });
    });

    it('should return 0 when no progress exists', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.playbackProgress.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getResumePosition('user-uuid', 'track-uuid');

      expect(result.resumePositionSeconds).toBe(0);
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getResumePosition('user-uuid', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── getSession ────────────────────────────────────────────────────────
  describe('getSession', () => {
    it('should return default session when none exists', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getSession('user-uuid');

      expect(result).toEqual({
        currentTrack: null,
        positionSeconds: 0,
        isPlaying: false,
        volume: 0.8,
        queue: [],
        shuffle: false,
        repeatMode: 'OFF',
      });
    });

    it('should return session with queue tracks', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        currentTrackId: 'track-1',
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queueTrackIds: ['track-2', 'track-3'],
        shuffle: false,
        repeatMode: 'OFF',
        currentTrack: { id: 'track-1', title: 'Layali' },
      });
      (prismaMock.track.findMany as jest.Mock).mockResolvedValue([
        { id: 'track-2', title: 'Sahar' },
        { id: 'track-3', title: 'Nostalgia Mix' },
      ]);

      const result = await service.getSession('user-uuid');

      expect(result.currentTrack).toEqual({
        trackId: 'track-1',
        title: 'Layali',
      });
      expect(result.isPlaying).toBe(true);
      expect(result.queue).toHaveLength(2);
      expect(result.queue[0].title).toBe('Sahar');
    });

    it('should return empty queue for session with no queue tracks', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        currentTrackId: null,
        positionSeconds: 0,
        isPlaying: false,
        volume: 0.5,
        queueTrackIds: [],
        shuffle: false,
        repeatMode: 'OFF',
        currentTrack: null,
      });

      const result = await service.getSession('user-uuid');

      expect(result.currentTrack).toBeNull();
      expect(result.queue).toEqual([]);
    });
  });

  // ── updateSession ─────────────────────────────────────────────────────
  describe('updateSession', () => {
    it('should upsert player session', async () => {
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.updateSession('user-uuid', {
        currentTrackId: 'track-1',
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queueTrackIds: ['track-2'],
      });

      expect(result).toEqual({
        message: 'Player session updated successfully',
      });
      expect(prismaMock.playerSession.upsert).toHaveBeenCalled();
    });

    it('should use defaults when body fields are missing', async () => {
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.updateSession('user-uuid', {});

      expect(result.message).toBe('Player session updated successfully');
    });
  });

  // ── getTrackPreview ───────────────────────────────────────────────────
  describe('getTrackPreview', () => {
    it('should return a proper URL (not raw storage key) for S3 preview file', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: 'previews/trk_555.mp3',
      });

      const result = await service.getTrackPreview('track-uuid');

      expect(result).toEqual({
        trackId: 'track-uuid',
        // buildFileUrl() for S3 (no CDN) → https://<bucket>.s3.<region>.amazonaws.com/<key>
        previewUrl: 'https://test-bucket.s3.eu-north-1.amazonaws.com/previews/trk_555.mp3',
        previewDurationSeconds: 30,
        accessState: 'PREVIEW',
      });
      // Preview clips are @Public(), so StorageService.getPresignedUrl is NOT called —
      // the preview URL is a plain public URL (or CDN URL when configured).
      expect(storageMockS3.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('should return a local URL (not raw storage key) in local storage mode', async () => {
      const localConfigMock = {
        get: jest.fn((key: string, fallback?: any) => {
          const map: Record<string, any> = {
            'storage.provider': 'local',
            'storage.localUploadUrl': 'http://localhost:3000/uploads',
            'storage.s3Bucket': '',
            'storage.s3Region': 'us-east-1',
            'storage.cdnUrl': '',
          };
          return map[key] ?? fallback;
        }),
      } as unknown as ConfigService;

      const localService = new PlayerService(
        prismaMock,
        localConfigMock,
        storageMockLocal,
        entitlementsMock,
      );

      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue({
        storageKey: 'previews/trk_555.mp3',
      });

      const result = await localService.getTrackPreview('track-uuid');

      // buildFileUrl for local mode → localUploadUrl/storageKey
      expect(result.previewUrl).toBe('http://localhost:3000/uploads/previews/trk_555.mp3');
      expect(storageMockLocal.getPresignedUrl).not.toHaveBeenCalled();
    });

    it('should return null previewUrl when no preview file', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(finishedTrack);
      (prismaMock.trackFile.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getTrackPreview('track-uuid');

      expect(result.previewUrl).toBeNull();
    });

    it('should throw NotFoundException when track does not exist', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getTrackPreview('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── loadQueueContext ──────────────────────────────────────────────────
  describe('loadQueueContext', () => {
    const makeSession = () => ({
      userId: 'user-uuid',
      queueTrackIds: ['track-1'],
      currentQueueIndex: 0,
      realTracksSinceLastAd: 0,
      currentTrackId: 'track-1',
      isPlaying: false,
      volume: 0.8,
      positionSeconds: 0,
      shuffle: false,
      repeatMode: 'OFF',
      updatedAt: new Date(),
      queueContext: null,
    });

    it('FREE user TRACK context: loads queue and returns tracksUntilAd=3', async () => {
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue(makeSession());

      const result = await service.loadQueueContext('user-uuid', {
        contextType: 'TRACK',
        startTrackId: 'track-1',
      });

      expect(result.tracksUntilAd).toBe(3);
      expect(result.currentTrack).toBeDefined();
      expect(result.queueLength).toBe(1);
      expect(result.currentIndex).toBe(0);
      expect(prismaMock.playerSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ realTracksSinceLastAd: 0 }),
        }),
      );
    });

    it('PRO user: returns tracksUntilAd=null', async () => {
      setPremiumUser();
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue(makeSession());

      const result = await service.loadQueueContext('user-uuid', {
        contextType: 'TRACK',
        startTrackId: 'track-1',
      });

      expect(result.tracksUntilAd).toBeNull();
    });

    it('CONTEXT_IDS with empty trackIds: throws BadRequestException', async () => {
      await expect(
        service.loadQueueContext('user-uuid', {
          contextType: 'CONTEXT_IDS',
          trackIds: [],
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('PLAYLIST context: loads tracks from playlist', async () => {
      (prismaMock.playlist.findFirst as jest.Mock).mockResolvedValue({
        tracks: [{ trackId: 'track-1' }, { trackId: 'track-2' }],
      });
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);
      (prismaMock.playerSession.upsert as jest.Mock).mockResolvedValue(makeSession());

      const result = await service.loadQueueContext('user-uuid', {
        contextType: 'PLAYLIST',
        contextId: 'playlist-1',
      });

      expect(result.queueLength).toBe(2);
      expect(result.tracksUntilAd).toBe(3);
    });

    it('PLAYLIST not found: throws NotFoundException', async () => {
      (prismaMock.playlist.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.loadQueueContext('user-uuid', {
          contextType: 'PLAYLIST',
          contextId: 'bad-playlist',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getNextTrackInQueue ───────────────────────────────────────────────
  describe('getNextTrackInQueue', () => {
    const makeSession = (overrides: Record<string, unknown> = {}) => ({
      userId: 'user-uuid',
      queueTrackIds: ['track-1', 'track-2', 'track-3', 'track-4'],
      currentQueueIndex: 0,
      realTracksSinceLastAd: 0,
      repeatMode: 'OFF',
      isPlaying: true,
      volume: 0.8,
      positionSeconds: 0,
      shuffle: false,
      currentTrackId: 'track-1',
      updatedAt: new Date(),
      queueContext: null,
      ...overrides,
    });

    it('no session: throws NotFoundException', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getNextTrackInQueue('user-uuid')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NO_QUEUE' }),
      });
    });

    it('empty queue: throws NotFoundException', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ queueTrackIds: [] }),
      );

      await expect(service.getNextTrackInQueue('user-uuid')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NO_QUEUE' }),
      });
    });

    it('FREE user, counter=0: returns TRACK, counter becomes 1, tracksUntilAd=2', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 0, realTracksSinceLastAd: 0 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', 2);
      expect(prismaMock.playerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ realTracksSinceLastAd: 1 }),
        }),
      );
    });

    it('FREE user, counter=2: returns TRACK, counter becomes 3, tracksUntilAd=0', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 1, realTracksSinceLastAd: 2 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', 0);
      expect(prismaMock.playerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ realTracksSinceLastAd: 3 }),
        }),
      );
    });

    it('FREE user, counter=3: returns AD and resets counter to 0', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 1, realTracksSinceLastAd: 3 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('AD');
      expect(result).toHaveProperty('ad');
      expect((result as any).ad).toHaveProperty('adId');
      expect((result as any).ad).toHaveProperty('durationSeconds', 15);
      expect(result).toHaveProperty('tracksUntilAd', 3);
      expect(prismaMock.playerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { realTracksSinceLastAd: 0 },
        }),
      );
    });

    it('FREE user, counter=6 (multiple of 3): returns AD', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 2, realTracksSinceLastAd: 6 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('AD');
    });

    it('PRO user, counter=3: returns TRACK (no ad), tracksUntilAd=null', async () => {
      setPremiumUser();
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 1, realTracksSinceLastAd: 3 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', null);
    });

    it('PRO user, counter=6: never returns AD', async () => {
      setPremiumUser();
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 2, realTracksSinceLastAd: 6 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', null);
    });

    it('GO_PLUS user, counter=3: returns TRACK (no ad), tracksUntilAd=null', async () => {
      (entitlementsMock.getUserEntitlements as jest.Mock).mockResolvedValueOnce({
        planCode: 'GO_PLUS',
        isPremium: true,
        adsEnabled: false,
        canDownload: true,
        canUpload: true,
        uploadLimit: 1000,
        uploadedCount: 0,
        remainingUploads: 1000,
        supportLevel: 'priority',
        trialEnd: null,
      });
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 1, realTracksSinceLastAd: 3 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', null);
    });

    it('last track, repeatMode=OFF: returns ENDED', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({
          queueTrackIds: ['track-1', 'track-2'],
          currentQueueIndex: 1,
          realTracksSinceLastAd: 0,
          repeatMode: 'OFF',
        }),
      );

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('ENDED');
    });

    it('last track, repeatMode=ALL: wraps back to index 0', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({
          queueTrackIds: ['track-1', 'track-2'],
          currentQueueIndex: 1,
          realTracksSinceLastAd: 0,
          repeatMode: 'ALL',
        }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.getNextTrackInQueue('user-uuid');

      expect(result.type).toBe('TRACK');
      expect((result as any).currentIndex).toBe(0);
    });

    it('track no longer in DB: throws NotFoundException with TRACK_NOT_FOUND', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(
        makeSession({ currentQueueIndex: 0, realTracksSinceLastAd: 0 }),
      );
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getNextTrackInQueue('user-uuid')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRACK_NOT_FOUND' }),
      });
    });
  });

  // ── getQueueState ─────────────────────────────────────────────────────
  describe('getQueueState', () => {
    it('no session: returns empty queue with tracksUntilAd=3 for FREE user', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getQueueState('user-uuid');

      expect(result.queue).toEqual([]);
      expect(result.tracksUntilAd).toBe(3);
    });

    it('no session: returns tracksUntilAd=null for PRO user', async () => {
      setPremiumUser();
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getQueueState('user-uuid');

      expect(result.tracksUntilAd).toBeNull();
    });

    it('FREE user, counter=1: tracksUntilAd=2', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        queueTrackIds: ['track-1'],
        currentQueueIndex: 0,
        realTracksSinceLastAd: 1,
        shuffle: false,
        repeatMode: 'OFF',
      });
      (prismaMock.track.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'track-1',
          title: 'Track One',
          durationMs: 180000,
          coverArtUrl: null,
          uploader: { id: 'u1', profile: { displayName: 'Art', handle: 'art', avatarUrl: null } },
          primaryGenre: { name: 'Pop' },
        },
      ]);

      const result = await service.getQueueState('user-uuid');

      expect(result.tracksUntilAd).toBe(2);
    });

    it('FREE user, counter=3 (ad due): tracksUntilAd computed as 3 (wraps)', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        queueTrackIds: ['track-1'],
        currentQueueIndex: 0,
        realTracksSinceLastAd: 3,
        shuffle: false,
        repeatMode: 'OFF',
      });
      (prismaMock.track.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getQueueState('user-uuid');

      // 3 - (3 % 3) = 3 - 0 = 3
      expect(result.tracksUntilAd).toBe(3);
    });

    it('PRO user with active session: tracksUntilAd=null', async () => {
      setPremiumUser();
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue({
        queueTrackIds: ['track-1'],
        currentQueueIndex: 0,
        realTracksSinceLastAd: 2,
        shuffle: false,
        repeatMode: 'OFF',
      });
      (prismaMock.track.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getQueueState('user-uuid');

      expect(result.tracksUntilAd).toBeNull();
    });
  });

  // ── jumpToTrackInQueue ────────────────────────────────────────────────
  describe('jumpToTrackInQueue', () => {
    const makeSession = (overrides: Record<string, unknown> = {}) => ({
      userId: 'user-uuid',
      queueTrackIds: ['track-1', 'track-2', 'track-3'],
      currentQueueIndex: 0,
      realTracksSinceLastAd: 2,
      repeatMode: 'OFF',
      isPlaying: true,
      volume: 0.8,
      positionSeconds: 0,
      shuffle: false,
      currentTrackId: 'track-1',
      updatedAt: new Date(),
      queueContext: null,
      ...overrides,
    });

    it('no session: throws NotFoundException with NO_QUEUE', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.jumpToTrackInQueue('user-uuid', 'track-2')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NO_QUEUE' }),
      });
    });

    it('track not in queue: throws NotFoundException with TRACK_NOT_IN_QUEUE', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(makeSession());

      await expect(service.jumpToTrackInQueue('user-uuid', 'track-99')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRACK_NOT_IN_QUEUE' }),
      });
    });

    it('FREE user: resets counter to 0, returns tracksUntilAd=3', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(makeSession());
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.jumpToTrackInQueue('user-uuid', 'track-2');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', 3);
      expect(prismaMock.playerSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ realTracksSinceLastAd: 0, currentTrackId: 'track-2' }),
        }),
      );
    });

    it('PRO user: returns tracksUntilAd=null', async () => {
      setPremiumUser();
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(makeSession());
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.jumpToTrackInQueue('user-uuid', 'track-2');

      expect(result.type).toBe('TRACK');
      expect(result).toHaveProperty('tracksUntilAd', null);
    });

    it('jumps to correct index in queue', async () => {
      (prismaMock.playerSession.findUnique as jest.Mock).mockResolvedValue(makeSession());
      (prismaMock.playerSession.update as jest.Mock).mockResolvedValue({});
      (prismaMock.track.findUnique as jest.Mock).mockResolvedValue(queueTrackMock);

      const result = await service.jumpToTrackInQueue('user-uuid', 'track-3');

      expect((result as any).currentIndex).toBe(2);
      expect((result as any).queueLength).toBe(3);
    });
  });
});
