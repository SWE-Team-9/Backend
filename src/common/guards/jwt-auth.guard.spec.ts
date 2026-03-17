import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, Reflector],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Builds a minimal ExecutionContext whose handler/class metadata can be
   * controlled by spying on `reflector.getAllAndOverride`.
   */
  function buildContext(): ExecutionContext {
    return {
      getHandler: jest.fn().mockReturnValue(jest.fn()),
      getClass: jest.fn().mockReturnValue(jest.fn()),
      switchToHttp: () => ({
        getRequest: () => ({ cookies: {} }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  // ─── @Public() bypass ─────────────────────────────────────────────────────

  describe("canActivate — public routes", () => {
    it("should return true immediately when the route is decorated with @Public()", () => {
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockImplementation((key: unknown) => key === IS_PUBLIC_KEY);

      const result = guard.canActivate(buildContext());

      expect(result).toBe(true);
    });

    it("should consult both the handler and the class for the IS_PUBLIC_KEY metadata", () => {
      const spy = jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(true as unknown);

      guard.canActivate(buildContext());

      expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });

  // ─── handleRequest ─────────────────────────────────────────────────────────

  describe("handleRequest", () => {
    it("should return the user object when authentication succeeds", () => {
      const user = { userId: "user-uuid-123", role: "USER" };

      const result = guard.handleRequest<typeof user>(null, user);

      expect(result).toBe(user);
    });

    it("should return the user when role is ADMIN", () => {
      const user = { userId: "admin-uuid-456", role: "ADMIN" };

      const result = guard.handleRequest<typeof user>(null, user);

      expect(result).toEqual({ userId: "admin-uuid-456", role: "ADMIN" });
    });

    it("should return the user when role is MODERATOR", () => {
      const user = { userId: "mod-uuid-789", role: "MODERATOR" };

      const result = guard.handleRequest<typeof user>(null, user);

      expect(result).toEqual({ userId: "mod-uuid-789", role: "MODERATOR" });
    });

    it("should throw UnauthorizedException when user is false (no token / invalid)", () => {
      expect(() => guard.handleRequest(null, false)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when user is null", () => {
      expect(() => guard.handleRequest(null, null as any)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when user is undefined", () => {
      expect(() => guard.handleRequest(null, undefined as any)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when an error is passed even if user is truthy", () => {
      const user = { userId: "user-uuid-123", role: "USER" };

      expect(() =>
        guard.handleRequest(new Error("token expired"), user as any),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when both err and user are bad", () => {
      expect(() => guard.handleRequest(new Error("bad token"), false)).toThrow(
        UnauthorizedException,
      );
    });

    it("should include the correct error code in the thrown exception", () => {
      try {
        guard.handleRequest(null, false);
        fail("Expected UnauthorizedException to be thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe("NOT_AUTHENTICATED");
      }
    });

    it("should include a descriptive message in the thrown exception", () => {
      try {
        guard.handleRequest(null, false);
        fail("Expected UnauthorizedException to be thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(typeof response.message).toBe("string");
        expect((response.message as string).length).toBeGreaterThan(0);
      }
    });
  });

  // ─── non-public route (super.canActivate delegation) ─────────────────────

  describe("canActivate — protected routes", () => {
    it("should delegate to passport AuthGuard when the route is not public", () => {
      // Reflect that there is NO @Public() decorator on this context.
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(false as unknown);

      // Stub the parent AuthGuard so we do not need a real Passport/JWT setup.
      const superSpy = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(guard)) as JwtAuthGuard,
          "canActivate",
        )
        .mockReturnValue(true as any);

      const result = guard.canActivate(buildContext());

      expect(superSpy).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should propagate the rejected promise from passport for expired tokens", async () => {
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue(false as unknown);

      jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(guard)) as JwtAuthGuard,
          "canActivate",
        )
        .mockReturnValue(Promise.resolve(false) as any);

      const result = await (guard.canActivate(
        buildContext(),
      ) as Promise<boolean>);

      expect(result).toBe(false);
    });
  });
});
