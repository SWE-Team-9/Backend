import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

// ─────────────────────────────────────────────────────────────────────────────
// Stub responses
// ─────────────────────────────────────────────────────────────────────────────

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const mockTrackResponse = {
  trackId: UUID,
  title: 'Test Track',
  slug: 'test-track',
  status: 'PROCESSING',
  visibility: 'PRIVATE',
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock service
// ─────────────────────────────────────────────────────────────────────────────

function buildServiceMock() {
  return {
    uploadTrack: jest.fn().mockResolvedValue(mockTrackResponse),
    getTrackById: jest.fn().mockResolvedValue(mockTrackResponse),
    getTrackStatus: jest
      .fn()
      .mockResolvedValue({ trackId: UUID, status: 'PROCESSING' }),
    updateTrack: jest.fn().mockResolvedValue(mockTrackResponse),
    deleteTrack: jest.fn().mockResolvedValue(undefined),
    changeVisibility: jest
      .fn()
      .mockResolvedValue({ ...mockTrackResponse, visibility: 'PUBLIC' }),
    getUserTracks: jest
      .fn()
      .mockResolvedValue({ artist: null, page: 1, limit: 20, totalTracks: 0, tracks: [] }),
    getWaveform: jest
      .fn()
      .mockResolvedValue({ trackId: UUID, waveformData: [0.1, 0.5] }),
    handleTranscodingCallback: jest
      .fn()
      .mockResolvedValue({ trackId: UUID, status: 'FINISHED' }),
    getTrackBySecretToken: jest
      .fn()
      .mockResolvedValue({ ...mockTrackResponse, message: 'Access granted via secret token' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap lightweight NestJS app (follows users.controller.spec pattern)
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [TracksController],
    providers: [
      { provide: TracksService, useValue: serviceMock },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (ctx: any) => {
            ctx.switchToHttp().getRequest().user = {
              userId: 'user-1',
              role: 'USER',
            };
            return true;
          },
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TracksController', () => {
  let app: INestApplication;
  let svc: ReturnType<typeof buildServiceMock>;

  beforeEach(async () => {
    svc = buildServiceMock();
    app = await buildApp(svc);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  // ── POST /tracks ───────────────────────────────────────────────────────
  describe('POST /tracks', () => {
    it('should return 202 and call uploadTrack with userId, dto, and file', async () => {
      const res = await request(app.getHttpServer())
        .post('/tracks')
        .attach('audioFile', Buffer.from('fake-audio-data'), {
          filename: 'song.mp3',
          contentType: 'audio/mpeg',
        })
        .field('title', 'My Song')
        .expect(202);

      expect(svc.uploadTrack).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ title: 'My Song' }),
        expect.objectContaining({ originalname: 'song.mp3' }),
      );
      expect(res.body).toHaveProperty('trackId', UUID);
    });

    it('should reject non-audio MIME types via multer filter', async () => {
      await request(app.getHttpServer())
        .post('/tracks')
        .attach('audioFile', Buffer.from('not-audio'), {
          filename: 'image.png',
          contentType: 'image/png',
        })
        .field('title', 'Bad File')
        .expect(400); // multer filter throws BadRequestException → 400
    });
  });

  // ── GET /tracks/secret/:secretToken ────────────────────────────────────
  describe('GET /tracks/secret/:secretToken', () => {
    it('should return 200 and call getTrackBySecretToken', async () => {
      const res = await request(app.getHttpServer())
        .get('/tracks/secret/V1StGXR8_Z5jdHi6B-myT-RQ')
        .expect(200);

      expect(svc.getTrackBySecretToken).toHaveBeenCalledWith(
        'V1StGXR8_Z5jdHi6B-myT-RQ',
      );
      expect(res.body).toHaveProperty('message', 'Access granted via secret token');
    });
  });

  // ── POST /tracks/transcoding/callback ──────────────────────────────────
  describe('POST /tracks/transcoding/callback', () => {
    it('should return 200 and forward x-api-key header', async () => {
      const dto = { trackId: UUID, status: 'FINISHED', fileUrls: {} };

      const res = await request(app.getHttpServer())
        .post('/tracks/transcoding/callback')
        .set('x-api-key', 'test-key')
        .send(dto)
        .expect(200);

      expect(svc.handleTranscodingCallback).toHaveBeenCalledWith(
        'test-key',
        expect.objectContaining({ trackId: UUID, status: 'FINISHED' }),
      );
      expect(res.body).toHaveProperty('status', 'FINISHED');
    });
  });

  // ── GET /tracks/:trackId ───────────────────────────────────────────────
  describe('GET /tracks/:trackId', () => {
    it('should return 200 and pass trackId + requesterId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracks/${UUID}`)
        .expect(200);

      expect(svc.getTrackById).toHaveBeenCalledWith(UUID, 'user-1');
      expect(res.body).toHaveProperty('trackId', UUID);
    });

    it('should return 400 for an invalid UUID', async () => {
      await request(app.getHttpServer())
        .get('/tracks/not-a-uuid')
        .expect(400);
    });
  });

  // ── GET /tracks/:trackId/status ────────────────────────────────────────
  describe('GET /tracks/:trackId/status', () => {
    it('should return 200 and pass trackId + requesterId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracks/${UUID}/status`)
        .expect(200);

      expect(svc.getTrackStatus).toHaveBeenCalledWith(UUID, 'user-1');
      expect(res.body).toHaveProperty('status', 'PROCESSING');
    });
  });

  // ── GET /tracks/:trackId/waveform ──────────────────────────────────────
  describe('GET /tracks/:trackId/waveform', () => {
    it('should return 200 and pass trackId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracks/${UUID}/waveform`)
        .expect(200);

      expect(svc.getWaveform).toHaveBeenCalledWith(UUID);
      expect(res.body).toHaveProperty('waveformData', [0.1, 0.5]);
    });
  });

  // ── PUT /tracks/:trackId ───────────────────────────────────────────────
  describe('PUT /tracks/:trackId', () => {
    it('should return 200 and pass trackId, userId, dto', async () => {
      await request(app.getHttpServer())
        .put(`/tracks/${UUID}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(svc.updateTrack).toHaveBeenCalledWith(
        UUID,
        'user-1',
        expect.objectContaining({ title: 'Updated Title' }),
      );
    });

    it('should return 400 for invalid UUID', async () => {
      await request(app.getHttpServer())
        .put('/tracks/bad-id')
        .send({ title: 'X' })
        .expect(400);
    });

    it('should strip unknown fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .put(`/tracks/${UUID}`)
        .send({ title: 'Valid', hackerField: 'malicious' })
        .expect(400); // forbidNonWhitelisted → 400
    });
  });

  // ── DELETE /tracks/:trackId ────────────────────────────────────────────
  describe('DELETE /tracks/:trackId', () => {
    it('should return 204 and pass trackId, userId, role', async () => {
      await request(app.getHttpServer())
        .delete(`/tracks/${UUID}`)
        .expect(204);

      expect(svc.deleteTrack).toHaveBeenCalledWith(UUID, 'user-1', 'USER');
    });

    it('should return 400 for invalid UUID', async () => {
      await request(app.getHttpServer())
        .delete('/tracks/bad-id')
        .expect(400);
    });
  });

  // ── PATCH /tracks/:trackId/visibility ──────────────────────────────────
  describe('PATCH /tracks/:trackId/visibility', () => {
    it('should return 200 and pass visibility value', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tracks/${UUID}/visibility`)
        .send({ visibility: 'PUBLIC' })
        .expect(200);

      expect(svc.changeVisibility).toHaveBeenCalledWith(UUID, 'user-1', 'PUBLIC');
      expect(res.body).toHaveProperty('visibility', 'PUBLIC');
    });

    it('should return 400 for invalid visibility enum', async () => {
      await request(app.getHttpServer())
        .patch(`/tracks/${UUID}/visibility`)
        .send({ visibility: 'INVALID_VALUE' })
        .expect(400);
    });

    it('should return 400 when visibility field is missing', async () => {
      await request(app.getHttpServer())
        .patch(`/tracks/${UUID}/visibility`)
        .send({})
        .expect(400);
    });
  });
});
