# Swagger UI Visual Guide

## Quick Reference: What You'll See

When you open `http://localhost:3000/api/docs`, you'll see:

### Top Navigation
```
┌─────────────────────────────────────────────────────────────────────┐
│  🔗 Swagger UI                                          🔍 Details   │
│  IQA3 API                                               Authorize ▼  │
│  Social Streaming Platform backend API documentation (development)  │
│  Version: 1.0                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Left Sidebar: Endpoint Groups
```
📌 🔓 Auth                                      (18 endpoints)
  ├─ 🔓 POST   /auth/register
  ├─ 🔓 GET    /auth/verify-email
  ├─ 🔓 POST   /auth/resend-verification
  ├─ 🔓 POST   /auth/login
  ├─ 🔓 POST   /auth/forgot-password
  ├─ 🔓 POST   /auth/reset-password
  ├─ 🔓 POST   /auth/refresh
  ├─ 🔓 POST   /auth/logout
  ├─ 🔒 GET    /auth/sessions
  ├─ 🔒 DELETE /auth/sessions/{sessionId}
  ├─ 🔒 POST   /auth/sessions/revoke-all
  ├─ 🔒 PATCH  /auth/change-password
  ├─ 🔒 GET    /auth/me
  ├─ 🔒 POST   /auth/request-email-change
  ├─ 🔒 POST   /auth/confirm-email-change
  ├─ 🔓 GET    /auth/google
  └─ 🔓 GET    /auth/google/callback

📌 🔓 Profiles                                  (7 endpoints)
  ├─ 🔒 GET    /profiles/me
  ├─ 🔓 GET    /profiles/check-handle
  ├─ 🔓 GET    /profiles/{handle}
  ├─ 🔒 PATCH  /profiles/me
  ├─ 🔒 PUT    /profiles/me/links
  ├─ 🔒 POST   /profiles/me/{type}
  └─ 🔒 POST   /profiles/me/images/{type}

Legend: 🔓 Public (no auth) | 🔒 Protected (requires auth)
```

---

## Endpoint Detail View

When you click on an endpoint, you see:

### Example: POST /auth/login

```
╔══════════════════════════════════════════════════════════════════════╗
║ POST /auth/login                                                     ║
║ ✅ Login with email and password                    [Try it out ▼]  ║
╚══════════════════════════════════════════════════════════════════════╝

DESCRIPTION:
───────────
Authenticate user and create a session with JWT token pair.

Flow:
1. Look up user by email (constant-time comparison)
2. Verify password against Argon2 hash
3. Check email is verified
4. Create new session (device fingerprinting)
5. Issue access token (15-min TTL) + refresh token (7-day TTL)
6. Set both as httpOnly cookies (XSS-safe, CSRF-safe)
7. Return user info + sessions

Rate Limited: 10 attempts/min by IP, 5 attempts/15min by email.
Tokens: Access & Refresh stored as httpOnly, Secure, SameSite=Strict.
Remember Me: Optional flag extends refresh token to 30 days.

PARAMETERS:
──────────
(none)

REQUEST BODY:
─────────────
{
  "email": "string",           (required, email format)
  "password": "string",        (required, 8+ chars, mixed case + special)
  "rememberMe": boolean        (optional, default: false)
}

RESPONSES:
──────────

✅ 200 OK — Login successful, tokens set as httpOnly cookies
   Response body:
   {
     "message": "Login successful.",
     "user": {
       "id": "uuid",
       "email": "user@example.com",
       "role": "USER",
       "isVerified": true
     }
   }
   Cookies: access_token, refresh_token

❌ 401 Unauthorized — Invalid credentials, email not verified, or account 
   suspended/banned/deleted
   Response body:
   {
     "statusCode": 401,
     "error": "NOT_AUTHENTICATED",
     "message": "Invalid email or password.",
     "timestamp": "2026-03-18T12:00:00Z",
     "path": "/api/v1/auth/login"
   }

❌ 429 Too Many Requests — Rate limit exceeded
   Response body:
   {
     "statusCode": 429,
     "error": "RATE_LIMIT_EXCEEDED",
     "message": "Too many login attempts. Try again later.",
     "timestamp": "2026-03-18T12:00:00Z",
     "path": "/api/v1/auth/login"
   }
```

---

## "Try It Out" Button

When you click **[Try it out ▼]** button:

### Before:
```
┌─ REQUEST BODY ──────────────────────────────────────┐
│  Schema: LoginDto                                   │
│  ┌──────────────────────────────────────────────┐  │
│  │ {                                            │  │
│  │   "email": "string",                         │  │
│  │   "password": "string",                      │  │
│  │   "rememberMe": boolean                      │  │
│  │ }                                            │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### After (editable):
```
┌─ REQUEST BODY ──────────────────────────────────────┐
│  Schema: LoginDto                                   │
│  ┌──────────────────────────────────────────────┐  │
│  │ {                                            │  │
│  │   "email": "test@example.com",               │  │
│  │   "password": "TestPass123!",                │  │
│  │   "rememberMe": false                        │  │
│  │ }                                            │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  [Execute] [Cancel] [Clear]                        │
└─────────────────────────────────────────────────────┘
```

