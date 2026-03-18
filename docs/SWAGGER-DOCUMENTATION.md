# Swagger API Documentation Guide - Spotly Backend

## 📚 Overview

The Spotly backend uses **NestJS Swagger** (OpenAPI 3.0) to generate interactive API documentation with detailed descriptions, request/response schemas, and live testing capabilities.

### Quick Start

**Access Swagger UI in Development:**
```
http://localhost:3000/api/docs
```

The Swagger UI provides:
- 🔍 Full endpoint listing with descriptions
- 📝 Request/response schema visualization
- 🧪 "Try it out" testing interface for all endpoints
- 🔐 Cookie-based authentication (httpOnly)
- ⚙️ Query/path parameter builders
- 📋 Standardized error response documentation

---

## 🏗️ Architecture & Organization

### Module 1: Authentication (`GET /api/docs#/Auth`)

All authentication endpoints are grouped under the **"Auth"** tag.

#### Core Registration & Email Verification

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/auth/register` | `POST` | 3/min | Create new account with CAPTCHA |
| `/auth/verify-email` | `GET` | 100/min | Confirm email ownership |
| `/auth/resend-verification` | `POST` | 3/hr | Re-send verification email |

**Documentation Highlights:**
- Registration includes reCAPTCHA v3 verification (bot prevention)
- Passwords require: uppercase, lowercase, number, special character (minimum 8 chars)
- Email verification: 24-hour token TTL, single-use
- Registration fails if email already taken (409 Conflict)

#### Login & Session Management

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/auth/login` | `POST` | 10/min (IP), 5/15min (email) | Authenticate user, create session |
| `/auth/refresh` | `POST` | 30/min | Rotate tokens, extend session |
| `/auth/logout` | `POST` | 100/min | Revoke current session |
| `/auth/sessions` | `GET` | 100/min | List all active sessions |
| `/auth/sessions/:sessionId` | `DELETE` | 100/min | Revoke specific session |
| `/auth/sessions/revoke-all` | `POST` | 100/min | Logout all devices |

**Documentation Highlights:**

**Login Flow:**
- Validates email + password (constant-time comparison)
- Verifies email is confirmed before login allowed
- Creates session with device fingerprinting (user agent, IP)
- Issues JWT access token (15 min TTL) + refresh token (7 days TTL)
- Both tokens stored as **httpOnly cookies** (XSS-safe, CSRF-safe)
- Returns user info + active sessions list

**Token Rotation:**
- `/refresh` exchanges refresh token for new access token (auto-rotation)
- Old refresh token invalidated (prevents replay attacks)
- Can be called from httpOnly cookie OR request body (fallback)

**Session Management:**
- Users see all logged-in devices with IP, user agent, last-seen timestamp
- Can revoke any device individually
- "Logout all" revokes all sessions across all devices

#### Password Management

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/auth/forgot-password` | `POST` | 3/hr | Request password reset email |
| `/auth/reset-password` | `POST` | 3/hr | Complete password reset with token |
| `/auth/change-password` | `PATCH` | 100/min | Change password (requires current password) |

**Documentation Highlights:**

**Forgot Password:**
- Generic response (prevents user enumeration)
- Sends reset email only if account exists
- 1-hour token TTL
- Password reset revokes all sessions (force re-login everywhere)

**Change Password:**
- Requires verification of current password (CSRF protection)
- Requires access token (protected endpoint)
- Revokes all sessions after password change

#### Email Management

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/auth/request-email-change` | `POST` | 3/hr | Request email address change |
| `/auth/confirm-email-change` | `POST` | 3/hr | Confirm new email address |
| `/auth/me` | `GET` | 100/min | Get current user profile |

**Documentation Highlights:**

**Email Change Flow:**
- Initiator sends new email → verification link sent to NEW address
- User confirms via /confirm-email-change with token
- Old email remains active until confirmation
- Both endpoints rate-limited to prevent brute-force

#### OAuth (Google Login)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/google` | `GET` | Public | Initiate Google OAuth flow |
| `/auth/google/callback` | `GET` | Public | Google OAuth callback handler |

**Documentation Highlights:**
- Redirects to Google login screen
- Callback handler creates/links account
- User auto-logged in after OAuth completion

---

### Module 2: User Profiles (`GET /api/docs#/Profiles`)

