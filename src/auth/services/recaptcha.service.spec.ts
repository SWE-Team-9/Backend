import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { RecaptchaService } from "./recaptcha.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildModule(
  recaptchaSecret: string | undefined,
): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      RecaptchaService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockReturnValue(recaptchaSecret),
        },
      },
    ],
  }).compile();
}

function mockFetch(ok: boolean, body: unknown): void {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecaptchaService", () => {
  let service: RecaptchaService;
  let configService: jest.Mocked<ConfigService>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Dev-mode bypass (no secret configured) ────────────────────────────────

  describe("when RECAPTCHA_SECRET is not configured (dev mode)", () => {
    beforeEach(async () => {
      const module = await buildModule(undefined);
      service = module.get(RecaptchaService);
      configService = module.get(ConfigService);
    });

    it("should NOT throw and should return { success: true }", async () => {
      const result = await service.verifyToken("any-token");
      expect(result).toEqual({ success: true });
    });

    it("should NOT call the Google reCAPTCHA endpoint", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await service.verifyToken("any-token");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should still return success when token is an empty string in dev mode", async () => {
      const result = await service.verifyToken("");
      expect(result).toEqual({ success: true });
    });

    it("should consult ConfigService for the secret on every call", async () => {
      await service.verifyToken("t1");
      await service.verifyToken("t2");
      // configService.get is called once per verifyToken invocation
      expect(configService.get).toHaveBeenCalledTimes(2);
      expect(configService.get).toHaveBeenCalledWith(
        "security.recaptchaSecret",
      );
    });
  });

  // ─── Missing / empty token (secret IS configured) ──────────────────────────

  describe("when RECAPTCHA_SECRET is configured but the token is absent", () => {
    beforeEach(async () => {
      const module = await buildModule("real-secret");
      service = module.get(RecaptchaService);
    });

    it("should throw UnauthorizedException for an empty string token", async () => {
      await expect(service.verifyToken("")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException for a whitespace-only token", async () => {
      await expect(service.verifyToken("   ")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should include the CAPTCHA_TOKEN_MISSING code in the exception", async () => {
      try {
        await service.verifyToken("");
        fail("Expected UnauthorizedException");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe("CAPTCHA_TOKEN_MISSING");
      }
    });

    it("should NOT reach the Google endpoint when token is missing", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await expect(service.verifyToken("")).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─── fetch() network failure ───────────────────────────────────────────────

  describe("when the Google reCAPTCHA endpoint is unreachable", () => {
    beforeEach(async () => {
      const module = await buildModule("real-secret");
      service = module.get(RecaptchaService);
    });

    it("should throw ServiceUnavailableException when fetch rejects (network error)", async () => {
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.verifyToken("valid-token")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should throw ServiceUnavailableException when fetch resolves with ok=false", async () => {
      mockFetch(false, {});

      await expect(service.verifyToken("valid-token")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should include CAPTCHA_UNAVAILABLE code when fetch rejects", async () => {
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));

      try {
        await service.verifyToken("valid-token");
        fail("Expected ServiceUnavailableException");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const response = (
          err as ServiceUnavailableException
        ).getResponse() as Record<string, unknown>;
        expect(response.code).toBe("CAPTCHA_UNAVAILABLE");
      }
    });

    it("should include CAPTCHA_UNAVAILABLE code when fetch returns ok=false", async () => {
      mockFetch(false, {});

      try {
        await service.verifyToken("valid-token");
        fail("Expected ServiceUnavailableException");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const response = (
          err as ServiceUnavailableException
        ).getResponse() as Record<string, unknown>;
        expect(response.code).toBe("CAPTCHA_UNAVAILABLE");
      }
    });

    it("should handle fetch resolving with HTTP 500 (ok=false, no body)", async () => {
      mockFetch(false, null);

      await expect(service.verifyToken("any-token")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── CAPTCHA verification fails (Google says success:false) ───────────────

  describe("when Google responds with success: false", () => {
    beforeEach(async () => {
      const module = await buildModule("real-secret");
      service = module.get(RecaptchaService);
    });

    it("should throw UnauthorizedException", async () => {
      mockFetch(true, { success: false });

      await expect(service.verifyToken("bad-token")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should include CAPTCHA_FAILED code in the exception", async () => {
      mockFetch(true, {
        success: false,
        "error-codes": ["invalid-input-response"],
      });

      try {
        await service.verifyToken("bad-token");
        fail("Expected UnauthorizedException");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.code).toBe("CAPTCHA_FAILED");
      }
    });

    it("should include a human-readable message in the exception", async () => {
      mockFetch(true, { success: false });

      try {
        await service.verifyToken("bad-token");
        fail("Expected UnauthorizedException");
      } catch (err: unknown) {
        const response = (err as UnauthorizedException).getResponse() as Record<
          string,
          unknown
        >;
        expect(typeof response.message).toBe("string");
        expect((response.message as string).length).toBeGreaterThan(0);
      }
    });

    it("should throw even when error-codes array is empty", async () => {
      mockFetch(true, { success: false, "error-codes": [] });

      await expect(service.verifyToken("empty-errors")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── CAPTCHA verification succeeds ────────────────────────────────────────

  describe("when Google responds with success: true", () => {
    beforeEach(async () => {
      const module = await buildModule("real-secret");
      service = module.get(RecaptchaService);
    });

    it("should resolve without throwing", async () => {
      mockFetch(true, { success: true });

      await expect(service.verifyToken("good-token")).resolves.not.toThrow();
    });

    it("should return the full response object from Google", async () => {
      const googlePayload = {
        success: true,
        score: 0.9,
        action: "register",
        challenge_ts: "2024-01-01T00:00:00Z",
        hostname: "localhost",
      };
      mockFetch(true, googlePayload);

      const result = await service.verifyToken("good-token");
      expect(result).toEqual(googlePayload);
    });

    it("should return success:true with a high score for a legitimate user", async () => {
      mockFetch(true, { success: true, score: 0.95 });

      const result = await service.verifyToken("legit-token");
      expect(result.success).toBe(true);
      expect(result.score).toBe(0.95);
    });

    it("should send the token and secret to Google as form-encoded body", async () => {
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      } as unknown as Response);

      await service.verifyToken("my-captcha-token");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.google.com/recaptcha/api/siteverify",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        }),
      );

      // Verify the body contains the token
      const callBody = (fetchSpy.mock.calls[0][1] as RequestInit)
        .body as URLSearchParams;
      expect(callBody.get("response")).toBe("my-captcha-token");
      expect(callBody.get("secret")).toBe("real-secret");
    });

    it("should append remoteip to the request body when provided", async () => {
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      } as unknown as Response);

      await service.verifyToken("good-token", "192.168.1.1");

      const callBody = (fetchSpy.mock.calls[0][1] as RequestInit)
        .body as URLSearchParams;
      expect(callBody.get("remoteip")).toBe("192.168.1.1");
    });

    it("should NOT append remoteip when it is not provided", async () => {
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      } as unknown as Response);

      await service.verifyToken("good-token");

      const callBody = (fetchSpy.mock.calls[0][1] as RequestInit)
        .body as URLSearchParams;
      expect(callBody.get("remoteip")).toBeNull();
    });
  });
});
