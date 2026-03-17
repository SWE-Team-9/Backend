import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { RolesGuard } from "./roles.guard";
import { ROLES_KEY } from "../decorators/roles.decorator";

describe("RolesGuard", () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Builds a minimal ExecutionContext whose request carries the given user
   * and whose reflector metadata returns the given requiredRoles.
   */
  function buildContext(
    userRole: string | undefined,
    requiredRoles: string[] | undefined,
  ): ExecutionContext {
    jest
      .spyOn(reflector, "getAllAndOverride")
      .mockImplementation((key: unknown) =>
        key === ROLES_KEY ? requiredRoles : undefined,
      );

    return {
      getHandler: jest.fn().mockReturnValue(() => {}),
      getClass: jest.fn().mockReturnValue(() => {}),
      switchToHttp: () => ({
        getRequest: () => ({
          user:
            userRole !== undefined
              ? { userId: "user-123", role: userRole }
              : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  // ─── No roles required ────────────────────────────────────────────────────

  describe("when no roles are required on the route", () => {
    it("should return true when requiredRoles is undefined", () => {
      const ctx = buildContext("USER", undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true when requiredRoles is an empty array", () => {
      const ctx = buildContext("USER", []);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true even when there is no user on the request", () => {
      const ctx = buildContext(undefined, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should consult both handler and class metadata via the ROLES_KEY", () => {
      const spy = jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(undefined as any);

      const ctx = buildContext("USER", undefined);
      guard.canActivate(ctx);

      expect(spy).toHaveBeenCalledWith(ROLES_KEY, [
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });

  // ─── Role match ───────────────────────────────────────────────────────────

  describe("when the user has the exact required role", () => {
    it("should return true for a USER accessing a USER-only route", () => {
      const ctx = buildContext("USER", ["USER"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true for an ADMIN accessing an ADMIN-only route", () => {
      const ctx = buildContext("ADMIN", ["ADMIN"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true for a MODERATOR accessing a MODERATOR-only route", () => {
      const ctx = buildContext("MODERATOR", ["MODERATOR"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe("when multiple roles are accepted and the user has one of them", () => {
    it("should return true for ADMIN when route accepts [USER, ADMIN]", () => {
      const ctx = buildContext("ADMIN", ["USER", "ADMIN"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true for USER when route accepts [USER, MODERATOR]", () => {
      const ctx = buildContext("USER", ["USER", "MODERATOR"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("should return true for MODERATOR when route accepts [USER, MODERATOR, ADMIN]", () => {
      const ctx = buildContext("MODERATOR", ["USER", "MODERATOR", "ADMIN"]);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // ─── Role mismatch ────────────────────────────────────────────────────────

  describe("when the user does not have the required role", () => {
    it("should throw ForbiddenException when USER tries to access an ADMIN-only route", () => {
      const ctx = buildContext("USER", ["ADMIN"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when USER tries to access a MODERATOR-only route", () => {
      const ctx = buildContext("USER", ["MODERATOR"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when MODERATOR tries to access an ADMIN-only route", () => {
      const ctx = buildContext("MODERATOR", ["ADMIN"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when USER tries to access a [MODERATOR, ADMIN] route", () => {
      const ctx = buildContext("USER", ["MODERATOR", "ADMIN"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should include the FORBIDDEN error code in the exception response", () => {
      const ctx = buildContext("USER", ["ADMIN"]);

      try {
        guard.canActivate(ctx);
        fail("Expected ForbiddenException to be thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const response = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe("FORBIDDEN");
      }
    });

    it("should include a descriptive message in the exception response", () => {
      const ctx = buildContext("USER", ["ADMIN"]);

      try {
        guard.canActivate(ctx);
        fail("Expected ForbiddenException to be thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const response = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(typeof response.message).toBe("string");
        expect((response.message as string).length).toBeGreaterThan(0);
      }
    });

    it("should NOT expose which roles are required in the exception message", () => {
      const ctx = buildContext("USER", ["ADMIN"]);

      try {
        guard.canActivate(ctx);
        fail("Expected ForbiddenException to be thrown");
      } catch (err: unknown) {
        const response = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        // Security: do not hint at which roles would be accepted
        expect(response.message).not.toContain("ADMIN");
      }
    });
  });

  // ─── No user on request ───────────────────────────────────────────────────

  describe("when there is no authenticated user on the request", () => {
    it("should throw ForbiddenException when user is undefined and roles are required", () => {
      const ctx = buildContext(undefined, ["USER"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user is undefined and ADMIN role is required", () => {
      const ctx = buildContext(undefined, ["ADMIN"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user object exists but role property is missing", () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["USER"]);

      const ctx = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getClass: jest.fn().mockReturnValue(() => {}),
        switchToHttp: () => ({
          getRequest: () => ({
            // user exists but has no role field
            user: { userId: "user-123" },
          }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user is null and roles are required", () => {
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["USER"]);

      const ctx = {
        getHandler: jest.fn().mockReturnValue(() => {}),
        getClass: jest.fn().mockReturnValue(() => {}),
        switchToHttp: () => ({
          getRequest: () => ({ user: null }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should include FORBIDDEN code when user is missing", () => {
      const ctx = buildContext(undefined, ["ADMIN"]);

      try {
        guard.canActivate(ctx);
        fail("Expected ForbiddenException to be thrown");
      } catch (err: unknown) {
        const response = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe("FORBIDDEN");
      }
    });
  });

  // ─── Role case sensitivity ─────────────────────────────────────────────────

  describe("role string matching is case-sensitive", () => {
    it("should throw ForbiddenException when role casing does not match (user vs USER)", () => {
      const ctx = buildContext("user", ["USER"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when role casing does not match (Admin vs ADMIN)", () => {
      const ctx = buildContext("Admin", ["ADMIN"]);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});