All profile endpoints are grouped under the **"Profiles"** tag.

#### Profile Retrieval

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/profiles/me` | `GET` | Required | Get current user's full profile |
| `/profiles/:handle` | `GET` | Public | Get any user's profile (respects privacy) |

**Documentation Highlights:**

**GET /profiles/me:**
- Returns complete profile with all private fields
- User viewing own profile
- Includes: handle, display name, avatar, bio, location, website, genres, links, counts, dates

**GET /profiles/:handle:**
- Public endpoint (no auth required)
- Privacy-aware responses:
  - **Public profile:** Returns full profile
  - **Private profile (not owner):** Returns name, avatar, account type only
  - **Private profile (owner):** Returns full profile (automatic bypass if authenticated)
- Handle is URL-safe identifier (alphanumeric + underscore)

#### Profile Management

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/profiles/check-handle` | `GET` | 100/min | Verify handle availability |
| `/profiles/me` | `PATCH` | 100/min | Update profile (partial) |
| `/profiles/me/links` | `PUT` | 100/min | Update social links (full replace) |

**Documentation Highlights:**

**Check Handle:**
- Validates format: 3-30 alphanumeric + underscores
- Returns availability + reason if taken
- 30-day retirement window (recently-deleted handles reserved)

**Update Profile (PATCH):**
- Partial updates (only provided fields changed)
- Updatable: display_name, bio, location, website, is_private, favorite_genres, account_type
- NOT updatable: handle, email, password (separate endpoints)
- Website: HTTPS-only, SSRF-validated, XSS-safe

**Update Social Links (PUT):**
- Full replace (atomically replaces entire link set)
- Supported platforms: Instagram, YouTube, Spotify, Twitter, TikTok, Twitch, Discord, etc.
- All URLs HTTPS, SSRF-validated
- Max 15 links total
- Send empty array to clear all

#### File Uploads

| Endpoint | Method | Rate Limit | Description |
|----------|--------|-----------|-------------|
| `/profiles/me/:type` | `POST` | 10/min | Upload avatar or cover image |
| `/profiles/me/images/:type` | `POST` | 10/min | Upload image (backward-compatible alias) |

**Documentation Highlights:**

**Image Upload:**
- Types: `avatar` (5MB max), `cover` (15MB max)
- MIME types: JPEG, PNG, WebP only
- Request format: `multipart/form-data` with `file` field
- Returns: URL to access image + storage key
- Storage: Local disk (dev) or S3 + CloudFront CDN (prod)
- Rate limited: 10 per minute per user

**Two Route Formats:**
- `POST /profiles/me/:type` (recommended)
- `POST /profiles/me/images/:type` (backward-compatible, same logic)

---

## 🔑 Authentication in Swagger UI

### Cookie-Based Auth Setup

Swagger automatically handles httpOnly cookies after login:

#### Manual Setup (if cookies not auto-detected):

1. **Call `/auth/login`:**
   - Provide email + password
   - Execute request
   - Cookies set automatically in browser

2. **For subsequent requests:**
   - Cookies auto-attached (httpOnly = transparent)
   - Swagger UI maintains session across requests
   - No manual header needed

#### Troubleshooting Cookie Issues:

If Swagger UI shows "401 Not Authenticated" on protected endpoints:

1. Ensure cookies enabled in browser
2. Check browser DevTools → Application → Cookies
3. Verify `access_token` cookie present
4. Try re-login via `/auth/login` endpoint

### Bearer Token (Alternative for testing)

Some endpoints accept Bearer token in Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

This is NOT recommended for production (use cookies), but works for testing.

---

## 📋 Request/Response Examples

### Example 1: User Registration

**Request:**
```json
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd",
  "password_confirm": "SecureP@ssw0rd",
  "display_name": "DJ Mohan",
  "date_of_birth": "2000-01-15",
  "gender": "MALE",
  "captchaToken": "<token_from_recaptcha_v3>"
}
```

**Response (201 Created):**
```json
{
  "message": "Registration successful. Please check your email for a verification link."
}
```

**Expected Workflow:**
1. Check email for verification link
2. Click link or copy token to `/auth/verify-email?token=...`
3. Once verified, call `/auth/login`

---

### Example 2: Login with Session

**Request:**
```json
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd",
  "rememberMe": false
}
```

