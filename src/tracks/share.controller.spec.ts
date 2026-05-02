import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { ShareController } from './share.controller';
import { TracksService } from './tracks.service';

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function buildServiceMock() {
  return {
    findTrackShareTarget: jest.fn().mockResolvedValue({ id: UUID }),
  };
}

async function buildApp(serviceMock: ReturnType<typeof buildServiceMock>): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [ShareController],
    providers: [{ provide: TracksService, useValue: serviceMock }],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe('ShareController', () => {
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

  describe('GET /share/track/:slugOrId', () => {
    it('should return HTML that opens the mobile app for a found track', async () => {
      const res = await request(app.getHttpServer()).get('/share/track/test-track').expect(200);

      expect(svc.findTrackShareTarget).toHaveBeenCalledWith('test-track');
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(`iqa3://track/${UUID}`);
      expect(res.text).toContain('Opening track...');
    });

    it('should fall back to the main website when the track is not found', async () => {
      svc.findTrackShareTarget = jest.fn().mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer()).get('/share/track/missing-track').expect(200);

      expect(res.text).toContain('https://iqa3.tech');
      expect(res.text).toContain('Track not found');
    });
  });
});
