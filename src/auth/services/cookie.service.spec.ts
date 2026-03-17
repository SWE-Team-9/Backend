import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { CookieService } from "./cookie.service";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS,
} from "../constants/auth.constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockResponse(): { cookie: jest.Mock } {
  return { cookie: jest.fn() };
}

/** Pull a specific call's arguments as a plain any[] so TS tuple limits don't bite. */
function callArgs(mock: jest.Mock, callIndex: number): any[] {
  return mock.mock.calls[callIndex] as any[];
}

function buildModule(secureCookie: boolean): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      CookieService,
      {
        provide: ConfigService,
        useValue: {
          get: jest
            .fn()
            .mockImplementation((key: string, fallback?: unknown) => {
              if (key === "security.authCookieSecure") return secureCookie;
              return fallback;
            }),
        },
      },
    ],
  }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CookieService", () => {
  describe("when AUTH_COOKIE_SECURE = false (development)", () => {
    let service: CookieService;

    beforeEach(async () => {
      const module = await buildModule(false);
      service = module.get<CookieService>(CookieService);
    });

    // ── setAuthCookies ────────────────────────────────────────────────────

    describe("setAuthCookies", () => {
      it("should call response.cookie exactly twice", () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(res.cookie).toHaveBeenCalledTimes(2);
      });

      it("should set the access token cookie with the correct name and value", () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "my-access-token",
          refreshToken: "my-refresh-token",
        });
        expect(callArgs(res.cookie, 0)[0]).toBe(ACCESS_COOKIE_NAME);
        expect(callArgs(res.cookie, 0)[1]).toBe("my-access-token");
      });

      it("should set the refresh token cookie with the correct name and value", () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "my-access-token",
          refreshToken: "my-refresh-token",
        });
        expect(callArgs(res.cookie, 1)[0]).toBe(REFRESH_COOKIE_NAME);
        expect(callArgs(res.cookie, 1)[1]).toBe("my-refresh-token");
      });

      it("should mark both cookies as httpOnly", () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ httpOnly: true });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ httpOnly: true });
      });

      it('should set sameSite to "strict" on both cookies', () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({
          sameSite: "strict",
        });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({
          sameSite: "strict",
        });
      });

      it('should set path to "/" on both cookies', () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ path: "/" });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ path: "/" });
      });

      it("should NOT set the secure flag in development", () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ secure: false });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ secure: false });
      });

      it(`should set access token maxAge to ${ACCESS_TOKEN_TTL_SECONDS * 1000}ms`, () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({
          maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
        });
      });

      it(`should set refresh token maxAge to ${REFRESH_TOKEN_TTL_SECONDS * 1000}ms when rememberMe is false`, () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
          rememberMe: false,
        });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({
          maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
        });
      });

      it(`should set refresh token maxAge to ${REFRESH_TOKEN_TTL_SECONDS * 1000}ms by default (no rememberMe arg)`, () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
        });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({
          maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
        });
      });

      it(`should set refresh token maxAge to ${REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS * 1000}ms when rememberMe is true`, () => {
        const res = buildMockResponse();
        service.setAuthCookies({
          response: res as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
          rememberMe: true,
        });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({
          maxAge: REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS * 1000,
        });
      });

      it("rememberMe TTL should be longer than standard TTL", () => {
        expect(REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS).toBeGreaterThan(
          REFRESH_TOKEN_TTL_SECONDS,
        );
      });

      it("access token TTL should always be the same regardless of rememberMe", () => {
        const res1 = buildMockResponse();
        const res2 = buildMockResponse();

        service.setAuthCookies({
          response: res1 as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
          rememberMe: false,
        });
        service.setAuthCookies({
          response: res2 as unknown as Response,
          accessToken: "at",
          refreshToken: "rt",
          rememberMe: true,
        });

        const opts1 = callArgs(res1.cookie, 0)[2] as { maxAge: number };
        const opts2 = callArgs(res2.cookie, 0)[2] as { maxAge: number };
        expect(opts1.maxAge).toBe(opts2.maxAge);
      });
    });

    // ── clearAuthCookies ──────────────────────────────────────────────────

    describe("clearAuthCookies", () => {
      it("should call response.cookie exactly twice", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(res.cookie).toHaveBeenCalledTimes(2);
      });

      it("should clear the access token cookie by name", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[0]).toBe(ACCESS_COOKIE_NAME);
      });

      it("should clear the refresh token cookie by name", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 1)[0]).toBe(REFRESH_COOKIE_NAME);
      });

      it("should set the access token value to an empty string", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[1]).toBe("");
      });

      it("should set the refresh token value to an empty string", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 1)[1]).toBe("");
      });

      it("should set maxAge to 0 on the access token cookie", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ maxAge: 0 });
      });

      it("should set maxAge to 0 on the refresh token cookie", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ maxAge: 0 });
      });

      it("should keep httpOnly=true when clearing", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ httpOnly: true });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ httpOnly: true });
      });

      it('should keep sameSite="strict" when clearing', () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({
          sameSite: "strict",
        });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({
          sameSite: "strict",
        });
      });

      it("should keep the same secure flag as during set", () => {
        const res = buildMockResponse();
        service.clearAuthCookies(res as unknown as Response);
        expect(callArgs(res.cookie, 0)[2]).toMatchObject({ secure: false });
        expect(callArgs(res.cookie, 1)[2]).toMatchObject({ secure: false });
      });
    });
  });

  // ── secure flag in production ────────────────────────────────────────────

  describe("when AUTH_COOKIE_SECURE = true (production)", () => {
    let service: CookieService;

    beforeEach(async () => {
      const module = await buildModule(true);
      service = module.get<CookieService>(CookieService);
    });

    it("should set secure=true on the access token cookie", () => {
      const res = buildMockResponse();
      service.setAuthCookies({
        response: res as unknown as Response,
        accessToken: "at",
        refreshToken: "rt",
      });
      expect(callArgs(res.cookie, 0)[2]).toMatchObject({ secure: true });
    });

    it("should set secure=true on the refresh token cookie", () => {
      const res = buildMockResponse();
      service.setAuthCookies({
        response: res as unknown as Response,
        accessToken: "at",
        refreshToken: "rt",
      });
      expect(callArgs(res.cookie, 1)[2]).toMatchObject({ secure: true });
    });

    it("should set secure=true when clearing cookies in production", () => {
      const res = buildMockResponse();
      service.clearAuthCookies(res as unknown as Response);
      expect(callArgs(res.cookie, 0)[2]).toMatchObject({ secure: true });
      expect(callArgs(res.cookie, 1)[2]).toMatchObject({ secure: true });
    });

    it("should still mark cookies as httpOnly in production", () => {
      const res = buildMockResponse();
      service.setAuthCookies({
        response: res as unknown as Response,
        accessToken: "at",
        refreshToken: "rt",
      });
      expect(callArgs(res.cookie, 0)[2]).toMatchObject({ httpOnly: true });
      expect(callArgs(res.cookie, 1)[2]).toMatchObject({ httpOnly: true });
    });

    it('should still use sameSite="strict" in production', () => {
      const res = buildMockResponse();
      service.setAuthCookies({
        response: res as unknown as Response,
        accessToken: "at",
        refreshToken: "rt",
      });
      expect(callArgs(res.cookie, 0)[2]).toMatchObject({ sameSite: "strict" });
      expect(callArgs(res.cookie, 1)[2]).toMatchObject({ sameSite: "strict" });
    });
  });

  // ── cookie name constants sanity check ───────────────────────────────────

  describe("cookie name constants", () => {
    it("ACCESS_COOKIE_NAME should be a non-empty string", () => {
      expect(typeof ACCESS_COOKIE_NAME).toBe("string");
      expect(ACCESS_COOKIE_NAME.length).toBeGreaterThan(0);
    });

    it("REFRESH_COOKIE_NAME should be a non-empty string", () => {
      expect(typeof REFRESH_COOKIE_NAME).toBe("string");
      expect(REFRESH_COOKIE_NAME.length).toBeGreaterThan(0);
    });

    it("ACCESS_COOKIE_NAME and REFRESH_COOKIE_NAME should be different", () => {
      expect(ACCESS_COOKIE_NAME).not.toBe(REFRESH_COOKIE_NAME);
    });
  });
});
