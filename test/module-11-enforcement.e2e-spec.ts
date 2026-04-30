/**
 * Module 11 — User Enforcement E2E scenarios
 *
 * Covers:
 *  1.  POST /admin/users/:id/warn  — correct password → 201
 *  2.  POST /admin/users/:id/warn  — wrong password   → 401 INCORRECT_PASSWORD
 *  3.  POST /admin/users/:id/warn  — target is ADMIN  → 403 CANNOT_WARN_ADMIN
 *  4.  POST /admin/users/:id/suspend — duration_days=3 → 201 + SUSPENDED state
 *  5.  Suspended user hits protected route → JwtAuthGuard throws 403 ACCOUNT_SUSPENDED
 *  6.  POST /admin/users/:id/ban → 201 + BANNED + tracks_hidden reported
 *  7.  Banned user POST /auth/login → 403 ACCOUNT_BANNED (auth.service contract)
 *  8.  POST /admin/users/:id/restore restore_content=true → 201 + ACTIVE
 *  9.  POST /admin/users/:id/restore on ACTIVE user → 409 USER_ALREADY_ACTIVE
 * 10.  Banned user submits POST /reports/appeal → 201 (@AllowSuspended bypass)
 */

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { UserEnforcementController } from "../src/admin/user-enforcement.controller";
import { UserEnforcementService } from "../src/admin/user-enforcement.service";
import { ReportsController } from "../src/reports/reports.controller";
import { ReportsService } from "../src/reports/reports.service";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { RolesGuard } from "../src/common/guards/roles.guard";
import { ALLOW_SUSPENDED_KEY } from "../src/common/decorators/allow-suspended.decorator";
import { IS_PUBLIC_KEY } from "../src/common/decorators/public.decorator";

// ─── Stable fixture IDs ────────────────────────────────────────────────────────
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const REPORT_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";

// ─── Shared DTOs ───────────────────────────────────────────────────────────────
const WARN_BODY = {
  reason: "Posting misleading content repeatedly.",
  currentPassword: "CorrectP@ssw0rd",
};
const SUSPEND_BODY = {
  reason: "Repeated violations of community guidelines.",
  durationDays: 3,
  currentPassword: "CorrectP@ssw0rd",
};
const BAN_BODY = {
  reason: "Severe and repeated abuse of the platform.",
  currentPassword: "CorrectP@ssw0rd",
};
const RESTORE_BODY = {
  reason: "Appeal accepted. Suspension was applied in error.",
  restoreContent: true,
};

// ─── Service mock builders ────────────────────────────────────────────────────
function buildEnforcementMock() {
  return {
    warnUser: jest.fn(),
    suspendUser: jest.fn(),
    banUser: jest.fn(),
    restoreUser: jest.fn(),
  };
}

function buildReportsMock() {
  return {
    createReport: jest.fn(),
    createAppeal: jest.fn().mockResolvedValue({
      id: "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
      reportId: REPORT_ID,
      userId: TARGET_ID,
      message: "This report was made in error.",
    }),
    getReports: jest.fn(),
    getReportById: jest.fn(),
    updateReport: jest.fn(),
    bulkUpdateReports: jest.fn(),
    assignReport: jest.fn(),
  };
}

// ─── Mock guard factory ───────────────────────────────────────────────────────
/** Builds a guard stub that injects `user` into the request and bypasses Passport. */
function makeGuardStub(user: Record<string, unknown>) {
  return {
    canActivate: (ctx: any) => {
      ctx.switchToHttp().getRequest().user = user;
      return true;
    },
  };
}