**Response (200 OK):**
```json
{
  "message": "Login successful.",
  "user": {
    "id": "user-uuid-here",
    "email": "user@example.com",
    "role": "USER",
    "isVerified": true
  }
}
```

**Cookies Set (by server):**
- `access_token` (httpOnly, secure, sameSite=strict, 15m expiry)
- `refresh_token` (httpOnly, secure, sameSite=strict, 7d expiry)

---

### Example 3: Get Profile with Privacy

**Request (GET public profile):**
```
GET /api/v1/profiles/dj_mohan
```

**Response (Profile is PUBLIC):**
```json
{
  "handle": "dj_mohan",
  "display_name": "DJ Mohan",
  "bio": "Music producer & sound engineer",
  "location": "New York, NY",
  "avatar_url": "https://cdn.spotly.app/uploads/avatar/uuid.jpg",
  "cover_url": "https://cdn.spotly.app/uploads/cover/uuid.jpg",
  "website": "https://djmohan.com",
  "account_type": "ARTIST",
  "is_private": false,
  "favorite_genres": ["electronic", "house", "techno"],
  "bio_links": [
    { "platform": "instagram", "url": "https://instagram.com/djmohan" },
    { "platform": "youtube", "url": "https://youtube.com/c/djmohan" }
  ],
  "stats": {
    "follower_count": 1250,
    "following_count": 320,
    "track_count": 45
  },
  "created_at": "2025-06-01T12:00:00Z"
}
```

**Response (Profile is PRIVATE & Not Owner):**
```json
{
  "handle": "dj_mohan",
  "display_name": "DJ Mohan",
  "avatar_url": "https://cdn.spotly.app/uploads/avatar/uuid.jpg",
  "account_type": "ARTIST",
  "is_private": true
}
```

---

### Example 4: Update Profile

**Request (PATCH partial update):**
```json
PATCH /api/v1/profiles/me
Content-Type: application/json
Authorization: <auto-injected via cookie>

{
  "display_name": "DJ Mohan (Prod)",
  "bio": "Electronic music producer",
  "favorite_genres": ["house", "techno", "deep-house"],
  "account_type": "ARTIST"
}
```

**Response (200 OK):**
```json
{
  "handle": "dj_mohan",
  "display_name": "DJ Mohan (Prod)",
  "bio": "Electronic music producer",
  "favorite_genres": ["house", "techno", "deep-house"],
  "account_type": "ARTIST",
  "... other unchanged fields ..."
}
```

---

### Example 5: Upload Avatar

**Request (multipart/form-data):**
```
POST /api/v1/profiles/me/avatar
Content-Type: multipart/form-data
Authorization: <auto-injected via cookie>

file: <binary image data - avatar.jpg>
```

**Response (200 OK):**
```json
{
  "url": "https://cdn.spotly.app/uploads/avatar/a3f8c9d2-1e5b-4c3d-9b2a-7f1e3d5c9a2b.jpg",
  "key": "avatar/a3f8c9d2-1e5b-4c3d-9b2a-7f1e3d5c9a2b.jpg"
}
```

The new avatar immediately visible in `GET /api/v1/profiles/me` or `GET /api/v1/profiles/:handle`

---

## 🛡️ Security & Error Handling

### Standard Error Response Format

All endpoints return consistent error envelopes:

```json
{
  "statusCode": 400,
  "error": "VALIDATION_FAILED",
  "message": "password must include uppercase, lowercase, number, and special character.",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "path": "/api/v1/auth/register"
}
```

### Common Error Codes

| Status | Error Code | Meaning |
|--------|-----------|---------|
| 400 | VALIDATION_FAILED | DTO validation failed (invalid email, weak password, etc.) |
| 401 | NOT_AUTHENTICATED | Missing or invalid access token |
| 409 | CONFLICT | Resource already exists (email already registered) |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests to this endpoint |
| 500 | INTERNAL_SERVER_ERROR | Unexpected server error (never leaks stack trace) |

### No Stack Trace Leakage

Error responses never include:
- Stack traces (even in development via Swagger)
- Database query details
- Internal service names
- Source code references

All errors are **user-friendly and security-conscious**.

---

## 🧪 Testing Workflows in Swagger UI

### Workflow 1: Complete Auth Flow

