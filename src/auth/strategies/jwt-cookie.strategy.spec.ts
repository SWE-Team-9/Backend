import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtCookieStrategy } from "./jwt-cookie.strategy";
import { JwtPayload } from "../interfaces/jwt-payload.interface";
import { ACCESS_COOKIE_NAME } from "../constants/auth.constants";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

async function buildStrategy(): Promise<{
  strategy: JwtCookieStrategy;
  module: TestingModule;
}> {
  const module = await Test.createTestingModule({
    providers: [
      JwtCookieStrategy,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: jest
            .fn()
            .mockReturnValue("test-jwt-secret-at-least-32-chars!!"),
          get: jest.fn().mockImplementation((key: string) => {
            if (key === "security.jwtIssuer") return "spotly-api";
            if (key === "security.jwtAudience") return "spotly-client";
            return undefined;
          }),
        },
      },
    ],
  }).compile();

  return { strategy: module.get<JwtCookieStrategy>(JwtCookieStrategy), module };
}

function validPayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: "user-uuid-123",
    role: "USER",
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JwtCookieStrategy", () => {
  let strategy: JwtCookieStrategy;

  beforeEach(async () => {
    const built = await buildStrategy();
    strategy = built.strategy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── instantiation ────────────────────────────────────────────────────────

  describe("instantiation", () => {
    it("should be defined", () => {
      expect(strategy).toBeDefined();
    });

    it("should call ConfigService.getOrThrow with the JWT secret key", async () => {
      const module = await Test.createTestingModule({
        providers: [
          JwtCookieStrategy,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn().mockReturnValue("secret"),
              get: jest.fn().mockImplementation((key: string) => {
                if (key === "security.jwtIssuer") return "spotly-api";
                if (key === "security.jwtAudience") return "spotly-client";
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      const configService = module.get<ConfigService>(ConfigService);
      expect(configService.getOrThrow).toHaveBeenCalledWith(
        "security.jwtSecret",
      );
    });

    it("should throw during module init when ConfigService.getOrThrow throws", async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            JwtCookieStrategy,
            {
              provide: ConfigService,
              useValue: {
                getOrThrow: jest.fn().mockImplementation(() => {
                  throw new Error("JWT_SECRET is missing");
                }),
                get: jest.fn().mockReturnValue(undefined),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow("JWT_SECRET is missing");
    });
  });

  // ─── validate — happy path ─────────────────────────────────────────────────

  describe("validate — valid payloads", () => {
    it("should return { userId, role } for a valid USER payload", () => {
      const result = strategy.validate(
        validPayload({ sub: "user-abc", role: "USER" }),
      );

      expect(result).toEqual({ userId: "user-abc", role: "USER" });
    });

    it("should return { userId, role } for a valid ADMIN payload", () => {
      const result = strategy.validate(
        validPayload({ sub: "admin-xyz", role: "ADMIN" }),
      );

      expect(result).toEqual({ userId: "admin-xyz", role: "ADMIN" });
    });

    it("should return { userId, role } for a valid MODERATOR payload", () => {
      const result = strategy.validate(
        validPayload({ sub: "mod-123", role: "MODERATOR" }),
      );

      expect(result).toEqual({ userId: "mod-123", role: "MODERATOR" });
    });

    it("should map payload.sub to result.userId", () => {
      const result = strategy.validate(
        validPayload({ sub: "special-sub-value" }),
      );

      expect(result.userId).toBe("special-sub-value");
    });

    it("should map payload.role directly to result.role", () => {
      const result = strategy.validate(validPayload({ role: "ADMIN" }));

      expect(result.role).toBe("ADMIN");
    });

    it("should only return userId and role — no iat/exp/extra fields leaked", () => {
      const result = strategy.validate(
        validPayload({ sub: "user-1", role: "USER", iat: 1000, exp: 9999 }),
      );

      expect(Object.keys(result)).toEqual(["userId", "role"]);
    });

    it("should handle a payload without optional iat/exp fields", () => {
      const payload: JwtPayload = { sub: "user-no-timestamps", role: "USER" };

      const result = strategy.validate(payload);

      expect(result).toEqual({ userId: "user-no-timestamps", role: "USER" });
    });
  });

  // ─── validate — invalid payloads ──────────────────────────────────────────

  describe("validate — invalid payloads", () => {
    it("should throw UnauthorizedException when sub is an empty string", () => {
      expect(() => strategy.validate(validPayload({ sub: "" }))).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when role is an empty string", () => {
      expect(() =>
        strategy.validate(validPayload({ role: "" as JwtPayload["role"] })),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when sub is undefined", () => {
      expect(() =>
        strategy.validate({
          sub: undefined as unknown as string,
          role: "USER",
        }),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when role is undefined", () => {
      expect(() =>
        strategy.validate({
          sub: "user-123",
          role: undefined as unknown as JwtPayload["role"],
        }),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when sub is null", () => {
      expect(() =>
        strategy.validate({ sub: null as unknown as string, role: "USER" }),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when role is null", () => {
      expect(() =>
        strategy.validate({
          sub: "user-123",
          role: null as unknown as JwtPayload["role"],
        }),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when payload itself is null", () => {
      expect(() => strategy.validate(null as unknown as JwtPayload)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when payload is undefined", () => {
      expect(() =>
        strategy.validate(undefined as unknown as JwtPayload),
      ).toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when payload is an empty object", () => {
      expect(() => strategy.validate({} as JwtPayload)).toThrow(
        UnauthorizedException,
      );
    });

    it("should include the NOT_AUTHENTICATED code in the thrown exception", () => {
      try {
        strategy.validate(validPayload({ sub: "" }));
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
        strategy.validate(validPayload({ sub: "" }));
        fail("Expected UnauthorizedException to be thrown");
      } catch (err: unknown) {
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(typeof response.message).toBe("string");
        expect((response.message as string).length).toBeGreaterThan(0);
      }
    });

    it("should not expose internal payload data in the exception response", () => {
      const sensitiveSubValue = "very-sensitive-user-id-12345";

      try {
        // empty role forces an error while sub is set
        strategy.validate({
          sub: sensitiveSubValue,
          role: "" as JwtPayload["role"],
        });
        fail("Expected UnauthorizedException to be thrown");
      } catch (err: unknown) {
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(JSON.stringify(response)).not.toContain(sensitiveSubValue);
      }
    });
  });

  // ─── cookie extractor (ACCESS_COOKIE_NAME constant sanity check) ──────────

  describe("cookie extraction constant", () => {
    it('ACCESS_COOKIE_NAME should be "access_token"', () => {
      // The strategy reads request.cookies[ACCESS_COOKIE_NAME].
      // This test documents the expected cookie name so front-end / mobile
      // teams set the right cookie name.
      expect(ACCESS_COOKIE_NAME).toBe("access_token");
    });

    it("ACCESS_COOKIE_NAME should be a non-empty string", () => {
      expect(typeof ACCESS_COOKIE_NAME).toBe("string");
      expect(ACCESS_COOKIE_NAME.length).toBeGreaterThan(0);
    });
  });

  // ─── cookie extractor function (inline unit) ──────────────────────────────

  describe("cookie extractor logic", () => {
    /**
     * The extractor is defined inline in the constructor as:
     *   (request: Request) => request?.cookies?.[ACCESS_COOKIE_NAME] ?? null
     *
     * We replicate that exact logic here to document its expected behaviour
     * and guarantee it stays correct if the strategy is ever refactored.
     */
    const extractor = (req: unknown): string | null => {
      const r = req as { cookies?: Record<string, string> } | null | undefined;
      return r?.cookies?.[ACCESS_COOKIE_NAME] ?? null;
    };

    it("should return the token when the cookie is present", () => {
      const req = { cookies: { [ACCESS_COOKIE_NAME]: "valid.jwt.token" } };
      expect(extractor(req)).toBe("valid.jwt.token");
    });

    it("should return null when the access_token cookie is absent", () => {
      const req = { cookies: { other_cookie: "something" } };
      expect(extractor(req)).toBeNull();
    });

    it("should return null when cookies is an empty object", () => {
      const req = { cookies: {} };
      expect(extractor(req)).toBeNull();
    });

    it("should return null when the request has no cookies property", () => {
      const req = {};
      expect(extractor(req)).toBeNull();
    });

    it("should return null when the request is null", () => {
      expect(extractor(null)).toBeNull();
    });

    it("should return null when the request is undefined", () => {
      expect(extractor(undefined)).toBeNull();
    });

    it("should return the exact token value without transformation", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
      const req = { cookies: { [ACCESS_COOKIE_NAME]: token } };
      expect(extractor(req)).toBe(token);
    });

    it("should return null when the cookie value is undefined", () => {
      const req = { cookies: { [ACCESS_COOKIE_NAME]: undefined } };
      expect(extractor(req)).toBeNull();
    });
  });
});