Then click **[Execute]** → Request sent → Response shown below

---

## Response Display

### Success (200 OK):
```
┌─ RESPONSES ─────────────────────────────────────────┐
│ 200 OK                                [▼]           │
│ ├─ Headers                                          │
│ │  content-type: application/json                  │
│ │  set-cookie: access_token=..., refresh_token=...│
│ │  x-powered-by: NestJS                           │
│ │                                                  │
│ ├─ Body                                            │
│ │  {                                               │
│ │    "message": "Login successful.",              │
│ │    "user": {                                     │
│ │      "id": "550e8400-e29b-41d4-a716-446...",   │
│ │      "email": "test@example.com",              │
│ │      "role": "USER",                           │
│ │      "isVerified": true                        │
│ │    }                                            │
│ │  }                                              │
│ │                                                 │
│ └─ Copy | Download                                │
└─────────────────────────────────────────────────────┘
```

### Error (401 Unauthorized):
```
┌─ RESPONSES ─────────────────────────────────────────┐
│ 401 Unauthorized                        [▼]         │
│ ├─ Headers                                          │
│ │  content-type: application/json                  │
│ │                                                  │
│ ├─ Body                                            │
│ │  {                                               │
│ │    "statusCode": 401,                           │
│ │    "error": "NOT_AUTHENTICATED",                │
│ │    "message": "Invalid email or password.",     │
│ │    "timestamp": "2026-03-18T12:00:00.000Z",   │
│ │    "path": "/api/v1/auth/login"                │
│ │  }                                              │
│ │                                                 │
│ └─ Copy | Download                                │
└─────────────────────────────────────────────────────┘
```

---

## Authorized (Protected) Endpoints

### Automatic Cookie Injection

After you login (Step 1):

```
Step 1: POST /auth/login ✅
  ├─ Execute
  └─ Response includes: set-cookie headers
     └─ access_token, refresh_token auto-stored in browser

Step 2: GET /auth/me ✅
  ├─ Click "Try it out"
  ├─ Execute
  └─ Requests automatically includes cookies (transparent!)
     └─ No manual header setup needed
```

### Authorization Header (Alternative)

For non-Swagger testing (Postman, curl):

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Cookie: access_token=eyJhbGci..."
```

---

## File Upload Example

### POST /profiles/me/avatar

```
┌─ PARAMETERS ────────────────────────────────────────┐
│ type (path parameter)                               │
│ ├─ avatar                                           │
│ └─ [Required]                                       │
├─ file (form-data)                                  │
│ └─ [Choose File] [Select file...]                  │
└─────────────────────────────────────────────────────┘
```

After clicking [Select file...]:

```
┌─ FILE SELECTOR ─────────────────────────────────────┐
│ File: avatar.jpg                                    │
│ Size: 2.3 MB ✅ (< 5 MB limit)                      │
└─────────────────────────────────────────────────────┘

