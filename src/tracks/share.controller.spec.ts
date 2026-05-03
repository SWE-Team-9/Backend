import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { ShareController } from './share.controller';
import { TracksService } from './tracks.service';
import { DiscoveryService } from '../discovery/discovery.service';

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function buildServiceMock() {
  return {
    findTrackShareTarget: jest.fn().mockResolvedValue({ id: UUID, artistHandle: 'testartist' }),
  };
}

function buildDiscoveryMock() {
  return {
    buildRedirectHtml: jest.fn((targetUrl: string, title: string) => `HTML:${title}:${targetUrl}`),
    buildTrackShareRedirectHtml: jest.fn(
      (trackId: string, artistHandle: string | null, isMobile: boolean) => {
        const targetUrl = isMobile
          ? `trackmaster://track/${trackId}`
          : `https://iqa3.tech/track/${trackId}${artistHandle ? `?artist=${artistHandle}` : ''}`;

        return `HTML:${isMobile ? 'Opening track...' : 'Opening track in browser...'}:${targetUrl}`;
      },
    ),
  };
}

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
  discoveryMock: ReturnType<typeof buildDiscoveryMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [ShareController],
    providers: [
      { provide: TracksService, useValue: serviceMock },
      { provide: DiscoveryService, useValue: discoveryMock },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe('ShareController', () => {
  let app: INestApplication;
  let svc: ReturnType<typeof buildServiceMock>;
  let discovery: ReturnType<typeof buildDiscoveryMock>;

  beforeEach(async () => {
    svc = buildServiceMock();
    discovery = buildDiscoveryMock();
    app = await buildApp(svc, discovery);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('GET /share/track/:slugOrId', () => {
    it('should return HTML that opens the mobile app for a found track', async () => {
      const res = await request(app.getHttpServer())
        .get('/share/track/test-track')
        .set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
        .expect(200);

      expect(svc.findTrackShareTarget).toHaveBeenCalledWith('test-track');
      expect(res.headers['content-type']).toContain('text/html');
      expect(discovery.buildTrackShareRedirectHtml).toHaveBeenCalledWith(UUID, 'testartist', true);
      expect(res.text).toContain(`trackmaster://track/${UUID}`);
      expect(res.text).toContain('Opening track...');
    });

    it('should route browser requests to the frontend URL for a found track', async () => {
      const res = await request(app.getHttpServer())
        .get('/share/track/test-track')
        .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        .expect(200);

      expect(discovery.buildTrackShareRedirectHtml).toHaveBeenCalledWith(UUID, 'testartist', false);
      expect(res.text).toContain(`https://iqa3.tech/track/${UUID}?artist=testartist`);
      expect(res.text).toContain('Opening track in browser...');
    });

    it('should fall back to the main website when the track is not found', async () => {
      svc.findTrackShareTarget = jest.fn().mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer()).get('/share/track/missing-track').expect(200);

      expect(discovery.buildRedirectHtml).toHaveBeenCalledWith('https://iqa3.tech', 'Track not found');
      expect(res.text).toContain('HTML:Track not found:https://iqa3.tech');
    });
  });
});