1. **Register:**
   - Open `POST /auth/register`
   - Fill in registration form
   - Send request
   - Note: Verification email required (check logs in dev mode)

2. **Verify Email:**
   - Copy token from verification email (or logs)
   - Open `GET /auth/verify-email`
   - Paste token in `token` query parameter
   - Send request → "Email verified successfully"

3. **Login:**
   - Open `POST /auth/login`
   - Enter email + password
   - Check "Try it out" checkbox
   - Send request → Cookies set automatically
   - Access & Refresh tokens now available for protected endpoints

4. **Get Current User (verify auth works):**
   - Open `GET /auth/me`
   - Click "Try it out"
   - Send request → Should return user profile

---

### Workflow 2: Profile Update & Image Upload

1. **Check Handle:**
   - Open `GET /profiles/check-handle`
   - Enter handle to check (e.g., "cool_dj")
   - Send request → See availability

2. **Update Profile:**
   - Open `PATCH /profiles/me`
   - Update some fields (display_name, bio, genres)
   - Send request → Profile updated

3. **Upload Avatar:**
   - Open `POST /profiles/me/avatar`
   - Click "Select File"
   - Choose JPG/PNG/WebP (max 5MB)
   - Send request → URL returned

4. **View Updated Profile:**
   - Open `GET /profiles/me`
   - Send request → See avatar URL + updated fields

---

## 📊 Swagger File Structure

### Location
```
src/main.ts  →  Swagger setup (development only)
```

### Configuration
```typescript
const config = new DocumentBuilder()
  .setTitle("IQA3 API")
  .setDescription("Social Streaming Platform documentation")
  .setVersion("1.0")
  .addCookieAuth("access_token", { ... })
  .addBearerAuth()
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup("api/docs", app, document);  // ← Accessible at /api/docs
```

### Decorators per Endpoint

Each endpoint has:
- `@ApiTags()` — Groups endpoints (Auth, Profiles)
- `@ApiOperation()` — Summary + detailed description
- `@ApiResponse()` — Expected responses with status codes
- DTOs auto-documented via class decorators (@IsEmail, @Length, etc.)

---

## 🚀 Production Deployment

### Swagger in Production

Swagger UI is **disabled in production** for security:
- `/api/docs` returns 404 or redirects
- OpenAPI JSON not exposed to external clients
- Development-only logging suppressed

Configuration in `main.ts`:
```typescript
if (!isProduction) {
  SwaggerModule.setup("api/docs", app, document);
}
```

### Updated Documentation via CI/CD

For production documentation:
1. Export OpenAPI spec: `npm run swagger:export`
2. Host on separate docs site (e.g., Postman, Swagger Hub)
3. Include in developer portal

---

## 📱 Integration with Frontend

### HTTP Client Configuration

Frontend libraries should:

1. **Enable credentials (cookies):**
   ```typescript
   // Axios
   axios.defaults.withCredentials = true;
   
   // Fetch
   fetch("/api/v1/...", { credentials: "include" })
   ```

2. **Handle 401 errors:**
   - Call `POST /api/v1/auth/refresh` to get new access token
   - Retry original request
   - If refresh fails (401), redirect to login

3. **Seed data for testing:**
   - Use Postman collection exported from Swagger
   - Or manually test via Swagger UI first

---

## ✅ Checklist for Integration Team

- [ ] Read Auth flow documentation (register → verify → login → refresh)
- [ ] Understand cookie-based auth (httpOnly, secure, sameSite=strict)
- [ ] Test `/auth/login` → `/auth/refresh` flow in Swagger
- [ ] Test profile endpoints with privacy rules (public vs. private)
- [ ] Verify error responses match expected format
- [ ] Test file upload with valid MIME types + size limits
- [ ] Test rate limiting (multiple requests to same endpoint)
- [ ] Verify session management (list, revoke individual, revoke-all)

---

## 🔗 Quick Links

- **Swagger UI (dev):** `http://localhost:3000/api/docs`
- **API Base URL (dev):** `http://localhost:3000/api/v1`
- **Security Audit Report:** `docs/SECURITY-AUDIT-REPORT.md`
- **Module 1-2 Integration Checklist:** `docs/MODULE1-2-INTEGRATION-CHECKLIST.md`

---

**Last Updated:** March 18, 2026  
**Status:** ✅ Ready for Frontend/Cross-Platform Integration
