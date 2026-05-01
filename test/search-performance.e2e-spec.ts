import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { DiscoveryController } from "../src/discovery/discovery.controller";
import { DiscoveryService } from "../src/discovery/discovery.service";
import { PrismaService } from "../src/prisma/prisma.service";

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const TEST_PROFILE_HANDLE = "search-perf-artist";
const TRACK_PREFIX = "perf-test-track-";
const TRACK_COUNT = 10_000;

function buildTrackRows() {
  return Array.from({ length: TRACK_COUNT }, (_, index) => ({
    uploaderId: TEST_USER_ID,
    title: `test performance track ${index}`,
    slug: `${TRACK_PREFIX}${index}`,
    description: `dummy test track ${index}`,
    waveformData: [],
    visibility: "PUBLIC" as const,
    status: "FINISHED" as const,
    moderationState: "VISIBLE" as const,
  }));
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("Discovery search performance", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    jest.setTimeout(180_000);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [DiscoveryService, PrismaService],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await prisma.track.deleteMany({
      where: { slug: { startsWith: TRACK_PREFIX } },
    });
    await prisma.userProfile.deleteMany({
      where: { userId: TEST_USER_ID },
    });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });

    await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        email: "search-perf-artist@example.com",
        passwordHash: "hash",
        systemRole: "USER",
        accountStatus: "ACTIVE",
        isVerified: true,
        dateOfBirth: new Date("1990-01-01"),
        gender: "PREFER_NOT_TO_SAY",
      },
    });

    await prisma.userProfile.create({
      data: {
        userId: TEST_USER_ID,
        handle: TEST_PROFILE_HANDLE,
        displayName: "Search Performance Artist",
        accountType: "ARTIST",
        visibility: "PUBLIC",
        likesVisible: true,
      },
    });

    const rows = buildTrackRows();
    const chunkSize = 1_000;
    for (let index = 0; index < rows.length; index += chunkSize) {
      await prisma.track.createMany({
        data: rows.slice(index, index + chunkSize),
      });
    }

    await prisma.$executeRawUnsafe("ANALYZE tracks;");
  }, 180_000);

  afterAll(async () => {
    await prisma.track.deleteMany({
      where: { slug: { startsWith: TRACK_PREFIX } },
    });
    await prisma.userProfile.deleteMany({
      where: { userId: TEST_USER_ID },
    });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  it("returns /discovery/search under 500ms with 10k seeded tracks", async () => {
    const startedAt = Date.now();

    const response = await request(app.getHttpServer())
      .get("/discovery/search")
      .query({ q: "test", type: "tracks", page: 1, limit: 20 })
      .expect(200);

    const elapsedMs = Date.now() - startedAt;

    expect(response.body.data.tracks).toHaveLength(20);
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        current_page: 1,
        total_results: expect.any(Number),
        total_pages: expect.any(Number),
      }),
    );
    expect(response.body.meta.total_results).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  });
});