[Execute]
```

Response:

```
┌─ RESPONSE ──────────────────────────────────────────┐
│ 200 OK                                              │
│ {                                                   │
│   "url": "http://localhost:3000/uploads/avatar/...",
│   "key": "avatar/a3f8c9d2-1e5b-4c3d-9b2a-..."     │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

---

## Schema / Model Documentation

### Clicking Models tab:

```
┌─ MODELS ────────────────────────────────────────────┐
│ RegisterDto                           [▼]           │
│ ├─ email (string, email format)                    │
│ ├─ password (string, pattern: uppercase + lower...) │
│ ├─ password_confirm (string, must match password)  │
│ ├─ display_name (string, 2-50 chars)              │
│ ├─ date_of_birth (string-date, age >= 13)         │
│ ├─ gender (string, MALE/FEMALE/PREFER_NOT)       │
│ └─ captchaToken (string, from reCAPTCHA v3)       │
│                                                     │
│ LoginDto                              [▼]           │
│ ├─ email (string, email format)                    │
│ ├─ password (string)                              │
│ └─ rememberMe (boolean, optional)                 │
│                                                     │
│ UpdateProfileDto                      [▼]           │
│ ├─ display_name (string, 2-50 chars, optional)   │
│ ├─ bio (string, max 500 chars, optional)         │
│ ├─ location (string, max 100 chars, optional)    │
│ ├─ website (string-url, HTTPS, optional)         │
│ ├─ is_private (boolean, optional)                │
│ ├─ favorite_genres (array<string>, max 5)        │
│ └─ account_type (LISTENER|ARTIST, optional)      │
│                                                     │
│ ... (24 more models)                              │
└─────────────────────────────────────────────────────┘
```

---

## Quick Testing Workflow

### See This in Swagger:

```
STEP 1: Register
├─ Find: POST /auth/register
├─ Fill: email, password, display_name, etc.
├─ Click: [Execute]
└─ Result: 201 Created ✅

STEP 2: Verify Email
├─ Find: GET /auth/verify-email
├─ Enter: token (from email/logs)
├─ Click: [Execute]
└─ Result: 200 OK — Email verified ✅

STEP 3: Login
├─ Find: POST /auth/login
├─ Fill: email, password
├─ Click: [Execute]
└─ Result: 200 OK + Cookies set ✅

STEP 4: Test Protected Endpoint
├─ Find: GET /auth/me
├─ Click: [Execute]
└─ Result: 200 OK + Current user profile ✅
          (used cookie from Step 3 automatically)

STEP 5: Update Profile
├─ Find: PATCH /profiles/me
├─ Fill: display_name, bio, genres
├─ Click: [Execute]
└─ Result: 200 OK + Updated profile ✅

STEP 6: Upload Avatar
├─ Find: POST /profiles/me/avatar
├─ Select: avatar type, choose JPG/PNG/WebP file
├─ Click: [Execute]
└─ Result: 200 OK + Image URL ✅

STEP 7: Verify Avatar in Profile
├─ Find: GET /profiles/me
├─ Click: [Execute]
└─ Result: 200 OK + avatar_url shows uploaded image ✅
```

---

## Error Scenarios to Test

### Try These in Swagger:

**Test 1: Weak Password**
```
POST /auth/register
{
  "email": "test@example.com",
  "password": "weak",           ← No uppercase/number/special
  "password_confirm": "weak",
  ...
}
Result: 400 Bad Request (validation error)
```

**Test 2: Email Already Exists**
```
POST /auth/register
{
  "email": "existing@example.com",  ← Already registered
  ...
}
Result: 409 Conflict
```

**Test 3: Invalid Email Format**
```
POST /auth/register
{
  "email": "notanemail",            ← Missing @domain
  ...
}
Result: 400 Bad Request
```

**Test 4: Rate Limit Exceeded**
```
POST /auth/login (send 11 times rapidly)
  1-10: 200 OK / 401 (depending on auth success)
  11:   429 Too Many Requests (rate limit)
Result: 429 Too Many Requests
```

**Test 5: Invalid Handle Format**
```
GET /profiles/check-handle?handle=ab
  (only 2 chars, needs 3-30)
Result: 400 Bad Request
```

**Test 6: File Too Large**
```
POST /profiles/me/avatar
  file: image-50mb.jpg (exceeds 5MB limit)
Result: 400 Bad Request
```

---

## Swagger Settings

### Top-Right Menu:

```
🔍 Explore                ← Search endpoints
⚙️  Authorize             ← Manual auth setup (if cookies fail)
ⓘ  Documentation         ← Keyboard shortcuts
```

### Keyboard Shortcuts (click ⓘ):

```
Cmd/Ctrl + K/Cmd : Focus on server selection
> : Open filter/search
```

---

## Tips & Tricks

### 1. **Copy-Paste Requests**
Every response has "Copy" button → paste full JSON into code

### 2. **Download Responses**
Download JSON files for saving test data

### 3. **Share Swagger Link**
Send `http://localhost:3000/api/docs` to teammates
(dev-only, disabled in production)

### 4. **Postman Import**
Export OpenAPI as JSON → Import into Postman
```
JSON location: GET /api-docs
```

### 5. **Filter Endpoints**
Use search box (🔍) to filter by endpoint name
```
"register" → Shows auth register endpoints only
"profile"  → Shows profile endpoints only
```

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| **Cookies not saving** | Try re-login, check browser DevTools → Cookies |
| **"Try it out" button disabled** | Refresh page, clear browser cache |
| **Endpoint shows 401 even after login** | Cookies may have expired, re-login |
| **File upload fails** | Check MIME type (JPEG/PNG/WebP) and size (< 5/15MB) |
| **Rate limit: 429** | Wait a minute, then try again |
| **"CAPTCHA failed"** | In dev mode, invalid CAPTCHA is OK, use dummy token |

---

## Next: Frontend Integration

### Copy these URLs to share with your team:

📌 **Swagger UI:**
```
http://localhost:3000/api/docs
```

📌 **OpenAPI JSON Spec:**
```
http://localhost:3000/api-docs
```

📌 **API Base URL:**
```
http://localhost:3000/api/v1
```

📌 **Documentation Files:**
```
docs/SWAGGER-DOCUMENTATION.md         ← User guide
docs/SWAGGER-WALKTHROUGH.md           ← This guide
docs/SECURITY-AUDIT-REPORT.md      ← Security details
docs/MODULE1-2-INTEGRATION-CHECKLIST.md ← Integration checklist
```

---

**Happy Testing!** 🚀
