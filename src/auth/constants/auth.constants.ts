// ─── Cookie names ─────────────────────────────────────────────────────────────
export const ACCESS_COOKIE_NAME = "access_token";
export const REFRESH_COOKIE_NAME = "refresh_token";

// ─── Access token ─────────────────────────────────────────────────────────────
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

// ─── Refresh token ────────────────────────────────────────────────────────────
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ─── One-time token TTLs ──────────────────────────────────────────────────────
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60; //  24 hours
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; //   1 hour
export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60; //  24 hours

// ─── JWT metadata ─────────────────────────────────────────────────────────────
export const JWT_ISSUER = "spotly-api";
export const JWT_AUDIENCE = "spotly-client";

// ─── Per-route rate-limit policies (used with @ThrottlePolicy) ────────────────
export const AUTH_RATE_LIMITS = {
  register: { limit: 3, ttlMs: 60 * 1_000 }, // 3 / min
  loginByIp: { limit: 10, ttlMs: 60 * 1_000 }, // 10 / min per IP
  loginByEmail: { limit: 5, ttlMs: 15 * 60 * 1_000 }, // 5 / 15 min
  forgotPassword: { limit: 3, ttlMs: 60 * 60 * 1_000 }, // 3 / hour
  resendVerification: { limit: 3, ttlMs: 60 * 60 * 1_000 }, // 3 / hour
  requestEmailChange: { limit: 3, ttlMs: 60 * 60 * 1_000 }, // 3 / hour
  refresh: { limit: 30, ttlMs: 60 * 1_000 }, // 30 / min
} as const;

// ─── Dummy argon2 hash for timing-safe login ─────────────────────────────────
// Pre-computed so the login path always calls argon2.verify regardless of
// whether the email exists — prevents timing-based email enumeration.
export const TIMING_SAFE_DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$" +
  "RdescFezC6OysGRFEHSR6qXm5PtMHbSXJlTa9BVMNE";
