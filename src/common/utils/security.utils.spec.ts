import { Request } from "express";
import {
  extractClientIp,
  sanitizeHandle,
  isValidHandle,
  isSafeExternalUrl,
  timingSafeStringEqual,
  normalizeUserAgent,
  assertTokenEntropy,
} from "./security.utils";

// =============================================================================
// Security Utils — Unit Tests
// Member 1 (Backend Lead + Security Owner)
//
// OWASP coverage:
//   A01 — Broken Access Control    : IP extraction for audit / rate-limit keys
//   A03 — Injection                : handle sanitisation, URL allow-list
//   A07 — Auth Failures            : timing-safe comparison
//   A10 — SSRF                     : isSafeExternalUrl
// =============================================================================

// ---------------------------------------------------------------------------
// Helper — build a minimal Express-like Request object
// ---------------------------------------------------------------------------

function buildRequest(
  overrides: {
    headers?: Record<string, string | string[]>;
    ip?: string;
    remoteAddress?: string;
  } = {},
): Request {
  return {
    headers: overrides.headers ?? {},
    ip: overrides.ip ?? "127.0.0.1",
    socket: { remoteAddress: overrides.remoteAddress ?? "127.0.0.1" },
  } as unknown as Request;
}

// =============================================================================
// extractClientIp
// =============================================================================

describe("extractClientIp", () => {
  // ── X-Forwarded-For ─────────────────────────────────────────────────────────

  describe("X-Forwarded-For header", () => {
    it("should return the first IP from X-Forwarded-For when present", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1, 192.168.1.1" },
      });
      expect(extractClientIp(req)).toBe("203.0.113.1");
    });

    it("should handle a single IP in X-Forwarded-For", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "203.0.113.42" },
      });
      expect(extractClientIp(req)).toBe("203.0.113.42");
    });

    it("should trim whitespace from X-Forwarded-For entries", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "  203.0.113.5  , 10.0.0.2" },
      });
      expect(extractClientIp(req)).toBe("203.0.113.5");
    });

    it("should fall through when X-Forwarded-For contains garbage", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "not-an-ip" },
        ip: "10.0.0.1",
      });
      // Garbage first entry — should fall through to req.ip
      const ip = extractClientIp(req);
      expect(ip).toBeTruthy();
      expect(typeof ip).toBe("string");
    });

    it("should fall through when X-Forwarded-For is an empty string", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "" },
        ip: "198.51.100.1",
      });
      expect(extractClientIp(req)).toBe("198.51.100.1");
    });
  });

  // ── X-Real-IP ───────────────────────────────────────────────────────────────

  describe("X-Real-IP header", () => {
    it("should return X-Real-IP when X-Forwarded-For is absent", () => {
      const req = buildRequest({
        headers: { "x-real-ip": "198.51.100.77" },
        ip: "10.0.0.1",
      });
      expect(extractClientIp(req)).toBe("198.51.100.77");
    });

    it("should fall through to req.ip when X-Real-IP is garbage", () => {
      const req = buildRequest({
        headers: { "x-real-ip": "invalid" },
        ip: "198.51.100.1",
      });
      const ip = extractClientIp(req);
      expect(ip).toBeTruthy();
    });
  });

  // ── req.ip fallback ─────────────────────────────────────────────────────────

  describe("req.ip fallback", () => {
    it("should return req.ip when no proxy headers are present", () => {
      const req = buildRequest({ ip: "203.0.113.100" });
      expect(extractClientIp(req)).toBe("203.0.113.100");
    });

    it("should return socket remoteAddress as last resort", () => {
      const req = {
        headers: {},
        ip: undefined,
        socket: { remoteAddress: "203.0.113.200" },
      } as unknown as Request;
      expect(extractClientIp(req)).toBe("203.0.113.200");
    });

    it('should return "unknown" when everything is missing', () => {
      const req = {
        headers: {},
        ip: undefined,
        socket: { remoteAddress: undefined },
      } as unknown as Request;
      expect(extractClientIp(req)).toBe("unknown");
    });
  });

  // ── IPv6 ────────────────────────────────────────────────────────────────────

  describe("IPv6 addresses", () => {
    it("should accept a valid IPv6 address from X-Forwarded-For", () => {
      const req = buildRequest({
        headers: { "x-forwarded-for": "2001:db8::1" },
      });
      const ip = extractClientIp(req);
      expect(ip).toBe("2001:db8::1");
    });

    it("should accept loopback IPv6 ::1", () => {
      const req = buildRequest({ ip: "::1" });
      expect(extractClientIp(req)).toBe("::1");
    });
  });
});

