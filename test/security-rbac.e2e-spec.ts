/**
 * Security & RBAC E2E Test Suite
 *
 * Covers:
 *  1. Access control — role-based guard enforcement
 *  2. Re-authentication — admin password re-verification
 *  3. JWT edge cases — expired / tampered tokens
 *  4. IDOR (Insecure Direct Object Reference) prevention
 */

import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { PassportModule } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

// ── Controllers ───────────────────────────────────────────────────────────────
import { AdminUsersController } from "../src/admin/admin-users.controller";
import { AdminReportsController } from "../src/reports/admin-reports.controller";
import { UserEnforcementController } from "../src/admin/user-enforcement.controller";
import { NotificationsController } from "../src/notifications/notifications.controller";
import { MessagesController } from "../src/messages/messages.controller";

// ── Guards & Strategy ─────────────────────────────────────────────────────────
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { RolesGuard } from "../src/common/guards/roles.guard";
import { JwtCookieStrategy } from "../src/auth/strategies/jwt-cookie.strategy";

// ── Services (to be mocked) ───────────────────────────────────────────────────
import { AdminUsersService } from "../src/admin/admin-users.service";
import { ReportsService } from "../src/reports/reports.service";
import { UserEnforcementService } from "../src/admin/user-enforcement.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { MessagesService } from "../src/messages/messages.service";
import { PrismaService } from "../src/prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** 64+ char secret so env validation passes. */
const TEST_JWT_SECRET =
  "test-jwt-secret-must-be-at-least-64-chars-for-security-purposes-e2e";

const USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ADMIN_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TARGET_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const NOTIF_B_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"; // owned by User B
const CONVO_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"; // B+C conversation

// ─────────────────────────────────────────────────────────────────────────────
// JWT helpers
// ─────────────────────────────────────────────────────────────────────────────

function signToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, TEST_JWT_SECRET, {
    issuer: "spotly-api",
    audience: "spotly-client",
    expiresIn: "15m",
    ...options,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock service factories
// ─────────────────────────────────────────────────────────────────────────────

function buildAdminUsersServiceMock() {
  return {
    getUsers: jest.fn().mockResolvedValue({ items: [], pagination: {} }),
    getUserById: jest.fn().mockResolvedValue({}),
    getAuditLog: jest.fn().mockResolvedValue({ items: [] }),
    getDailyStats: jest.fn().mockResolvedValue([]),
    getMostReported: jest.fn().mockResolvedValue([]),
  };
}

function buildReportsServiceMock() {
  return {
    getReports: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
    getReportById: jest.fn().mockResolvedValue({}),
    createReport: jest.fn(),
    createAppeal: jest.fn(),
    updateReport: jest.fn(),
    bulkUpdateReports: jest.fn(),
    assignReport: jest.fn(),
  };
}

function buildEnforcementServiceMock() {
  return {
    warnUser: jest.fn(),
    suspendUser: jest.fn(),
    banUser: jest.fn(),
    restoreUser: jest.fn(),
  };
}

function buildNotificationsServiceMock() {
  return {
    getNotifications: jest.fn().mockResolvedValue({ page: 1, total: 0, notifications: [] }),
    markAsRead: jest.fn(),
    markAllRead: jest.fn().mockResolvedValue({ message: "ok" }),
    getUnreadCount: jest.fn().mockResolvedValue({ unreadCount: 0 }),
    createNotification: jest.fn(),
    getPreferences: jest.fn().mockResolvedValue({}),
    upsertPreferences: jest.fn().mockResolvedValue({}),
    registerDevice: jest.fn().mockResolvedValue({}),
    deleteNotification: jest.fn().mockResolvedValue({}),
  };
}

function buildMessagesServiceMock() {
  return {
    getConversations: jest.fn().mockResolvedValue({ items: [] }),
    getConversationMessages: jest.fn(),
    sendMessage: jest.fn(),
    createConversation: jest.fn(),
    shareTrack: jest.fn(),
    sharePlaylist: jest.fn(),
    markConversationRead: jest.fn().mockResolvedValue({}),
    archiveConversation: jest.fn().mockResolvedValue({}),
    deleteConversation: jest.fn().mockResolvedValue({}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard factories
// ─────────────────────────────────────────────────────────────────────────────

/** Injects a user into req.user and always passes. */
function makeRoleGuard(userId: string, role: string) {
  return {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = {
        userId,
        role,
        accountStatus: "ACTIVE",
      };
      return true;
    },
  };
}

/** Always throws 401 – simulates missing/invalid token at the guard level. */
const noAuthGuard = {
  canActivate: (_ctx: ExecutionContext) => {
    throw new UnauthorizedException({
      code: "NOT_AUTHENTICATED",
      message: "Authentication is required to access this resource.",
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// App factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds an app with the given JwtAuthGuard override and the REAL RolesGuard.
 * Used for access-control and re-auth tests.
 */
async function buildRbacApp(
  jwtGuardOverride: object,
  overrides: {
    adminUsersSvc?: ReturnType<typeof buildAdminUsersServiceMock>;
    reportsSvc?: ReturnType<typeof buildReportsServiceMock>;
    enforcementSvc?: ReturnType<typeof buildEnforcementServiceMock>;
  } = {},
): Promise<INestApplication> {
  const adminUsersSvc = overrides.adminUsersSvc ?? buildAdminUsersServiceMock();
  const reportsSvc = overrides.reportsSvc ?? buildReportsServiceMock();
  const enforcementSvc =
    overrides.enforcementSvc ?? buildEnforcementServiceMock();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [
      AdminUsersController,
      AdminReportsController,
      UserEnforcementController,
    ],
    providers: [
      { provide: AdminUsersService, useValue: adminUsersSvc },
      { provide: ReportsService, useValue: reportsSvc },
      { provide: UserEnforcementService, useValue: enforcementSvc },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtGuardOverride)
    // RolesGuard is NOT overridden — it uses the real Reflector + real logic
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

/**
 * Builds an app with the real JwtAuthGuard + JwtCookieStrategy for JWT
 * validation tests (expired / tampered tokens).
 */
async function buildJwtApp(
  userRow: { accountStatus: string } | null = { accountStatus: "ACTIVE" },
): Promise<INestApplication> {
  const mockPrisma = {
    user: { findUnique: jest.fn().mockResolvedValue(userRow) },
  };

  const mockConfig = {
    get: (key: string) => {
      switch (key) {
        case "security.jwtSecret":
          return TEST_JWT_SECRET;
        case "security.jwtIssuer":
          return "spotly-api";
        case "security.jwtAudience":
          return "spotly-client";
        default:
          return undefined;
      }
    },
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [PassportModule.register({ defaultStrategy: "jwt-cookie" })],
    controllers: [AdminUsersController],
    providers: [
      JwtCookieStrategy,
      JwtAuthGuard,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ConfigService, useValue: mockConfig },
      { provide: AdminUsersService, useValue: buildAdminUsersServiceMock() },
    ],
  })
    // Bypass role check — we're testing token validity, not authorization
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

/**
 * Builds an app for IDOR tests with USER_A authenticated via a global guard
 * and mock notification/message services.
 */
async function buildIdorApp(
  notifSvc: ReturnType<typeof buildNotificationsServiceMock>,
  messagesSvc: ReturnType<typeof buildMessagesServiceMock>,
): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [NotificationsController, MessagesController],
    providers: [
      { provide: NotificationsService, useValue: notifSvc },
      { provide: MessagesService, useValue: messagesSvc },
      // Global guard — injects USER_A for all routes in this test app
      {
        provide: APP_GUARD,
        useValue: makeRoleGuard(USER_A_ID, "USER"),
      },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1 — Access Control
// ═════════════════════════════════════════════════════════════════════════════

describe("Suite 1 — Access Control", () => {
  let userApp: INestApplication;
  let moderatorApp: INestApplication;
  let noAuthApp: INestApplication;

  beforeAll(async () => {
    [userApp, moderatorApp, noAuthApp] = await Promise.all([
      buildRbacApp(makeRoleGuard(USER_A_ID, "USER")),
      buildRbacApp(makeRoleGuard("mod-uuid", "MODERATOR")),
      buildRbacApp(noAuthGuard),
    ]);
  });

  afterAll(async () => {
    await Promise.all([userApp.close(), moderatorApp.close(), noAuthApp.close()]);
  });

  beforeEach(() => jest.clearAllMocks());

  it("GET /admin/reports with USER role → 403", async () => {
    await request(userApp.getHttpServer())
      .get("/admin/reports")
      .expect(403);
  });

  it("GET /admin/users with MODERATOR role → 403 (ADMIN only)", async () => {
    await request(moderatorApp.getHttpServer())
      .get("/admin/users")
      .expect(403);
  });

  it("POST /admin/users/:id/ban with MODERATOR role → 403 (ADMIN only)", async () => {
    await request(moderatorApp.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/ban`)
      .send({ reason: "test", currentPassword: "pw" })
      .expect(403);
  });

  it("GET /admin/users without authentication → 401", async () => {
    const res = await request(noAuthApp.getHttpServer())
      .get("/admin/users")
      .expect(401);

    const body = res.body as { message?: { code?: string }; code?: string };
    const code = body.message?.code ?? body.code;
    expect(code).toBe("NOT_AUTHENTICATED");
  });

  it("POST /admin/users/:id/warn without authentication → 401", async () => {
    await request(noAuthApp.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/warn`)
      .send({ reason: "test", currentPassword: "pw" })
      .expect(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2 — Re-authentication
// ═════════════════════════════════════════════════════════════════════════════

describe("Suite 2 — Re-authentication (admin password verification)", () => {
  let app: INestApplication;
  let enforcementSvc: ReturnType<typeof buildEnforcementServiceMock>;

  const WARN_BODY = {
    reason: "Violation of community guidelines",
    currentPassword: "CorrectPass1!",
  };

  beforeAll(async () => {
    enforcementSvc = buildEnforcementServiceMock();
    app = await buildRbacApp(makeRoleGuard(ADMIN_ID, "ADMIN"), {
      enforcementSvc,
    });
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("POST /admin/users/:id/warn with correct password → 201", async () => {
    enforcementSvc.warnUser.mockResolvedValueOnce({
      action_id: "act-001",
      action_type: "WARN_USER",
      target_user: { id: TARGET_ID, display_name: "Alice", handle: "alice" },
      admin_id: ADMIN_ID,
      notes: WARN_BODY.reason,
      created_at: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/warn`)
      .send(WARN_BODY)
      .expect(201);

    expect(res.body).toHaveProperty("action_type", "WARN_USER");
    expect(enforcementSvc.warnUser).toHaveBeenCalledWith(
      ADMIN_ID,
      TARGET_ID,
      expect.objectContaining({ reason: WARN_BODY.reason }),
    );
  });

  it("POST /admin/users/:id/warn with wrong password → 401 INCORRECT_PASSWORD", async () => {
    enforcementSvc.warnUser.mockRejectedValueOnce(
      new UnauthorizedException({
        code: "INCORRECT_PASSWORD",
        message: "Incorrect password.",
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/warn`)
      .send({ ...WARN_BODY, currentPassword: "WrongPass1!" })
      .expect(401);

    const body = res.body as {
      message?: { code?: string } | string;
      code?: string;
    };
    const rawMessage = body.message;
    const code =
      typeof rawMessage === "object"
        ? rawMessage?.code
        : body.code ?? rawMessage;
    expect(String(code)).toMatch(/INCORRECT_PASSWORD/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3 — JWT Edge Cases
// ═════════════════════════════════════════════════════════════════════════════

describe("Suite 3 — JWT Edge Cases", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildJwtApp({ accountStatus: "ACTIVE" });
  });

  afterAll(() => app.close());

  it("Expired JWT → 401", async () => {
    const expiredToken = signToken(
      { sub: USER_A_ID, role: "ADMIN" },
      { expiresIn: -1 }, // already expired
    );

    await request(app.getHttpServer())
      .get("/admin/users")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);
  });

  it("JWT signed with wrong secret (tampered) → 401", async () => {
    const tamperedToken = jwt.sign(
      { sub: USER_A_ID, role: "ADMIN" },
      "completely-wrong-secret-that-does-not-match-anything",
      { issuer: "spotly-api", audience: "spotly-client", expiresIn: "15m" },
    );

    await request(app.getHttpServer())
      .get("/admin/users")
      .set("Authorization", `Bearer ${tamperedToken}`)
      .expect(401);
  });

  it("Valid JWT with correct secret → 200 (guard passes)", async () => {
    const validToken = signToken({ sub: USER_A_ID, role: "ADMIN" });

    await request(app.getHttpServer())
      .get("/admin/users")
      .set("Authorization", `Bearer ${validToken}`)
      .expect(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4 — IDOR (Insecure Direct Object Reference) Prevention
// ═════════════════════════════════════════════════════════════════════════════

describe("Suite 4 — IDOR Prevention", () => {
  let app: INestApplication;
  let notifSvc: ReturnType<typeof buildNotificationsServiceMock>;
  let messagesSvc: ReturnType<typeof buildMessagesServiceMock>;

  beforeAll(async () => {
    notifSvc = buildNotificationsServiceMock();
    messagesSvc = buildMessagesServiceMock();
    app = await buildIdorApp(notifSvc, messagesSvc);
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("User A marks User B's notification as read → 403 FORBIDDEN", async () => {
    notifSvc.markAsRead.mockRejectedValueOnce(
      new ForbiddenException({
        code: "FORBIDDEN",
        message: "Not your notification.",
      }),
    );

    const res = await request(app.getHttpServer())
      .patch(`/notifications/${NOTIF_B_ID}/read`)
      .expect(403);

    const body = res.body as {
      message?: { code?: string } | string;
      code?: string;
    };
    const rawMessage = body.message;
    const code =
      typeof rawMessage === "object" ? rawMessage?.code : body.code;
    expect(code).toBe("FORBIDDEN");

    // Service was called with USER_A's userId — ownership check happens in the service
    expect(notifSvc.markAsRead).toHaveBeenCalledWith(USER_A_ID, NOTIF_B_ID);
  });

  it("User A reads User B+C's private conversation → 404 (access denied, identity obscured)", async () => {
    // Implementation returns 404 rather than 403 to avoid revealing resource existence
    messagesSvc.getConversationMessages.mockRejectedValueOnce(
      new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found or you are not a participant.",
      }),
    );

    await request(app.getHttpServer())
      .get(`/messages/conversations/${CONVO_ID}`)
      .expect(404);

    // The service is called with USER_A's userId — non-participant check happens inside
    expect(messagesSvc.getConversationMessages).toHaveBeenCalledWith(
      USER_A_ID,
      CONVO_ID,
      expect.any(Number),
      expect.any(Number),
    );
  });
});
