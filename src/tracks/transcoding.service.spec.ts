import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TranscodingService } from './transcoding.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackStatus, FileRole, FileStatus } from '@prisma/client';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const TRACK_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

// Mock fluent-ffmpeg
jest.mock('fluent-ffmpeg', () => {
  const mockInstance = {
    audioCodec: jest.fn().mockReturnThis(),
    audioBitrate: jest.fn().mockReturnThis(),
    format: jest.fn().mockReturnThis(),
    audioChannels: jest.fn().mockReturnThis(),
    audioFrequency: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    pipe: jest.fn().mockReturnThis(),
  };

  const ffmpegFn = jest.fn(() => mockInstance);
  (ffmpegFn as any).__mockInstance = mockInstance;
  return { __esModule: true, default: ffmpegFn };
});

function getFFmpegMock() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('fluent-ffmpeg');
  return mod.default.__mockInstance;
}

function buildPrismaMock() {
  const $transaction = jest
    .fn()
    .mockImplementation((fn: any) =>
      typeof fn === 'function' ? fn(prismaMock) : Promise.all(fn),
    );

  const prismaMock: any = {
    $transaction,
    track: {
      update: jest.fn().mockResolvedValue({}),
    },
    trackFile: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  return prismaMock;
}

function buildConfigMock() {
  const configMap: Record<string, any> = {
    'storage.provider': 'local',
    'storage.localUploadDir': './test-uploads',
    'storage.s3Bucket': '',
    'storage.s3Region': 'us-east-1',
    'storage.awsAccessKeyId': '',
    'storage.awsSecretAccessKey': '',
  };

  return {
    get: jest.fn((key: string, defaultValue?: any) => configMap[key] ?? defaultValue),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('TranscodingService', () => {
  let service: TranscodingService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let config: ReturnType<typeof buildConfigMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    config = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscodingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<TranscodingService>(TranscodingService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('processTrack', () => {
    beforeEach(() => {
      // Mock fs operations used by downloadToTemp (local provider)
      jest.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/iqa3-mock');
      jest.spyOn(fs.promises, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('mock-mp3'));
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    });

    it('should mark track as FINISHED on successful transcode', async () => {
      const ffmpegMock = getFFmpegMock();

      // Simulate successful transcode: capture the 'end' callback and call it
      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'codecData') {
          cb({ duration: '00:03:30.00' });
        }
        if (event === 'end') {
          // Schedule the callback to fire after save()
          setTimeout(() => cb(), 0);
        }
        return this;
      });

      ffmpegMock.save.mockImplementation(function (this: any) {
        return this;
      });

      // For waveform generation pipe: simulate PCM output
      const mockStream = {
        on: jest.fn().mockImplementation(function (this: any, event: string, cb: Function) {
          if (event === 'data') {
            // 400 bytes = 200 samples of 16-bit PCM
            const pcm = Buffer.alloc(400);
            for (let i = 0; i < 200; i++) {
              pcm.writeInt16LE(Math.floor(Math.random() * 32767), i * 2);
            }
            cb(pcm);
          }
          return this;
        }),
      };
      ffmpegMock.pipe.mockReturnValue(mockStream);

      await service.processTrack(TRACK_ID, 'tracks/original.mp3');

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TrackStatus.FINISHED,
          }),
        }),
      );
    });

    it('should mark track as FAILED when ffmpeg errors', async () => {
      const ffmpegMock = getFFmpegMock();

      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') {
          setTimeout(() => cb(new Error('ffmpeg crash')), 0);
        }
        return this;
      });

      await service.processTrack(TRACK_ID, 'tracks/corrupt.mp3');

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: TrackStatus.FAILED },
        }),
      );
    });

    it('should create a STREAM TrackFile on success', async () => {
      const ffmpegMock = getFFmpegMock();

      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'end') {
          setTimeout(() => cb(), 0);
        }
        return this;
      });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: any, event: string, cb: Function) {
          if (event === 'data') {
            cb(Buffer.alloc(400));
          }
          return this;
        }),
      };
      ffmpegMock.pipe.mockReturnValue(mockStream);

      await service.processTrack(TRACK_ID, 'tracks/original.mp3');

      expect(prisma.trackFile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trackId: TRACK_ID,
            fileRole: FileRole.STREAM,
            mimeType: 'audio/mpeg',
            format: 'mp3',
            bitrateKbps: 128,
            status: FileStatus.READY,
            isCurrent: true,
          }),
        }),
      );
    });

    it('should store waveformData as float array', async () => {
      const ffmpegMock = getFFmpegMock();

      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'end') {
          setTimeout(() => cb(), 0);
        }
        return this;
      });

      // Create PCM with known values
      const pcm = Buffer.alloc(800); // 400 samples
      for (let i = 0; i < 400; i++) {
        pcm.writeInt16LE(16384, i * 2); // ~0.5 normalised
      }

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: any, event: string, cb: Function) {
          if (event === 'data') {
            cb(pcm);
          }
          return this;
        }),
      };
      ffmpegMock.pipe.mockReturnValue(mockStream);

      await service.processTrack(TRACK_ID, 'tracks/original.mp3');

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.waveformData).toBeDefined();
      expect(Array.isArray(updateCall.data.waveformData)).toBe(true);
      expect(updateCall.data.waveformData.length).toBe(200);
      // All peaks should be between 0 and 1
      for (const peak of updateCall.data.waveformData) {
        expect(peak).toBeGreaterThanOrEqual(0);
        expect(peak).toBeLessThanOrEqual(1);
      }
    });

    it('should cleanup temp directory even on failure', async () => {
      const ffmpegMock = getFFmpegMock();

      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') {
          setTimeout(() => cb(new Error('boom')), 0);
        }
        return this;
      });

      await service.processTrack(TRACK_ID, 'tracks/corrupt.mp3');

      expect(fs.promises.rm).toHaveBeenCalledWith(
        '/tmp/iqa3-mock',
        { recursive: true, force: true },
      );
    });

    it('should extract duration from codecData', async () => {
      const ffmpegMock = getFFmpegMock();

      ffmpegMock.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'codecData') {
          cb({ duration: '00:03:30.50' }); // 3 min 30.5 sec = 210500 ms
        }
        if (event === 'end') {
          setTimeout(() => cb(), 0);
        }
        return this;
      });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: any, event: string, cb: Function) {
          if (event === 'data') {
            cb(Buffer.alloc(400));
          }
          return this;
        }),
      };
      ffmpegMock.pipe.mockReturnValue(mockStream);

      await service.processTrack(TRACK_ID, 'tracks/original.mp3');

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.durationMs).toBe(210500);
    });
  });
});