// =============================================================================
// sanitizeHandle
// =============================================================================

describe("sanitizeHandle", () => {
  it("should lowercase the input", () => {
    expect(sanitizeHandle("DJKHALED")).toBe("djkhaled");
  });

  it("should replace spaces with underscores", () => {
    expect(sanitizeHandle("DJ Khaled")).toBe("dj_khaled");
  });

  it("should replace special characters with underscores", () => {
    expect(sanitizeHandle("DJ Khaled!!")).toBe("dj_khaled");
  });

  it("should collapse multiple non-alphanumeric chars into a single underscore", () => {
    expect(sanitizeHandle("hello   world")).toBe("hello_world");
    expect(sanitizeHandle("hello---world")).toBe("hello_world");
    expect(sanitizeHandle("hello!@#world")).toBe("hello_world");
  });

  it("should strip leading underscores", () => {
    expect(sanitizeHandle("___hello")).toBe("hello");
  });

  it("should strip trailing underscores", () => {
    expect(sanitizeHandle("hello___")).toBe("hello");
  });

  it("should truncate to 30 characters", () => {
    const long = "a".repeat(50);
    expect(sanitizeHandle(long).length).toBeLessThanOrEqual(30);
  });

  it('should fall back to "user" for an empty string', () => {
    expect(sanitizeHandle("")).toBe("user");
  });

  it('should fall back to "user" when the result after sanitisation is empty', () => {
    expect(sanitizeHandle("!!!")).toBe("user");
    expect(sanitizeHandle("   ")).toBe("user");
  });

  it("should preserve underscores that are already in the input", () => {
    expect(sanitizeHandle("hello_world")).toBe("hello_world");
  });

  it("should handle a typical display name correctly", () => {
    expect(sanitizeHandle("The Chemical Brothers")).toBe(
      "the_chemical_brothers",
    );
  });

  it("should handle numbers in the input", () => {
    expect(sanitizeHandle("User123")).toBe("user123");
  });

  it("should return a string that matches the valid handle regex", () => {
    const result = sanitizeHandle("Some Cool Artist Name!");
    expect(result).toMatch(/^[a-z0-9_]{1,30}$/);
  });
});

// =============================================================================
// isValidHandle
// =============================================================================

describe("isValidHandle", () => {
  // ── Valid handles ────────────────────────────────────────────────────────────

  describe("valid handles", () => {
    it("should return true for a simple lowercase handle", () => {
      expect(isValidHandle("djkhaled")).toBe(true);
    });

    it("should return true for a handle with underscores", () => {
      expect(isValidHandle("dj_khaled")).toBe(true);
    });

    it("should return true for a handle with numbers", () => {
      expect(isValidHandle("user123")).toBe(true);
    });

    it("should return true for a handle that is exactly 3 characters", () => {
      expect(isValidHandle("abc")).toBe(true);
    });

    it("should return true for a handle that is exactly 30 characters", () => {
      expect(isValidHandle("a".repeat(30))).toBe(true);
    });

    it("should return true for a mixed handle", () => {
      expect(isValidHandle("abc_123_xyz")).toBe(true);
    });
  });

  // ── Invalid handles ──────────────────────────────────────────────────────────

  describe("invalid handles", () => {
    it("should return false for a handle that is too short (2 chars)", () => {
      expect(isValidHandle("ab")).toBe(false);
    });

    it("should return false for a handle that is too long (31 chars)", () => {
      expect(isValidHandle("a".repeat(31))).toBe(false);
    });

    it("should return false for an empty string", () => {
      expect(isValidHandle("")).toBe(false);
    });

    it("should return false for uppercase characters", () => {
      expect(isValidHandle("DJKHALED")).toBe(false);
    });

    it("should return false for a handle with spaces", () => {
      expect(isValidHandle("dj khaled")).toBe(false);
    });

    it("should return false for a handle with hyphens", () => {
      expect(isValidHandle("dj-khaled")).toBe(false);
    });

    it("should return false for a handle with special characters", () => {
      expect(isValidHandle("user@name")).toBe(false);
      expect(isValidHandle("user!name")).toBe(false);
      expect(isValidHandle("user.name")).toBe(false);
    });

    it("should return false for a handle with leading underscore", () => {
      expect(isValidHandle("_username")).toBe(false);
    });

    it("should return false for a handle with trailing underscore", () => {
      expect(isValidHandle("username_")).toBe(false);
    });

    it("should return false for SQL injection attempt", () => {
      expect(isValidHandle("'; DROP TABLE users; --")).toBe(false);
    });

    it("should return false for a path-traversal attempt", () => {
      expect(isValidHandle("../etc/passwd")).toBe(false);
    });
  });
});

