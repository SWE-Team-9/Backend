# Spotly — Frontend Integration Guide

> Everything a **web frontend** (React, Next.js, Vue, Angular, etc.) developer needs to integrate with the Spotly authentication API.

---

## Table of Contents

1. [Base Configuration](#1-base-configuration)
2. [Authentication Model — Cookie-Based](#2-authentication-model--cookie-based)
3. [HTTP Client Setup](#3-http-client-setup)
4. [Endpoint Reference](#4-endpoint-reference)
5. [Request / Response DTOs](#5-request--response-dtos)
6. [Error Handling](#6-error-handling)
7. [Token Refresh Flow](#7-token-refresh-flow)
8. [Google OAuth Flow](#8-google-oauth-flow)
9. [Session Management](#9-session-management)
10. [Validation Rules Quick-Ref](#10-validation-rules-quick-ref)

---

## 1. Base Configuration

| Setting | Value |
|---|---|
| **Base URL** | `http://localhost:3000/api/v1` |
| **Content-Type** | `application/json` |
| **Auth method** | `httpOnly` cookies (set automatically by the server) |
| **CORS** | `origin: *`, `credentials: true` |
| **Max request body** | 64 KB |
| **Swagger (dev only)** | `http://localhost:3000/api/docs` |

---

## 2. Authentication Model — Cookie-Based

The API uses **httpOnly cookies** — the browser stores and sends them automatically; your JS code never touches raw tokens.

| Cookie | Purpose | Max-Age |
|---|---|---|
| `access_token` | Short-lived JWT (HS256) | **15 minutes** |
| `refresh_token` | Opaque token for rotation | **7 days** (30 days if `remember_me`) |

Cookie options: `httpOnly`, `sameSite: lax`, `path: /`, `secure: false` (dev).

> **Important:** Because cookies are `httpOnly`, you **cannot** read them from JavaScript. Instead, use the `/auth/me` endpoint to get the current user.

---

## 3. HTTP Client Setup

### Axios

```ts
import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:3000/api/v1",
  withCredentials: true, // ← REQUIRED — sends cookies on every request
  headers: { "Content-Type": "application/json" },
});

// Interceptor: auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        await api.post("/auth/refresh");   // rotates cookies automatically
        return api(original);              // retry original request
      } catch {
        window.location.href = "/login";   // refresh token also expired
      }
    }
    return Promise.reject(error);
  },
);

export default api;
```

### Fetch

```ts
const BASE = "http://localhost:3000/api/v1";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",  // ← REQUIRED
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (res.status === 401) {
    // try silent refresh
    const refresh = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refresh.ok) {
      return fetch(`${BASE}${path}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...init,
      });
    }
    window.location.href = "/login";
  }
  return res;
}
```

---

## 4. Endpoint Reference

All paths are relative to `{BASE_URL}` (`/api/v1`).

### Public Endpoints (no cookie required)

| # | Method | Path | Body DTO | Description |
|---|--------|------|----------|-------------|
| 1 | `POST` | `/auth/register` | `RegisterDto` | Create new account |
| 2 | `POST` | `/auth/verify-email` | `VerifyEmailDto` | Verify email via token |
| 3 | `POST` | `/auth/resend-verification` | `ResendVerificationDto` | Re-send verification email |
| 4 | `POST` | `/auth/login` | `LoginDto` | Login → sets cookies |
| 5 | `GET`  | `/auth/google` | — | Redirects to Google consent |
| 6 | `GET`  | `/auth/google/callback` | — | Google OAuth callback → sets cookies, redirects to FE |
| 7 | `POST` | `/auth/refresh` | — | Rotate tokens (reads `refresh_token` cookie) |
| 8 | `POST` | `/auth/logout` | — | Logout current session, clears cookies |
| 10 | `POST` | `/auth/forgot-password` | `ForgotPasswordDto` | Request password-reset email |
| 11 | `POST` | `/auth/reset-password` | `ResetPasswordDto` | Reset password with token |
| 14 | `POST` | `/auth/email/confirm-change` | `ConfirmEmailChangeDto` | Confirm email change via token |

### Protected Endpoints (cookie required)

| # | Method | Path | Body DTO | Description |
|---|--------|------|----------|-------------|
| 9 | `POST`   | `/auth/logout-all` | — | Revoke all sessions |
| 12 | `POST`  | `/auth/change-password` | `ChangePasswordDto` | Change password (logged-in) |
| 13 | `POST`  | `/auth/email/change` | `RequestEmailChangeDto` | Request email change |
| 15 | `GET`   | `/auth/me` | — | Get current user profile |
| 16 | `GET`   | `/auth/sessions` | — | List active sessions |
| 17 | `DELETE` | `/auth/sessions/:sessionId` | — | Revoke a specific session |

### Rate Limits (per IP)

| Endpoint | Limit |
|---|---|
| `register` | 5 req / min |
| `resend-verification` | 3 req / min |
| `login` | 10 req / min |
| `verify-email` | 10 req / min |
| `refresh` | 30 req / min |
| `forgot-password` | 3 req / min |
| `reset-password` | 5 req / min |
| `change-password` | 5 req / min |
| `email/change` | 3 req / min |
| `email/confirm-change` | 5 req / min |

---

## 5. Request / Response DTOs

### RegisterDto — `POST /auth/register`

```jsonc
// Request
{
  "email": "user@example.com",        // valid email, max 255 chars
  "password": "S3cureP@ss!",          // 8+ chars, upper+lower+digit+special
  "password_confirm": "S3cureP@ss!",  // must match password
  "display_name": "DJ Cool",          // 2–50 chars
  "date_of_birth": "2000-01-15",      // ISO date, must be ≥13 years old
  "gender": "MALE",                   // MALE | FEMALE | PREFER_NOT_TO_SAY
  "captcha_token": "abc..."           // optional — reCAPTCHA v3 token
}

// Response — 201
{
  "message": "Registration successful. Please check your email to verify your account.",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "DJ Cool",
    "is_verified": false,
    "created_at": "2025-06-01T12:00:00.000Z"
  }
}
```

### LoginDto — `POST /auth/login`

```jsonc
// Request
{
  "email": "user@example.com",
  "password": "S3cureP@ss!",
  "remember_me": true        // optional — extends refresh_token to 30 days
}

// Response — 200 (cookies set automatically)
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "DJ Cool",
    "handle": "dj-cool",
    "avatar_url": "https://..." or null,
    "account_type": "LISTENER",       // LISTENER | ARTIST
    "system_role": "USER",            // USER | ADMIN | SUPER_ADMIN
    "is_verified": true
  }
}
```

### VerifyEmailDto — `POST /auth/verify-email`

```jsonc
// Request
{ "token": "hex-token-from-email-link" }

// Response — 200
{ "message": "Email verified successfully. You can now log in." }
```

### ResendVerificationDto — `POST /auth/resend-verification`

```jsonc
// Request
{ "email": "user@example.com" }

// Response — 200
{ "message": "If this email is registered and unverified, a new verification link has been sent." }
```

### ForgotPasswordDto — `POST /auth/forgot-password`

```jsonc
// Request
{ "email": "user@example.com" }

// Response — 200
{ "message": "If this email is registered, a password reset link has been sent." }
```

### ResetPasswordDto — `POST /auth/reset-password`

```jsonc
// Request
{
  "token": "hex-token-from-email-link",
  "new_password": "N3wS3cure!",
  "new_password_confirm": "N3wS3cure!"
}

// Response — 200
{ "message": "Password reset successful. You can now log in with your new password." }
```

### ChangePasswordDto — `POST /auth/change-password` 🔒

```jsonc
// Request
{
  "current_password": "OldP@ss!",
  "new_password": "N3wP@ss!",
  "new_password_confirm": "N3wP@ss!"
}

// Response — 200
{ "message": "Password changed successfully. All other sessions have been revoked." }
```

### RequestEmailChangeDto — `POST /auth/email/change` 🔒

```jsonc
// Request
{
  "new_email": "newemail@example.com",
  "current_password": "MyP@ss!"
}

// Response — 200
{ "message": "A confirmation link has been sent to newemail@example.com." }
```

### ConfirmEmailChangeDto — `POST /auth/email/confirm-change`

```jsonc
// Request
{ "token": "hex-token-from-email-link" }

// Response — 200
{ "message": "Email changed successfully. Please log in with your new email." }
```

### GET /auth/me 🔒

```jsonc
// Response — 200
{
  "id": "uuid",
  "email": "user@example.com",
  "display_name": "DJ Cool",
  "handle": "dj-cool",
  "avatar_url": "https://..." or null,
  "account_type": "LISTENER",
  "system_role": "USER",
  "is_verified": true,
  "subscription_tier": "FREE",         // FREE | PREMIUM | etc.
  "created_at": "2025-06-01T12:00:00.000Z"
}
```

### GET /auth/sessions 🔒

```jsonc
// Response — 200
{
  "sessions": [
    {
      "id": "uuid",
      "device": {
        "platform": "WEB",
        "device_name": "Unknown"
      },
      "ip_address": "::1",
      "user_agent": "Mozilla/5.0...",
      "is_current": true,
      "created_at": "2025-06-01T12:00:00.000Z",
      "expires_at": "2025-06-08T12:00:00.000Z"
    }
  ]
}
```

### DELETE /auth/sessions/:sessionId 🔒

```jsonc
// Response — 200
{ "message": "Session revoked successfully" }
```

### POST /auth/refresh

```jsonc
// No body — reads refresh_token from cookie

// Response — 200 (new cookies set automatically)
{ "message": "Token refreshed successfully" }
```

### POST /auth/logout

```jsonc
// No body — reads refresh_token from cookie

// Response — 200 (cookies cleared)
{ "message": "Logged out successfully" }
```

### POST /auth/logout-all 🔒

```jsonc
// Response — 200 (cookies cleared)
{ "message": "All sessions revoked. You have been logged out from all devices." }
```

---

## 6. Error Handling

Every error response follows this shape:

```jsonc
{
  "statusCode": 401,
  "error": "INVALID_CREDENTIALS",       // machine-readable error code
  "message": "The email or password you entered is incorrect.",
  "timestamp": "2025-06-01T12:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

### Error Codes by HTTP Status

| Status | Default Code | When |
|--------|-------------|------|
| 400 | `VALIDATION_FAILED` | DTO validation failed |
| 400 | `INVALID_TOKEN` | Bad verification / reset token |
| 401 | `NOT_AUTHENTICATED` | No/invalid access token cookie |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 401 | `NO_REFRESH_TOKEN` | Missing refresh token cookie |
| 401 | `TOKEN_REUSE_DETECTED` | Refresh token was already consumed (theft) |
| 403 | `FORBIDDEN` | Role-based access denied |
| 403 | `EMAIL_NOT_VERIFIED` | Email not verified yet |
| 403 | `ACCOUNT_SUSPENDED` | Account is suspended |
| 403 | `ACCOUNT_BANNED` | Account is permanently banned |
| 403 | `CANNOT_REVOKE_CURRENT` | Tried to revoke current session |
| 404 | `NOT_FOUND` | Resource not found |
| 404 | `SESSION_NOT_FOUND` | Session doesn't exist or already revoked |
| 409 | `CONFLICT` | Resource conflict |
| 409 | `EMAIL_ALREADY_EXISTS` | Email taken (registration or change) |
| 410 | `TOKEN_EXPIRED` | Verification / reset token expired |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected error |

### Validation Error (multiple field errors)

When validation fails, the `message` field flattens all field errors into a comma-separated string:

```jsonc
{
  "statusCode": 400,
  "error": "VALIDATION_FAILED",
  "message": "Please provide a valid email address., Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
  "timestamp": "...",
  "path": "/api/v1/auth/register"
}
```

### Recommended FE Error Handler

```ts
interface ApiError {
  statusCode: number;
  error: string;       // use this for programmatic checks
  message: string;     // display this to the user
  timestamp: string;
  path: string;
}

function handleError(err: ApiError) {
  switch (err.error) {
    case "INVALID_CREDENTIALS":
      showToast("Wrong email or password");
      break;
    case "EMAIL_NOT_VERIFIED":
      showToast("Please verify your email first");
      redirectTo("/verify-email");
      break;
    case "ACCOUNT_SUSPENDED":
      showToast(err.message); // includes suspension date
      break;
    case "ACCOUNT_BANNED":
      showToast("Your account has been banned");
      break;
    case "TOKEN_REUSE_DETECTED":
      // Potential session theft — force re-login
      redirectTo("/login");
      break;
    case "RATE_LIMIT_EXCEEDED":
      showToast("Too many requests. Please slow down.");
      break;
    case "VALIDATION_FAILED":
      // Parse comma-separated validation messages for field-level display
      const messages = err.message.split(", ");
      showFieldErrors(messages);
      break;
    default:
      showToast(err.message);
  }
}
```

---

## 7. Token Refresh Flow

```
        ┌─────────────┐     401      ┌─────────────┐
        │   FE App    │ ──────────►  │ Show login?  │
        │  (any call) │              │   No — try   │
        └─────┬───────┘              │   refresh    │
              │                      └──────┬───────┘
              │                             │
              │         POST /auth/refresh  │
              │  ◄──────────────────────────┘
              │  (sends refresh_token cookie)
              │
              ▼
        ┌─────────────┐
        │   Backend   │  ── rotates refresh token
        │             │  ── issues new access token
        │             │  ── sets both as new cookies
        └─────┬───────┘
              │
              │  200 OK
              ▼
        ┌─────────────┐
        │ Retry orig  │
        │   request   │
        └─────────────┘
```

**Key points:**

- The refresh endpoint **rotates** the refresh token — old one is revoked, new one is issued.
- If a revoked refresh token is reused, **all sessions for that user are revoked** (theft detection).
- On 401 from `/auth/refresh`, redirect to login — the user's session is truly expired.

---

## 8. Google OAuth Flow

```
   User clicks          FE redirects to           Google consent          Backend callback         FE callback
   "Login with      ──►  /api/v1/auth/google  ──►   screen        ──►  /api/v1/auth/google  ──►  /auth/callback
    Google"               (302 to Google)                                /callback                 (FE route)
                                                                        (sets cookies,
                                                                         302 to FE)
```

### Implementation

```tsx
// 1. Button handler — just navigate (no AJAX)
function handleGoogleLogin() {
  window.location.href = "http://localhost:3000/api/v1/auth/google";
}

// 2. Frontend /auth/callback page — cookies are already set
function AuthCallbackPage() {
  useEffect(() => {
    // Cookies already set by backend redirect,
    // fetch user data and redirect to dashboard
    api.get("/auth/me")
      .then((res) => {
        setUser(res.data);
        navigate("/dashboard");
      })
      .catch(() => navigate("/login"));
  }, []);

  return <LoadingSpinner />;
}
```

> The `FRONTEND_URL` environment variable controls where the backend redirects after Google callback (defaults to `http://localhost:3000`).

---

## 9. Session Management

### Listing Sessions

```ts
const { data } = await api.get("/auth/sessions");
// data.sessions[].is_current — highlight this one in the UI
```

### Revoking Another Session

```ts
await api.delete(`/auth/sessions/${sessionId}`);
// Cannot revoke the current session — use /auth/logout instead
```

### Logout All Devices

```ts
await api.post("/auth/logout-all");
// Clears cookies for current browser; other devices will get 401 on next request
```

---

## 10. Validation Rules Quick-Ref

| Field | Rules |
|---|---|
| `email` | Valid email format, max 255 chars |
| `password` | ≥ 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char (`!@#$%^&*()_+-=[]{}` etc.) |
| `password_confirm` | Must match `password` |
| `display_name` | 2–50 chars |
| `date_of_birth` | ISO date string (YYYY-MM-DD), user must be ≥ 13 years old |
| `gender` | One of: `MALE`, `FEMALE`, `PREFER_NOT_TO_SAY` |
| `captcha_token` | Optional string (reCAPTCHA v3) |
| `remember_me` | Optional boolean (default: `false`) |
| `sessionId` | Valid UUID v4 (path parameter) |
| `token` | Non-empty string (email verification, password reset, email change) |

---

## Quick Start Checklist

- [ ] Set `withCredentials: true` (Axios) or `credentials: "include"` (Fetch)
- [ ] Add a 401 interceptor that calls `POST /auth/refresh` before redirecting to login
- [ ] Use `/auth/me` to check authentication state on page load
- [ ] Handle the `error` field from API responses for programmatic control flow
- [ ] Add a Google OAuth button that navigates to `/api/v1/auth/google`
- [ ] Create a `/auth/callback` route to handle the Google OAuth redirect
- [ ] Never store tokens in localStorage / sessionStorage — cookies handle it