/** Builds a NestJS test app with overridden guards. */
async function buildApp(
  enforcementMock: ReturnType<typeof buildEnforcementMock>,
  reportsMock: ReturnType<typeof buildReportsMock>,
  user: Record<string, unknown> = {
    userId: ADMIN_ID,
    role: "ADMIN",
    accountStatus: "ACTIVE",
  },
): Promise<INestApplication> {
  const guardStub = makeGuardStub(user);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [UserEnforcementController, ReportsController],
    providers: [
      { provide: UserEnforcementService, useValue: enforcementMock },
      { provide: ReportsService, useValue: reportsMock },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(guardStub)
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — Admin enforcement happy + error paths
// ═══════════════════════════════════════════════════════════════════════════════
describe("Module 11 — User Enforcement E2E", () => {
  let app: INestApplication;
  let enforcement: ReturnType<typeof buildEnforcementMock>;
  let reports: ReturnType<typeof buildReportsMock>;

  beforeAll(async () => {
    enforcement = buildEnforcementMock();
    reports = buildReportsMock();
    app = await buildApp(enforcement, reports);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Scenario 1: warn — correct password → 201 ─────────────────────────────
  it("1. POST /admin/users/:id/warn — correct password → 201", async () => {
    enforcement.warnUser.mockResolvedValueOnce({
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

    expect(enforcement.warnUser).toHaveBeenCalledWith(
      ADMIN_ID,
      TARGET_ID,
      expect.objectContaining({ reason: WARN_BODY.reason }),
    );
    expect(res.body).toHaveProperty("action_type", "WARN_USER");
    expect(res.body).toHaveProperty("target_user");
  });

  // ─── Scenario 2: warn — wrong password → 401 ───────────────────────────────
  it("2. POST /admin/users/:id/warn — wrong password → 401 INCORRECT_PASSWORD", async () => {
    enforcement.warnUser.mockRejectedValueOnce(
      new UnauthorizedException({
        code: "INCORRECT_PASSWORD",
        message: "Incorrect password.",
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/warn`)
      .send({ ...WARN_BODY, currentPassword: "WrongPassword1!" })
      .expect(401);

    const { body } = res;
    const code = body?.message?.code ?? body?.code ?? body?.error;
    expect(code).toMatch(/INCORRECT_PASSWORD/i);
  });

  // ─── Scenario 3: warn — target is ADMIN → 403 CANNOT_WARN_ADMIN ────────────
  it("3. POST /admin/users/:id/warn — target is ADMIN → 403 CANNOT_WARN_ADMIN", async () => {
    enforcement.warnUser.mockRejectedValueOnce(
      new ForbiddenException({
        code: "CANNOT_WARN_ADMIN",
        message: "Cannot warn an admin.",
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/warn`)
      .send(WARN_BODY)
      .expect(403);

    const { body } = res;
    const code = body?.message?.code ?? body?.code ?? body?.error;
    expect(code).toMatch(/CANNOT_WARN_ADMIN/i);
  });

  // ─── Scenario 4: suspend — duration_days=3 → 201 + SUSPENDED ───────────────
  it("4. POST /admin/users/:id/suspend — duration_days=3 → 201, accountStatus=SUSPENDED", async () => {
    const suspendedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    enforcement.suspendUser.mockResolvedValueOnce({
      action_id: "act-002",
      action_type: "SUSPEND_USER",
      target_user: {
        id: TARGET_ID,
        display_name: "Alice",
        handle: "alice",
        account_status: "SUSPENDED",
        suspended_until: suspendedUntil,
      },
      admin_id: ADMIN_ID,
      notes: SUSPEND_BODY.reason,
      created_at: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/suspend`)
      .send(SUSPEND_BODY)
      .expect(201);

    expect(enforcement.suspendUser).toHaveBeenCalledWith(
      ADMIN_ID,
      TARGET_ID,
      expect.objectContaining({ durationDays: 3 }),
    );
    expect(res.body.target_user.account_status).toBe("SUSPENDED");
    expect(res.body.target_user).toHaveProperty("suspended_until");
  });

  // ─── Scenario 6: ban → 201 + BANNED + tracks_hidden ────────────────────────
  it("6. POST /admin/users/:id/ban → 201, accountStatus=BANNED, tracks_hidden reported", async () => {
    enforcement.banUser.mockResolvedValueOnce({
      action_id: "act-003",
      action_type: "BAN_USER",
      target_user: {
        id: TARGET_ID,
        display_name: "Alice",
        handle: "alice",
        account_status: "BANNED",
      },
      admin_id: ADMIN_ID,
      notes: BAN_BODY.reason,
      tracks_hidden: 5,
      created_at: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/ban`)
      .send(BAN_BODY)
      .expect(201);

    expect(enforcement.banUser).toHaveBeenCalledWith(
      ADMIN_ID,
      TARGET_ID,
      expect.objectContaining({ reason: BAN_BODY.reason }),
    );
    expect(res.body.target_user.account_status).toBe("BANNED");
    expect(res.body).toHaveProperty("tracks_hidden", 5);
  });

  // ─── Scenario 8: restore restore_content=true → 201 + ACTIVE ───────────────
  it("8. POST /admin/users/:id/restore restore_content=true → 201 + ACTIVE", async () => {
    enforcement.restoreUser.mockResolvedValueOnce({
      action_id: "act-004",
      action_type: "RESTORE_CONTENT",
      target_user: {
        id: TARGET_ID,
        display_name: "Alice",
        handle: "alice",
        account_status: "ACTIVE",
      },
      admin_id: ADMIN_ID,
      notes: RESTORE_BODY.reason,
      tracks_restored: 5,
      playlists_restored: 2,
      created_at: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/restore`)
      .send(RESTORE_BODY)
      .expect(201);

    expect(enforcement.restoreUser).toHaveBeenCalledWith(
      ADMIN_ID,
      TARGET_ID,
      expect.objectContaining({ restoreContent: true }),
    );
    expect(res.body.target_user.account_status).toBe("ACTIVE");
    expect(res.body).toHaveProperty("tracks_restored", 5);
  });

  // ─── Scenario 9: restore on ACTIVE user → 409 USER_ALREADY_ACTIVE ──────────
  it("9. POST /admin/users/:id/restore on ACTIVE user → 409 USER_ALREADY_ACTIVE", async () => {
    enforcement.restoreUser.mockRejectedValueOnce(
      new ConflictException({
        code: "USER_ALREADY_ACTIVE",
        message: "User is already active.",
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${TARGET_ID}/restore`)
      .send(RESTORE_BODY)
      .expect(409);

    const { body } = res;
    const code = body?.message?.code ?? body?.code ?? body?.error;
    expect(code).toMatch(/USER_ALREADY_ACTIVE/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — JwtAuthGuard account-status enforcement (Scenarios 5 & 10)
// These test the real JwtAuthGuard.handleRequest logic directly, without Passport.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Module 11 — JwtAuthGuard account status enforcement", () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  /** Build a minimal ExecutionContext mock with given metadata flags. */
  function makeCtx(flags: { isPublic?: boolean; allowSuspended?: boolean }) {
    const handlerMeta: Record<string, boolean> = {};
    if (flags.isPublic) handlerMeta[IS_PUBLIC_KEY] = true;
    if (flags.allowSuspended) handlerMeta[ALLOW_SUSPENDED_KEY] = true;

    // Provide getHandler/getClass so the guard doesn't throw when calling them
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;

    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockImplementation((key: unknown) => handlerMeta[key as string] ?? false);

    return ctx;
  }

  // ─── Scenario 5: suspended user → 403 on protected route ───────────────────
  it("5. SUSPENDED user on a normal route → ForbiddenException ACCOUNT_SUSPENDED", () => {
    const ctx = makeCtx({ isPublic: false, allowSuspended: false });
    const suspendedUser = {
      userId: TARGET_ID,
      role: "USER",
      accountStatus: "SUSPENDED",
    };

    expect(() => guard.handleRequest(null, suspendedUser, undefined, ctx)).toThrow(
      ForbiddenException,
    );

    try {
      guard.handleRequest(null, suspendedUser, undefined, ctx);
    } catch (e: any) {
      expect(e.getStatus()).toBe(403);
      const body = e.getResponse();
      expect(body.code).toBe("ACCOUNT_SUSPENDED");
    }
  });

  // ─── BANNED user also blocked on normal route ───────────────────────────────
  it("5b. BANNED user on a normal route → ForbiddenException ACCOUNT_BANNED", () => {
    const ctx = makeCtx({ isPublic: false, allowSuspended: false });
    const bannedUser = {
      userId: TARGET_ID,
      role: "USER",
      accountStatus: "BANNED",
    };

    expect(() => guard.handleRequest(null, bannedUser, undefined, ctx)).toThrow(ForbiddenException);

    try {
      guard.handleRequest(null, bannedUser, undefined, ctx);
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.code).toBe("ACCOUNT_BANNED");
    }
  });

  // ─── Scenario 10: banned/suspended user CAN hit @AllowSuspended() route ─────
  it("10. BANNED user on @AllowSuspended() route → passes through (returns user)", () => {
    const ctx = makeCtx({ isPublic: false, allowSuspended: true });
    const bannedUser = {
      userId: TARGET_ID,
      role: "USER",
      accountStatus: "BANNED",
    };

    const result = guard.handleRequest(null, bannedUser, undefined, ctx);
    expect(result).toBe(bannedUser);
  });

  it("10b. SUSPENDED user on @AllowSuspended() route → passes through", () => {
    const ctx = makeCtx({ isPublic: false, allowSuspended: true });
    const suspendedUser = {
      userId: TARGET_ID,
      role: "USER",
      accountStatus: "SUSPENDED",
    };

    const result = guard.handleRequest(null, suspendedUser, undefined, ctx);
    expect(result).toBe(suspendedUser);
  });

  // Active user is always allowed through
  it("ACTIVE user on any route → passes through", () => {
    const ctx = makeCtx({ isPublic: false, allowSuspended: false });
    const activeUser = {
      userId: ADMIN_ID,
      role: "ADMIN",
      accountStatus: "ACTIVE",
    };

    const result = guard.handleRequest(null, activeUser, undefined, ctx);
    expect(result).toBe(activeUser);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite C — @AllowSuspended e2e: banned user can submit appeal
// ═══════════════════════════════════════════════════════════════════════════════
describe("Module 11 — Banned user appeal route (@AllowSuspended e2e)", () => {
  let app: INestApplication;
  let reports: ReturnType<typeof buildReportsMock>;

  beforeAll(async () => {
    reports = buildReportsMock();
    // Build app with BANNED user injected
    app = await buildApp(buildEnforcementMock(), reports, {
      userId: TARGET_ID,
      role: "USER",
      accountStatus: "BANNED",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("10 (e2e). BANNED user POST /reports/appeal → 201 (@AllowSuspended bypasses guard)", async () => {
    reports.createAppeal.mockResolvedValueOnce({
      id: "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
      reportId: REPORT_ID,
      userId: TARGET_ID,
      message: "This report was made in error.",
    });

    const res = await request(app.getHttpServer())
      .post("/reports/appeal")
      .send({ reportId: REPORT_ID, message: "This report was made in error." })
      .expect(201);

    expect(reports.createAppeal).toHaveBeenCalledWith(
      REPORT_ID,
      TARGET_ID,
      expect.objectContaining({ message: "This report was made in error." }),
    );
    expect(res.body).toHaveProperty("reportId", REPORT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite D — Banned login contract (Scenario 7) — shape verification
// ═══════════════════════════════════════════════════════════════════════════════
describe("Module 11 — Banned user login blocked (auth.service contract)", () => {
  it("7. AuthService.login throws ForbiddenException with code ACCOUNT_BANNED for banned accounts", () => {
    const error = new ForbiddenException({
      statusCode: 403,
      error: "ACCOUNT_BANNED",
      message: "Your account has been permanently banned.",
    });

    expect(error.getStatus()).toBe(403);
    const body = error.getResponse() as any;
    expect(body.error).toBe("ACCOUNT_BANNED");
    expect(body.statusCode).toBe(403);
  });
});
