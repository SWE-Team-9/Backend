# Spotly — Cross-Platform Integration Guide

> How to integrate the Spotly auth API from **mobile apps** (React Native, Flutter, Swift, Kotlin), **desktop apps** (Electron, Tauri), and other **non-browser** clients.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Cookie vs Token Strategy by Platform](#2-cookie-vs-token-strategy-by-platform)
3. [API Base & Headers](#3-api-base--headers)
4. [Auth Endpoints Quick Reference](#4-auth-endpoints-quick-reference)
5. [Platform-Specific Implementation](#5-platform-specific-implementation)
   - [React Native](#react-native)
   - [Flutter / Dart](#flutter--dart)
   - [Swift (iOS)](#swift-ios)
   - [Kotlin (Android)](#kotlin-android)
   - [Electron / Tauri (Desktop)](#electron--tauri-desktop)
6. [Token Lifecycle & Refresh Strategy](#6-token-lifecycle--refresh-strategy)
7. [Google OAuth on Mobile & Desktop](#7-google-oauth-on-mobile--desktop)
8. [Session Management](#8-session-management)
9. [Error Handling Contract](#9-error-handling-contract)
10. [DTO Validation Summary](#10-dto-validation-summary)
11. [Secure Storage Guidelines](#11-secure-storage-guidelines)
12. [Offline & Background Considerations](#12-offline--background-considerations)
13. [Environment Setup & Credentials Guide](#13-environment-setup--credentials-guide)

---

## 1. Architecture Overview

```
 ┌────────────────┐       HTTPS + Cookies       ┌─────────────────────┐
 │   Web (SPA)    │  ◄──────────────────────►    │                     │
 └────────────────┘                              │                     │
                                                 │    Spotly Backend   │
 ┌────────────────┐       HTTPS + Cookies        │    NestJS API       │
 │  Mobile App    │  ◄──────────────────────►    │                     │
 │  (cookie jar)  │                              │  Base: /api/v1      │
 └────────────────┘                              │  Port: 3000         │
                                                 │                     │
 ┌────────────────┐       HTTPS + Cookies        │  Auth: httpOnly     │
 │  Desktop App   │  ◄──────────────────────►    │  cookies            │
 │  (cookie jar)  │                              │                     │
 └────────────────┘                              └─────────────────────┘
```

The backend uses **httpOnly cookies** exclusively for authentication. All platforms must maintain a **cookie jar** to store and send cookies automatically.

### Token Specs

| Token | Storage | Lifetime | Rotation |
|---|---|---|---|
| `access_token` | httpOnly cookie | 15 minutes | Refreshed via `/auth/refresh` |
| `refresh_token` | httpOnly cookie | 7 days (30 with `remember_me`) | Rotated on every refresh |

### JWT Payload (for reference — you don't need to decode it)

```json
{
  "sub": "user-uuid",
  "role": "USER",
  "iat": 1717200000,
  "exp": 1717200900
}
```

---

## 2. Cookie vs Token Strategy by Platform

| Platform | Cookie Support | Recommended Approach |
|---|---|---|
| **Web (React, Vue, Angular)** | Native | Cookies work natively with `credentials: "include"` |
| **React Native** | Via cookie jar | Use `react-native-cookies` or fetch with `credentials: "include"` |
| **Flutter** | Via `dio` cookie jar | Use `dio` + `cookie_jar` package |
| **Swift (iOS)** | `URLSession` + `HTTPCookieStorage` | Cookies handled natively by `URLSession` |
| **Kotlin (Android)** | `OkHttp` + `CookieJar` | Implement persistent cookie jar |
| **Electron** | Chromium `session.cookies` | Cookies work like a browser |
| **Tauri** | `reqwest` cookie jar | Enable cookie store in HTTP client |

> **Never extract tokens from cookies and store them manually.** Let the HTTP client's cookie jar handle persistence.

---

## 3. API Base & Headers

```
Base URL:     http://localhost:3000/api/v1       (dev)
              https://api.spotly.app/api/v1      (production — configure per env)

Content-Type: application/json
```

All requests must include cookies (the platform-specific cookie jar handles this).

No `Authorization` header is needed — auth is handled entirely via cookies.

---

## 4. Auth Endpoints Quick Reference

### Public (no auth required)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/register` | RegisterDto | Create new account |
| `POST` | `/auth/verify-email` | `{ token }` | Verify email |
| `POST` | `/auth/resend-verification` | `{ email }` | Resend verification email |
| `POST` | `/auth/login` | LoginDto | Log in → cookies set |
| `GET` | `/auth/google` | — | Start Google OAuth (browser redirect) |
| `GET` | `/auth/google/callback` | — | Google OAuth callback |
| `POST` | `/auth/refresh` | — | Rotate tokens (reads cookie) |
| `POST` | `/auth/logout` | — | Logout → cookies cleared |
| `POST` | `/auth/forgot-password` | `{ email }` | Request password-reset email |
| `POST` | `/auth/reset-password` | ResetPasswordDto | Reset password via token |
| `POST` | `/auth/email/confirm-change` | `{ token }` | Confirm email change |

### Protected (auth cookies required)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/logout-all` | — | Revoke all sessions |
| `POST` | `/auth/change-password` | ChangePasswordDto | Change password |
| `POST` | `/auth/email/change` | RequestEmailChangeDto | Request email change |
| `GET` | `/auth/me` | — | Get current user |
| `GET` | `/auth/sessions` | — | List active sessions |
| `DELETE` | `/auth/sessions/:sessionId` | — | Revoke a session |

---

## 5. Platform-Specific Implementation

### React Native

```ts
// Using built-in fetch — React Native supports cookies natively
const BASE = "http://10.0.2.2:3000/api/v1"; // Android emulator → host machine

async function login(email: string, password: string, rememberMe = false) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    credentials: "include",  // ← persists cookies
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, remember_me: rememberMe }),
  });
  return res.json();
}

async function getMe() {
  const res = await fetch(`${BASE}/auth/me`, {
    credentials: "include",
  });
  if (res.status === 401) {
    // Try refresh
    const refresh = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (refresh.ok) {
      return (await fetch(`${BASE}/auth/me`, { credentials: "include" })).json();
    }
    throw new Error("SESSION_EXPIRED");
  }
  return res.json();
}
```

> **Android emulator:** Use `10.0.2.2` instead of `localhost`.
> **iOS simulator:** `localhost` works as-is.

### Flutter / Dart

```dart
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:cookie_jar/cookie_jar.dart';

final cookieJar = PersistCookieJar(); // persists across app restarts
final dio = Dio(BaseOptions(
  baseUrl: 'http://10.0.2.2:3000/api/v1', // adjust per platform
  contentType: 'application/json',
))..interceptors.add(CookieManager(cookieJar));

// Login
Future<Map<String, dynamic>> login(String email, String password, {bool rememberMe = false}) async {
  final res = await dio.post('/auth/login', data: {
    'email': email,
    'password': password,
    'remember_me': rememberMe,
  });
  return res.data;
}

// Auto-refresh interceptor
dio.interceptors.add(InterceptorsWrapper(
  onError: (error, handler) async {
    if (error.response?.statusCode == 401) {
      try {
        await dio.post('/auth/refresh');
        // Retry the original request
        final res = await dio.fetch(error.requestOptions);
        return handler.resolve(res);
      } catch (_) {
        // Navigate to login
      }
    }
    return handler.next(error);
  },
));
```

### Swift (iOS)

```swift
import Foundation

class SpotlyAPI {
    static let shared = SpotlyAPI()
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        // URLSession uses HTTPCookieStorage.shared — cookies persist automatically
        self.session = URLSession(configuration: config)
    }

    private let baseURL = URL(string: "http://localhost:3000/api/v1")!

    func login(email: String, password: String, rememberMe: Bool = false) async throws -> LoginResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(LoginBody(
            email: email, password: password, remember_me: rememberMe
        ))

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.loginFailed
        }
        return try JSONDecoder().decode(LoginResponse.self, from: data)
    }

    // Refresh — call when any request returns 401
    func refresh() async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("auth/refresh"))
        request.httpMethod = "POST"
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.sessionExpired
        }
        // New cookies are stored automatically by URLSession
    }
}
```

### Kotlin (Android)

```kotlin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class SpotlyApi(context: Context) {
    private val cookieJar = PersistentCookieJar(
        SetCookieCache(),
        SharedPrefsCookiePersistor(context) // persists cookies across app restarts
    )

    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .build()

    private val baseUrl = "http://10.0.2.2:3000/api/v1"
    private val json = "application/json".toMediaType()

    fun login(email: String, password: String, rememberMe: Boolean = false): Response {
        val body = """{"email":"$email","password":"$password","remember_me":$rememberMe}"""
        val request = Request.Builder()
            .url("$baseUrl/auth/login")
            .post(body.toRequestBody(json))
            .build()
        return client.newCall(request).execute()
    }

    fun refresh(): Response {
        val request = Request.Builder()
            .url("$baseUrl/auth/refresh")
            .post("".toRequestBody(json))
            .build()
        return client.newCall(request).execute()
    }

    fun getMe(): Response {
        val request = Request.Builder()
            .url("$baseUrl/auth/me")
            .build()
        return client.newCall(request).execute()
    }
}
```

> Use `com.github.franmontiel:PersistentCookieJar` for persistent cookie storage on Android.

### Electron / Tauri (Desktop)

**Electron** — Cookies are managed by Chromium automatically:

```ts
// renderer process — works exactly like a browser
const api = axios.create({
  baseURL: "http://localhost:3000/api/v1",
  withCredentials: true,
});
```

**Tauri** — Use the built-in HTTP client with cookie store:

```rust
// In Rust (via tauri::api::http)
let client = reqwest::Client::builder()
    .cookie_store(true)
    .build()?;

let res = client
    .post("http://localhost:3000/api/v1/auth/login")
    .json(&serde_json::json!({
        "email": "user@example.com",
        "password": "S3cureP@ss!",
        "remember_me": true
    }))
    .send()
    .await?;
// Cookies are stored in the client's cookie jar automatically
```

---

## 6. Token Lifecycle & Refresh Strategy

### State Machine

```
                 ┌──────────────────────────────────────┐
                 │           NOT AUTHENTICATED          │
                 └──────────┬───────────────────────────┘
                            │
                  POST /auth/login  (or Google OAuth)
                  cookies set ──────┐
                            │       │
                            ▼       │
                 ┌──────────────────┤
                 │   AUTHENTICATED  │
                 │  (access_token   │
                 │   valid)         │
                 └────────┬─────────┘
                          │
              access_token expires (15 min)
                          │
                          ▼
                 ┌────────────────────┐
                 │   ACCESS EXPIRED   │
                 │  (refresh_token    │ ── POST /auth/refresh
                 │   still valid)     │    → new cookies
                 └────────┬───────────┘    → back to AUTHENTICATED
                          │
              refresh_token expires (7d / 30d)
              or reuse detected
                          │
                          ▼
                 ┌──────────────────┐
                 │  SESSION EXPIRED  │ ── redirect to login
                 └──────────────────┘
```

### Refresh Rules

1. **When**: Any API call returns HTTP 401.
2. **How**: `POST /auth/refresh` — no body needed, reads `refresh_token` cookie.
3. **Result**: Server sets new `access_token` + `refresh_token` cookies. Old refresh token is **revoked**.
4. **On failure**: Redirect to login screen.
5. **Reuse detection**: If a revoked refresh token is used again, **all sessions for that user are revoked** (theft protection).

### Proactive Refresh (Optional)

Decode the JWT `exp` claim to refresh **before** the 401 happens:

```ts
function getTokenExpiry(cookie: string): number {
  try {
    const payload = JSON.parse(atob(cookie.split(".")[1]));
    return payload.exp * 1000; // ms
  } catch {
    return 0;
  }
}

// Refresh 1 minute before expiry
if (Date.now() > getTokenExpiry(accessToken) - 60_000) {
  await api.post("/auth/refresh");
}
```

> Note: On most mobile platforms the cookie is httpOnly and you **cannot** read it from JS/Dart/Swift. Use the reactive 401 approach instead.

---

## 7. Google OAuth on Mobile & Desktop

Google OAuth uses browser redirects, which require special handling on non-web platforms.

### Recommended Flow: In-App Browser / WebView

```
  ┌─────────────┐     open browser      ┌───────────────┐    redirect     ┌────────────┐
  │  Mobile App  │ ──────────────────►  │  /auth/google  │ ────────────►  │   Google    │
  └──────────────┘                      └───────────────┘                 │  Consent    │
                                                                          └──────┬──────┘
              ┌──────────────────────────────────────────────────────────────────┘
              │  callback to /auth/google/callback → cookies set → redirect to FE
              ▼
  ┌───────────────────────────────────────────┐
  │  App intercepts redirect to FRONTEND_URL  │
  │  Extracts cookies, closes browser         │
  └───────────────────────────────────────────┘
```

**React Native:**

```ts
import { InAppBrowser } from "react-native-inappbrowser-reborn";

async function googleLogin() {
  const url = "http://localhost:3000/api/v1/auth/google";
  const redirectUrl = "http://localhost:3000/auth/callback"; // FRONTEND_URL

  if (await InAppBrowser.isAvailable()) {
    const result = await InAppBrowser.openAuth(url, redirectUrl, {
      ephemeralWebSession: false,
      showTitle: false,
    });
    if (result.type === "success") {
      // Cookies are now set in the shared cookie jar
      // Fetch user data
      await getMe();
    }
  }
}
```

**Flutter:**

```dart
import 'package:flutter_web_auth/flutter_web_auth.dart';

Future<void> googleLogin() async {
  final result = await FlutterWebAuth.authenticate(
    url: 'http://10.0.2.2:3000/api/v1/auth/google',
    callbackUrlScheme: 'spotly', // custom URL scheme
  );
  // Cookies handled by dio's cookie jar
  await dio.get('/auth/me');
}
```

> **Important:** Set `FRONTEND_URL` in the backend environment to your app's custom URL scheme (e.g., `spotly://auth/callback`) for mobile OAuth redirects.

---

## 8. Session Management

### List All Active Sessions

```
GET /auth/sessions
```

Response shape:

```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "device": {
        "platform": "WEB",
        "device_name": "Chrome on Windows"
      },
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "is_current": true,
      "created_at": "2025-06-01T12:00:00.000Z",
      "expires_at": "2025-06-08T12:00:00.000Z"
    }
  ]
}
```

### Revoke Another Session

```
DELETE /auth/sessions/:sessionId
```

- Cannot revoke the **current** session — use `POST /auth/logout` instead.
- Error code `CANNOT_REVOKE_CURRENT` if attempted.

### Logout All Devices

```
POST /auth/logout-all
```

- Revokes every session, clears cookies on the current device.
- Other devices get 401 on their next request.

---

## 9. Error Handling Contract

Every error follows this shape:

```json
{
  "statusCode": 400,
  "error": "VALIDATION_FAILED",
  "message": "Human-readable description",
  "timestamp": "2025-06-01T12:00:00.000Z",
  "path": "/api/v1/auth/register"
}
```

### Full Error Code Table

| Code | Status | Meaning | Action |
|------|--------|---------|--------|
| `VALIDATION_FAILED` | 400 | DTO field validation failed | Show field errors |
| `INVALID_TOKEN` | 400 | Bad verification / reset / change token | Ask user to retry |
| `NOT_AUTHENTICATED` | 401 | No valid access token | Attempt refresh → login |
| `INVALID_CREDENTIALS` | 401 | Wrong email / password | Show error on form |
| `NO_REFRESH_TOKEN` | 401 | No refresh cookie present | Redirect to login |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh token theft detected | Force logout + re-login |
| `FORBIDDEN` | 403 | Role insufficient | Show "access denied" |
| `EMAIL_NOT_VERIFIED` | 403 | Must verify email first | Navigate to verify page |
| `ACCOUNT_SUSPENDED` | 403 | Temporarily suspended | Show message with date |
| `ACCOUNT_BANNED` | 403 | Permanently banned | Show ban message |
| `CANNOT_REVOKE_CURRENT` | 403 | Tried to revoke current session | Use logout instead |
| `NOT_FOUND` | 404 | Resource not found | Handle gracefully |
| `SESSION_NOT_FOUND` | 404 | Session doesn't exist/revoked | Refresh session list |
| `EMAIL_ALREADY_EXISTS` | 409 | Email taken | Prompt different email |
| `TOKEN_EXPIRED` | 410 | Token past expiry | Ask to request new one |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Back off, show timer |
| `INTERNAL_SERVER_ERROR` | 500 | Server error | Generic "try later" |

### Cross-Platform Error Handler Pattern

```ts
// TypeScript / React Native / Electron
function handleApiError(error: {
  statusCode: number;
  error: string;
  message: string;
}) {
  if (error.statusCode === 401) {
    // Attempt refresh first
    const refreshed = await tryRefresh();
    if (!refreshed) {
      navigateToLogin();
    }
    return;
  }

  // Platform-appropriate alerts:
  // - Web: toast notification
  // - Mobile: Alert.alert() / SnackBar
  // - Desktop: native dialog
  showAlert(error.message);
}
```

---

## 10. DTO Validation Summary

### RegisterDto

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | ✅ | Valid email, max 255 chars |
| `password` | string | ✅ | ≥ 8 chars, 1 upper, 1 lower, 1 digit, 1 special |
| `password_confirm` | string | ✅ | Must match `password` |
| `display_name` | string | ✅ | 2–50 chars |
| `date_of_birth` | string | ✅ | ISO date (YYYY-MM-DD), age ≥ 13 |
| `gender` | enum | ✅ | `MALE` \| `FEMALE` \| `PREFER_NOT_TO_SAY` |
| `captcha_token` | string | ❌ | reCAPTCHA v3 token |

### LoginDto

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | ✅ | Valid email |
| `password` | string | ✅ | Non-empty |
| `remember_me` | boolean | ❌ | Default `false`. If `true`, refresh token lasts 30 days |

### ResetPasswordDto

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `token` | string | ✅ | Non-empty |
| `new_password` | string | ✅ | Same password rules as register |
| `new_password_confirm` | string | ✅ | Must match `new_password` |

### ChangePasswordDto

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `current_password` | string | ✅ | Non-empty |
| `new_password` | string | ✅ | Same password rules as register |
| `new_password_confirm` | string | ✅ | Must match `new_password` |

### RequestEmailChangeDto

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `new_email` | string | ✅ | Valid email |
| `current_password` | string | ✅ | Non-empty |

### Password Regex

```
^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$
```

Use this same regex for **client-side validation** to match server-side rules and provide instant feedback.

---

## 11. Secure Storage Guidelines

| Platform | Cookie Storage | Notes |
|---|---|---|
| **Web** | Browser cookie jar | Automatic — `httpOnly` prevents JS access |
| **React Native (iOS)** | `NSHTTPCookieStorage` | Stored in app sandbox, encrypted at rest by iOS |
| **React Native (Android)** | `CookieManager` | Use `PersistentCookieJar` for persistence across app restarts |
| **Flutter** | `PersistCookieJar` | Saves to app documents dir — encrypted at rest on both platforms |
| **iOS (Swift)** | `HTTPCookieStorage.shared` | Automatically stored in keychain-backed storage |
| **Android (Kotlin)** | `SharedPrefsCookiePersistor` | Consider Android Keystore for extra security |
| **Electron** | Chromium session cookies | Partition with `session.fromPartition()` for isolation |

### Do NOT:

- ❌ Extract tokens from cookies and store them in plain files
- ❌ Store tokens in SharedPreferences / UserDefaults without encryption
- ❌ Log tokens to console in production builds
- ❌ Transmit tokens over non-HTTPS connections in production

### Do:

- ✅ Let the HTTP client's cookie jar handle persistence natively
- ✅ Use platform-specific secure storage (Keychain, Keystore) when customizing
- ✅ Clear the cookie jar on explicit logout
- ✅ Use HTTPS in production (`secure: true` for cookies)

---

## 12. Offline & Background Considerations

### Offline Behavior

- Cache the last `/auth/me` response for offline display (user name, avatar).
- Queue actions (e.g., likes, comments) and replay when back online.
- On reconnect, call `/auth/refresh` immediately — the access token likely expired.

### Background Token Refresh

| Platform | Strategy |
|---|---|
| **React Native** | Use `AppState` listener → refresh on `active` state |
| **Flutter** | Use `WidgetsBindingObserver.didChangeAppLifecycleState` |
| **iOS** | `applicationWillEnterForeground` → refresh |
| **Android** | `onResume()` in Activity lifecycle |
| **Electron** | `powerMonitor.on('resume')` → refresh |

```ts
// React Native example
import { AppState } from "react-native";

AppState.addEventListener("change", (state) => {
  if (state === "active") {
    // App came to foreground — access token may have expired
    api.post("/auth/refresh").catch(() => navigateToLogin());
  }
});
```

### Push Notification Auth

If implementing push notifications that call the API, always wrap calls with the 401 → refresh → retry pattern:

```ts
async function handlePushNotification(data: PushData) {
  try {
    await api.get(`/tracks/${data.trackId}`);
  } catch (err) {
    if (err.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        await api.get(`/tracks/${data.trackId}`);
      }
      // If refresh fails, do nothing — user isn't logged in
    }
  }
}
```

---

## Rate Limits

All rate limits are per-IP. Mobile apps behind carrier NAT may share IPs.

| Endpoint | Limit |
|---|---|
| `register` | 5 / min |
| `resend-verification` | 3 / min |
| `login` | 10 / min |
| `verify-email` | 10 / min |
| `refresh` | 30 / min |
| `forgot-password` | 3 / min |
| `reset-password` | 5 / min |
| `change-password` | 5 / min |
| `email/change` | 3 / min |
| `email/confirm-change` | 5 / min |

When rate-limited, the server returns:

```json
{
  "statusCode": 429,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "timestamp": "...",
  "path": "..."
}
```

Implement exponential backoff or show a countdown timer.

---

## 13. Environment Setup & Credentials Guide

Before the backend can run, you need a `.env` file. Copy `.env.example` and fill in real values:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Where to Get It | Example |
|---|---|---|
| `DATABASE_URL` | Your PostgreSQL host (local Docker, Supabase, Neon, AWS RDS) | `postgresql://postgres:password@localhost:5432/iqa3?schema=public` |
| `JWT_SECRET` | **Generate yourself** — a long random string (≥ 32 chars). Use a password generator or `openssl rand -hex 32` | `a1b2c3d4e5...` (64 hex chars) |
| `JWT_REFRESH_SECRET` | Same as above — a **different** random string | `f6g7h8i9j0...` |
| `CLIENT_URL` | The URL of your frontend app | `http://localhost:5173` (dev) |

### Google OAuth Credentials

You need these three values for Google Login to work:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console (see below) |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console (see below) |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3000/api/v1/auth/google/callback` (dev) |

#### How to Get GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project from the top-left dropdown (or create one)
3. Search **"Credentials"** in the top search bar → select the result under **APIs & Services**
4. Under **OAuth 2.0 Client IDs**, click your app name (e.g., "Web client")
5. Copy the **Client ID** and **Client secret** from the right panel

#### Setting Up the Callback URL

The `GOOGLE_CALLBACK_URL` is the exact URL Google redirects to after the user logs in. **It must match what's registered in Google Cloud Console.**

| Environment | GOOGLE_CALLBACK_URL |
|---|---|
| Local dev | `http://localhost:3000/api/v1/auth/google/callback` |
| Production | `https://api.yourdomain.com/api/v1/auth/google/callback` |
| Mobile (custom scheme) | Set `FRONTEND_URL` to `spotly://auth/callback` for the post-login redirect |

**Critical:** On the same Credentials page where you found the Client ID, scroll to **Authorized redirect URIs**, click **"ADD URI"**, paste your callback URL exactly, and hit **Save**. If this doesn't match, Google OAuth will fail with a redirect_uri_mismatch error.

### Optional Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `development` or `production` |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `AUTH_COOKIE_SECURE` | `false` | Set `true` in production (requires HTTPS) |
| `RECAPTCHA_SECRET` | — | Google reCAPTCHA v3 secret key |
| `FRONTEND_URL` | `http://localhost:3000` | Where Google OAuth redirects after callback |

### Email / SMTP

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_HOST` | `smtp.mailtrap.io` | SMTP server |
| `MAIL_PORT` | `2525` | SMTP port |
| `MAIL_SECURE` | `false` | Use TLS |
| `MAIL_USER` | — | SMTP username |
| `MAIL_PASS` | — | SMTP password |
| `MAIL_FROM` | `Spotly <noreply@spotly.app>` | Sender address |

> **Tip for development:** Use [Mailtrap](https://mailtrap.io) or [Ethereal](https://ethereal.email) to catch emails without sending real ones.

### Complete `.env` Template

```env
# ─── Server ──────────────────────────────────────────
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# ─── Database ────────────────────────────────────────
DATABASE_URL="postgresql://postgres:password@localhost:5432/iqa3?schema=public"

# ─── JWT (generate your own secrets!) ────────────────
JWT_SECRET=replace_with_a_long_random_string_at_least_32_chars
JWT_REFRESH_SECRET=replace_with_a_different_long_random_string
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ─── Google OAuth 2.0 ───────────────────────────────
GOOGLE_CLIENT_ID=your_client_id_from_google_console
GOOGLE_CLIENT_SECRET=your_client_secret_from_google_console
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback

# ─── Auth Cookies ────────────────────────────────────
AUTH_COOKIE_SECURE=false

# ─── Email (SMTP) ───────────────────────────────────
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=2525
MAIL_USER=your_mailtrap_user
MAIL_PASS=your_mailtrap_pass
MAIL_FROM=Spotly <noreply@spotly.app>

# ─── reCAPTCHA (optional) ───────────────────────────
RECAPTCHA_SECRET=your_recaptcha_secret
```

---

## Quick Start Checklist

- [ ] Copy `.env.example` to `.env` and fill in all required values
- [ ] Get Google OAuth credentials from [Google Cloud Console](https://console.cloud.google.com/)
- [ ] Add your callback URL to Google's **Authorized redirect URIs**
- [ ] Generate strong random strings for `JWT_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Configure HTTP client with a **persistent cookie jar**
- [ ] Set base URL to `http://<host>:3000/api/v1`
- [ ] Implement the **401 → refresh → retry** interceptor pattern
- [ ] Handle all error codes from the [Error Code Table](#full-error-code-table)
- [ ] Add client-side password regex validation for instant feedback
- [ ] Implement Google OAuth via in-app browser (mobile) or redirect (web/desktop)
- [ ] Refresh tokens when app returns to foreground (mobile)
- [ ] Cache `/auth/me` response for offline display
- [ ] Use platform-specific secure storage — never store tokens in plain text
- [ ] Test with Android emulator using `10.0.2.2` instead of `localhost`
