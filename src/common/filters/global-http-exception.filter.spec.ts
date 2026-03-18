import { HttpException, HttpStatus } from "@nestjs/common";
import { ArgumentsHost } from "@nestjs/common";
import { GlobalHttpExceptionFilter } from "./global-http-exception.filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHost(url = "/test/path"): ArgumentsHost {
  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const mockRequest = { url };

  return {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;
}

function getJsonPayload(host: ArgumentsHost) {
  const res = host.switchToHttp().getResponse() as any;
  return res.json.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

function getStatusCall(host: ArgumentsHost): number {
  const res = host.switchToHttp().getResponse() as any;
  return res.status.mock.calls[0]?.[0] as number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GlobalHttpExceptionFilter", () => {
  let filter: GlobalHttpExceptionFilter;

  beforeEach(() => {
    filter = new GlobalHttpExceptionFilter();
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("should always include statusCode, error, message, timestamp, and path", () => {
      const host = buildHost("/api/v1/auth/login");
      filter.catch(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
        host,
      );

      const payload = getJsonPayload(host)!;
      expect(payload).toHaveProperty("statusCode");
      expect(payload).toHaveProperty("error");
      expect(payload).toHaveProperty("message");
      expect(payload).toHaveProperty("timestamp");
      expect(payload).toHaveProperty("path");
    });

    it("should set path to the request URL", () => {
      const host = buildHost("/api/v1/profiles/me");
      filter.catch(new HttpException("Not Found", HttpStatus.NOT_FOUND), host);

      expect(getJsonPayload(host)!.path).toBe("/api/v1/profiles/me");
    });

    it("should set timestamp as a valid ISO-8601 date string", () => {
      const host = buildHost();
      filter.catch(
        new HttpException("Bad Request", HttpStatus.BAD_REQUEST),
        host,
      );

      const ts = getJsonPayload(host)!.timestamp as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP status codes
  // -------------------------------------------------------------------------

  describe("HTTP status code passthrough", () => {
    it.each([
      [HttpStatus.BAD_REQUEST, 400],
      [HttpStatus.UNAUTHORIZED, 401],
      [HttpStatus.FORBIDDEN, 403],
      [HttpStatus.NOT_FOUND, 404],
      [HttpStatus.CONFLICT, 409],
      [HttpStatus.UNPROCESSABLE_ENTITY, 422],
      [HttpStatus.TOO_MANY_REQUESTS, 429],
    ])(
      "should respond with %i for an HttpException with status %i",
      (inputStatus, expectedStatus) => {
        const host = buildHost();
        filter.catch(new HttpException("msg", inputStatus), host);

        expect(getStatusCall(host)).toBe(expectedStatus);
        expect(getJsonPayload(host)!.statusCode).toBe(expectedStatus);
      },
    );

    it("should respond with 500 for a plain Error (non-HTTP exception)", () => {
      const host = buildHost();
      filter.catch(new Error("something broke"), host);

      expect(getStatusCall(host)).toBe(500);
      expect(getJsonPayload(host)!.statusCode).toBe(500);
    });

    it("should respond with 500 for a thrown string", () => {
      const host = buildHost();
      filter.catch("oops" as unknown as Error, host);

      expect(getStatusCall(host)).toBe(500);
    });

    it("should respond with 500 for a thrown null", () => {
      const host = buildHost();
      filter.catch(null, host);

      expect(getStatusCall(host)).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Default error codes per status
  // -------------------------------------------------------------------------

  describe("default error code mapping", () => {
    it("should map 400 to VALIDATION_FAILED", () => {
      const host = buildHost();
      filter.catch(new HttpException("bad", HttpStatus.BAD_REQUEST), host);
      expect(getJsonPayload(host)!.error).toBe("VALIDATION_FAILED");
    });

    it("should map 401 to NOT_AUTHENTICATED", () => {
      const host = buildHost();
      filter.catch(new HttpException("unauth", HttpStatus.UNAUTHORIZED), host);
      expect(getJsonPayload(host)!.error).toBe("NOT_AUTHENTICATED");
    });

    it("should map 403 to FORBIDDEN", () => {
      const host = buildHost();
      filter.catch(new HttpException("forbidden", HttpStatus.FORBIDDEN), host);
      expect(getJsonPayload(host)!.error).toBe("FORBIDDEN");
    });

    it("should map 404 to NOT_FOUND", () => {
      const host = buildHost();
      filter.catch(new HttpException("not found", HttpStatus.NOT_FOUND), host);
      expect(getJsonPayload(host)!.error).toBe("NOT_FOUND");
    });

    it("should map 409 to CONFLICT", () => {
      const host = buildHost();
      filter.catch(new HttpException("conflict", HttpStatus.CONFLICT), host);
      expect(getJsonPayload(host)!.error).toBe("CONFLICT");
    });

    it("should map 429 to RATE_LIMIT_EXCEEDED", () => {
      const host = buildHost();
      filter.catch(
        new HttpException("too many", HttpStatus.TOO_MANY_REQUESTS),
        host,
      );
      expect(getJsonPayload(host)!.error).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("should map 500 (non-HTTP exception) to INTERNAL_SERVER_ERROR", () => {
      const host = buildHost();
      filter.catch(new Error("crash"), host);
      expect(getJsonPayload(host)!.error).toBe("INTERNAL_SERVER_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Message parsing — string body
  // -------------------------------------------------------------------------

  describe("string exception body", () => {
    it("should use the string directly as the message", () => {
      const host = buildHost();
      filter.catch(
        new HttpException("Email already in use", HttpStatus.CONFLICT),
        host,
      );
      expect(getJsonPayload(host)!.message).toBe("Email already in use");
    });
  });

  // -------------------------------------------------------------------------
  // Message parsing — object body with string message
  // -------------------------------------------------------------------------

  describe("object exception body — single string message", () => {
    it("should use message string from the exception response object", () => {
      const host = buildHost();
      filter.catch(
        new HttpException(
          { message: "Invalid credentials." },
          HttpStatus.UNAUTHORIZED,
        ),
        host,
      );
      expect(getJsonPayload(host)!.message).toBe("Invalid credentials.");
    });

    it("should prefer the custom code field over the default error code", () => {
      const host = buildHost();
      filter.catch(
        new HttpException(
          { code: "CAPTCHA_FAILED", message: "CAPTCHA verification failed." },
          HttpStatus.UNAUTHORIZED,
        ),
        host,
      );
      expect(getJsonPayload(host)!.error).toBe("CAPTCHA_FAILED");
    });

    it("should fall back to the error field if code is absent", () => {
      const host = buildHost();
      filter.catch(
        new HttpException(
          { error: "MY_CUSTOM_ERROR", message: "something" },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );
      expect(getJsonPayload(host)!.error).toBe("MY_CUSTOM_ERROR");
    });

    it("should fall back to default error code when neither code nor error is set", () => {
      const host = buildHost();
      filter.catch(
        new HttpException({ message: "Oops" }, HttpStatus.NOT_FOUND),
        host,
      );
      expect(getJsonPayload(host)!.error).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Message parsing — array of messages (ValidationPipe output)
  // -------------------------------------------------------------------------

  describe("object exception body — array of messages", () => {
    it("should join array messages into a single comma-separated string", () => {
      const host = buildHost();
      filter.catch(
        new HttpException(
          {
            message: ["email must be an email", "password is too weak"],
            error: "Bad Request",
          },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );
      expect(getJsonPayload(host)!.message).toBe(
        "email must be an email, password is too weak",
      );
    });

    it("should handle a single-element array", () => {
      const host = buildHost();
      filter.catch(
        new HttpException(
          { message: ["captchaToken must be a string"] },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );
      expect(getJsonPayload(host)!.message).toBe(
        "captchaToken must be a string",
      );
    });

    it("should handle an empty array with the fallback message", () => {
      const host = buildHost();
      filter.catch(
        new HttpException({ message: [] }, HttpStatus.BAD_REQUEST),
        host,
      );
      // An empty join produces an empty string — the filter should still not crash
      const payload = getJsonPayload(host)!;
      expect(payload).toHaveProperty("message");
    });
  });

  // -------------------------------------------------------------------------
  // Non-HTTP exceptions — fallback behaviour
  // -------------------------------------------------------------------------

  describe("non-HTTP exceptions", () => {
    it("should return a safe fallback message for plain Error", () => {
      const host = buildHost();
      filter.catch(new Error("DB connection lost"), host);

      const payload = getJsonPayload(host)!;
      expect(payload.message).toBe("An unexpected error occurred.");
      expect(payload.error).toBe("INTERNAL_SERVER_ERROR");
    });

    it("should not expose the internal error message to the client", () => {
      const host = buildHost();
      filter.catch(new Error("secret internal detail"), host);

      const payload = getJsonPayload(host)!;
      expect(payload.message).not.toContain("secret internal detail");
    });
  });

  // -------------------------------------------------------------------------
  // Guard integration scenario — simulating guard-thrown exceptions
  // -------------------------------------------------------------------------

  describe("guard-thrown exception scenarios", () => {
    it("should handle JwtAuthGuard NOT_AUTHENTICATED exception", () => {
      const host = buildHost("/api/v1/profiles/me");
      filter.catch(
        new HttpException(
          {
            code: "NOT_AUTHENTICATED",
            message: "Authentication is required to access this resource.",
          },
          HttpStatus.UNAUTHORIZED,
        ),
        host,
      );

      const payload = getJsonPayload(host)!;
      expect(payload.statusCode).toBe(401);
      expect(payload.error).toBe("NOT_AUTHENTICATED");
      expect(payload.message).toBe(
        "Authentication is required to access this resource.",
      );
    });

    it("should handle RolesGuard FORBIDDEN exception", () => {
      const host = buildHost("/api/v1/admin/users");
      filter.catch(
        new HttpException(
          {
            code: "FORBIDDEN",
            message: "You do not have permission to access this resource.",
          },
          HttpStatus.FORBIDDEN,
        ),
        host,
      );

      const payload = getJsonPayload(host)!;
      expect(payload.statusCode).toBe(403);
      expect(payload.error).toBe("FORBIDDEN");
    });

    it("should handle ThrottlerGuard rate-limit exception", () => {
      const host = buildHost("/api/v1/auth/login");
      filter.catch(
        new HttpException(
          "ThrottlerException: Too Many Requests",
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        host,
      );

      const payload = getJsonPayload(host)!;
      expect(payload.statusCode).toBe(429);
      expect(payload.error).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