// =============================================================================
// isSafeExternalUrl  (OWASP A10 — SSRF prevention)
// =============================================================================

describe("isSafeExternalUrl", () => {
  // ── Safe URLs ────────────────────────────────────────────────────────────────

  describe("safe public HTTPS URLs", () => {
    it("should return true for a basic HTTPS URL", () => {
      expect(isSafeExternalUrl("https://example.com")).toBe(true);
    });

    it("should return true for an HTTPS URL with a path", () => {
      expect(isSafeExternalUrl("https://twitter.com/username")).toBe(true);
    });

    it("should return true for an HTTPS URL with query params", () => {
      expect(isSafeExternalUrl("https://example.com/page?ref=123")).toBe(true);
    });

    it("should return true for an HTTPS URL with a subdomain", () => {
      expect(isSafeExternalUrl("https://www.instagram.com/user")).toBe(true);
    });

    it("should return true for an HTTPS URL with a port", () => {
      expect(isSafeExternalUrl("https://example.com:8443/path")).toBe(true);
    });
  });

  // ── HTTP blocked ─────────────────────────────────────────────────────────────

  describe("HTTP URLs (blocked)", () => {
    it("should return false for a plain http URL", () => {
      expect(isSafeExternalUrl("http://example.com")).toBe(false);
    });

    it("should return false for an http URL with a path", () => {
      expect(isSafeExternalUrl("http://twitter.com/username")).toBe(false);
    });
  });

  // ── Dangerous schemes ────────────────────────────────────────────────────────

  describe("dangerous URL schemes (blocked)", () => {
    it("should return false for a javascript: URL", () => {
      expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    });

    it("should return false for a data: URL", () => {
      expect(isSafeExternalUrl("data:text/html,<h1>XSS</h1>")).toBe(false);
    });

    it("should return false for an ftp: URL", () => {
      expect(isSafeExternalUrl("ftp://files.example.com/file")).toBe(false);
    });

    it("should return false for a file: URL", () => {
      expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    });

    it("should return false for a vbscript: URL", () => {
      expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
    });
  });

  // ── SSRF — internal / private hostnames ──────────────────────────────────────

  describe("SSRF — blocked internal hostnames", () => {
    it("should return false for localhost", () => {
      expect(isSafeExternalUrl("https://localhost/admin")).toBe(false);
    });

    it("should return false for 127.0.0.1", () => {
      expect(isSafeExternalUrl("https://127.0.0.1:8080")).toBe(false);
    });

    it("should return false for 0.0.0.0", () => {
      expect(isSafeExternalUrl("https://0.0.0.0/api")).toBe(false);
    });

    it("should return false for IPv6 loopback ::1", () => {
      expect(isSafeExternalUrl("https://[::1]/secret")).toBe(false);
    });

    it("should return false for the AWS IMDS metadata endpoint", () => {
      expect(
        isSafeExternalUrl("https://169.254.169.254/latest/meta-data/"),
      ).toBe(false);
    });

    it("should return false for the GCP metadata endpoint", () => {
      expect(
        isSafeExternalUrl(
          "https://metadata.google.internal/computeMetadata/v1/",
        ),
      ).toBe(false);
    });

    it("should return false for an RFC-1918 10.x.x.x address", () => {
      expect(isSafeExternalUrl("https://10.0.0.1/internal")).toBe(false);
    });

    it("should return false for an RFC-1918 192.168.x.x address", () => {
      expect(isSafeExternalUrl("https://192.168.1.1/router")).toBe(false);
    });

    it("should return false for a 172.x.x.x address", () => {
      expect(isSafeExternalUrl("https://172.16.0.1/private")).toBe(false);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should return false for an empty string", () => {
      expect(isSafeExternalUrl("")).toBe(false);
    });

    it("should return false for a URL that is too long (> 2048 chars)", () => {
      const longUrl = "https://example.com/" + "a".repeat(2050);
      expect(isSafeExternalUrl(longUrl)).toBe(false);
    });

    it("should return false for a plain domain without a scheme", () => {
      expect(isSafeExternalUrl("example.com")).toBe(false);
    });

    it("should return false for a relative path", () => {
      expect(isSafeExternalUrl("/relative/path")).toBe(false);
    });

    it("should return false for a URL with only whitespace", () => {
      expect(isSafeExternalUrl("   ")).toBe(false);
    });

    it("should return false for null-like string inputs", () => {
      expect(isSafeExternalUrl("null")).toBe(false);
      expect(isSafeExternalUrl("undefined")).toBe(false);
    });

    it("should accept a URL that is exactly 2048 characters long", () => {
      // Construct a valid HTTPS URL that is precisely 2048 chars.
      const base = "https://example.com/";
      const path = "a".repeat(2048 - base.length);
      const url = base + path;
      expect(url.length).toBe(2048);
      expect(isSafeExternalUrl(url)).toBe(true);
    });
  });
});

