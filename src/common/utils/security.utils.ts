import { Request } from "express";

// =============================================================================
// Security Utilities — Member 1 (Backend Lead + Security Owner)
//
// OWASP coverage:
//   A01 — Broken Access Control   : IP extraction for audit / rate-limit keys
//   A03 — Injection               : handle sanitisation, URL allow-list validation
//   A07 — Auth Failures           : constant-time token comparison helper
// =============================================================================

// ─── IP Extraction ────────────────────────────────────────────────────────────

/**
 * Safely extract the real client IP from an Express request.
 *
 * Checks (in order):
 *   1. X-Forwarded-For first entry   (set by reverse proxies / load balancers)
 *   2. X-Real-IP                     (nginx convention)
 *   3. req.ip                        (Express trust-proxy value)
 *   4. req.socket.remoteAddress      (raw socket — last resort)
 *
 * ⚠️  Only trust X-Forwarded-For when the server sits behind a known proxy
 *     (set `app.set('trust proxy', 1)` in Express / NestJS bootstrap).
 *     If the server is directly internet-facing, return req.ip only.
 */
export function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    // X-Forwarded-For: <client>, <proxy1>, <proxy2>
    const first = forwarded.split(",")[0].trim();
    if (isValidIp(first)) {
      return first;
    }
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim().length > 0) {
    const ip = realIp.trim();
    if (isValidIp(ip)) {
      return ip;
    }
  }

  if (req.ip && isValidIp(req.ip)) {
    return req.ip;
  }

  return req.socket?.remoteAddress ?? "unknown";
}

/**
 * Lightweight IPv4 / IPv6 format check.
 * Not a full RFC validator — just filters obvious garbage.
 */
function isValidIp(value: string): boolean {
  // Strip IPv6 zone ID and brackets
  const clean = value.replace(/^\[/, "").replace(/\]$/, "").replace(/%.*$/, "");

  // IPv4
  const ipv4 =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(clean) &&
    clean.split(".").every((o) => Number(o) <= 255);

  // IPv6 (coarse check — at least one colon)
  const ipv6 = clean.includes(":") && /^[0-9a-fA-F:]+$/.test(clean);

  return ipv4 || ipv6;
}

// ─── Handle Sanitisation ──────────────────────────────────────────────────────

/**
 * Sanitise a raw display name into a valid, URL-safe handle.
 *
 * Rules:
 *  • Lowercase everything
 *  • Replace any run of non-alphanumeric characters with a single underscore
 *  • Strip leading / trailing underscores
 *  • Truncate to 30 characters
 *  • If the result is empty, fall back to "user"
 *
 * Example:  "DJ Khaled!!" → "dj_khaled"
 */
export function sanitizeHandle(raw: string): string {
  const handle = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);

  return handle.length > 0 ? handle : "user";
}

/**
 * Validate that a candidate handle string only contains allowed characters.
 *
 * Rules:
 *  • 3–30 characters total
 *  • Only lowercase letters, numbers, and underscores
 *  • Must START with a letter or number  (no leading underscore)
 *  • Must END   with a letter or number  (no trailing underscore)
 *
 * Pattern breakdown:  ^[a-z0-9] [a-z0-9_]{1,28} [a-z0-9]$
 *   First char  : [a-z0-9]        — no underscore allowed at position 0
 *   Middle chars: [a-z0-9_]{1,28} — underscores fine in the middle
 *   Last char   : [a-z0-9]        — no underscore allowed at the end
 *   Total range : 1 + 1..28 + 1 = 3..30 characters
 */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(handle);
}

// ─── URL Validation (OWASP A10 — SSRF prevention) ────────────────────────────

/**
 * Allowed external link platforms and their URL pattern rules.
 * Add new platforms here; never accept raw unchecked URLs for storage.
 */
const ALLOWED_URL_SCHEMES = ["https:"] as const;

/**
 * Block list of private / internal network ranges that must never be reached
 * via user-supplied URLs (SSRF prevention).
 *
 * Note: This is a defence-in-depth measure. The primary control is the
 * ALLOWED_URL_SCHEMES allow-list which already blocks non-https schemes.
 */
const SSRF_BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal", // GCP metadata endpoint
  "169.254.169.254", // AWS / Azure IMDS
  "100.100.100.200", // Alibaba Cloud metadata
]);

/**
 * Returns `true` when `url` is a safe, publicly-reachable HTTPS URL.
 *
 * Checks:
 *  1. Must be parseable by the URL constructor
 *  2. Must use HTTPS (not http, ftp, javascript, data, …)
 *  3. Hostname must not be a private/internal address
 *  4. Maximum length 2 048 characters
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url || url.length > 2048) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Allow-list: only https
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol as "https:")) {
    return false;
  }

  // Block internal hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTNAMES.has(hostname)) {
    return false;
  }

  // Block RFC-1918 / loopback CIDR ranges via simple prefix checks
  if (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.") || // crude — covers 172.16–31
    hostname.startsWith("fd") || // IPv6 ULA
    hostname.startsWith("fc") // IPv6 ULA
  ) {
    return false;
  }

  return true;
}

// ─── Constant-time Comparison (OWASP A02 — timing attack prevention) ─────────

/**
 * Compare two strings in constant time to prevent timing-based attacks.
 *
 * Uses Node's built-in `crypto.timingSafeEqual` on UTF-8 buffers.
 * Pads the shorter buffer so the comparison always takes the same time
 * regardless of where the strings diverge.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const { timingSafeEqual } = require("crypto") as typeof import("crypto");

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  // Buffers must be the same length for timingSafeEqual.
  // We pad the shorter one — the length mismatch itself still causes false,
  // but we always perform the full comparison first.
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);

  // The XOR comparison is constant-time; length comparison is not secret.
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

// ─── User-Agent Normalisation ─────────────────────────────────────────────────

/**
 * Extract a truncated, safe device-info string from the User-Agent header
 * for display in the "active sessions" list.
 *
 * Limits output to 512 characters and strips control characters.
 */
export function normalizeUserAgent(req: Request): string {
  const ua = req.headers["user-agent"] ?? "Unknown device";
  return ua
    .replace(/[\x00-\x1F\x7F]/g, "") // strip control chars
    .slice(0, 512);
}

// ─── Token entropy assertion ──────────────────────────────────────────────────

/**
 * Assert that a raw token meets the minimum entropy requirement (>= 32 bytes
 * of base64url-encoded data). Throws if the token is too short.
 *
 * Used as a sanity guard inside services that accept tokens from DTOs.
 */
export function assertTokenEntropy(token: string, fieldName = "token"): void {
  // 32 raw bytes → ~43 base64url characters (no padding)
  if (!token || token.length < 43) {
    // Return a generic error — do not reveal the minimum length to callers
    throw new Error(`Invalid ${fieldName}.`);
  }
}