// =============================================================================
// timingSafeStringEqual  (OWASP A07 — timing attack prevention)
// =============================================================================

describe("timingSafeStringEqual", () => {
  // ── Equal strings ────────────────────────────────────────────────────────────

  describe("equal strings", () => {
    it("should return true for two identical strings", () => {
      expect(timingSafeStringEqual("hello", "hello")).toBe(true);
    });

    it("should return true for two identical empty strings", () => {
      expect(timingSafeStringEqual("", "")).toBe(true);
    });

    it("should return true for identical long strings", () => {
      const s = "x".repeat(1000);
      expect(timingSafeStringEqual(s, s)).toBe(true);
    });

    it("should return true for identical strings with special characters", () => {
      const s = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/`~";
      expect(timingSafeStringEqual(s, s)).toBe(true);
    });

    it("should return true for identical strings with unicode", () => {
      const s = "你好世界🎵🎶";
      expect(timingSafeStringEqual(s, s)).toBe(true);
    });
  });

  // ── Unequal strings ──────────────────────────────────────────────────────────

  describe("unequal strings", () => {
    it("should return false when strings differ by one character", () => {
      expect(timingSafeStringEqual("hello", "hellx")).toBe(false);
    });

    it("should return false when strings have different lengths", () => {
      expect(timingSafeStringEqual("hello", "hello!")).toBe(false);
    });

    it("should return false for a vs an empty string", () => {
      expect(timingSafeStringEqual("hello", "")).toBe(false);
      expect(timingSafeStringEqual("", "hello")).toBe(false);
    });

    it("should return false when strings differ only in case", () => {
      expect(timingSafeStringEqual("Hello", "hello")).toBe(false);
      expect(timingSafeStringEqual("TOKEN", "token")).toBe(false);
    });

    it("should return false for completely different strings of same length", () => {
      expect(timingSafeStringEqual("aaaa", "bbbb")).toBe(false);
    });

    it("should return false for strings that differ only by whitespace", () => {
      expect(timingSafeStringEqual("hello", "hello ")).toBe(false);
      expect(timingSafeStringEqual("hello", " hello")).toBe(false);
    });
  });

  // ── Token comparison scenarios ───────────────────────────────────────────────

  describe("realistic token comparison scenarios", () => {
    it("should correctly compare two identical SHA-256 hashes", () => {
      const hash =
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
      expect(timingSafeStringEqual(hash, hash)).toBe(true);
    });

    it("should correctly reject two different SHA-256 hashes", () => {
      const hash1 =
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
      const hash2 =
        "b94d27b9934d3e08a52e52d7da7dabfac484efe04294e576b4f4bf0f2a1d9e9c";
      expect(timingSafeStringEqual(hash1, hash2)).toBe(false);
    });

    it("should correctly compare JWT-like token strings", () => {
      const token =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.SIGNATURE";
      expect(timingSafeStringEqual(token, token)).toBe(true);
    });
  });
});

// =============================================================================
// normalizeUserAgent
// =============================================================================

describe("normalizeUserAgent", () => {
  function buildRequestWithUA(ua: string | undefined): Request {
    return {
      headers: ua !== undefined ? { "user-agent": ua } : {},
    } as unknown as Request;
  }

  it("should return the user-agent string as-is for a normal browser UA", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    const result = normalizeUserAgent(buildRequestWithUA(ua));
    expect(result).toBe(ua);
  });

  it('should return "Unknown device" when the header is absent', () => {
    const result = normalizeUserAgent(buildRequestWithUA(undefined));
    expect(result).toBe("Unknown device");
  });

  it("should truncate the UA to 512 characters", () => {
    const long = "A".repeat(1000);
    const result = normalizeUserAgent(buildRequestWithUA(long));
    expect(result.length).toBe(512);
  });

  it("should strip ASCII control characters", () => {
    const malicious = "Mozilla/5.0\x00\x01\x1F<script>alert(1)</script>";
    const result = normalizeUserAgent(buildRequestWithUA(malicious));
    expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
  });

  it("should not strip printable characters", () => {
    const ua = "Spotly-Mobile/1.0 (iOS 17.0; iPhone 15)";
    const result = normalizeUserAgent(buildRequestWithUA(ua));
    expect(result).toBe(ua);
  });

  it("should handle an empty string user-agent", () => {
    const result = normalizeUserAgent(buildRequestWithUA(""));
    expect(typeof result).toBe("string");
  });
});

// =============================================================================
// assertTokenEntropy
// =============================================================================

describe("assertTokenEntropy", () => {
  // ── Sufficient entropy ───────────────────────────────────────────────────────

  describe("tokens with sufficient entropy", () => {
    it("should not throw for a token >= 43 characters", () => {
      // 43 chars = approx 32 bytes base64url-encoded (minimum)
      expect(() => assertTokenEntropy("a".repeat(43))).not.toThrow();
    });

    it("should not throw for a real 48-byte base64url token (64+ chars)", () => {
      // Typical output of randomBytes(48).toString('base64url')
      const token = "XZp7RtQjLmNvKwYbFhCaIeUoSdGnBxWzAyPqTrVuMlHiEkOs_J";
      expect(() => assertTokenEntropy(token)).not.toThrow();
    });

    it("should not throw for a 64-char SHA-256 hex digest", () => {
      const hash =
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
      expect(() => assertTokenEntropy(hash)).not.toThrow();
    });

    it("should not throw for a very long token", () => {
      expect(() => assertTokenEntropy("x".repeat(200))).not.toThrow();
    });
  });

  // ── Insufficient entropy ─────────────────────────────────────────────────────

  describe("tokens with insufficient entropy", () => {
    it("should throw for an empty string", () => {
      expect(() => assertTokenEntropy("")).toThrow();
    });

    it("should throw for a token that is exactly 42 characters (one short)", () => {
      expect(() => assertTokenEntropy("a".repeat(42))).toThrow();
    });

    it("should throw for a very short token", () => {
      expect(() => assertTokenEntropy("abc123")).toThrow();
    });

    it("should throw for a single character", () => {
      expect(() => assertTokenEntropy("x")).toThrow();
    });
  });

  // ── Custom field name in error ────────────────────────────────────────────────

  describe("custom fieldName parameter", () => {
    it('should use the default field name "token" in the error message', () => {
      try {
        assertTokenEntropy("short");
        fail("Expected an error to be thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("token");
      }
    });

    it("should include the custom field name in the error message", () => {
      try {
        assertTokenEntropy("short", "verificationToken");
        fail("Expected an error to be thrown");
      } catch (err: unknown) {
        expect((err as Error).message).toContain("verificationToken");
      }
    });
  });
});
