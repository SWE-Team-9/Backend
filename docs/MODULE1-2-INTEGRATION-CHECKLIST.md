# Module 1 and Module 2 Integration Checklist (FE/Cross Teams)

This checklist is for integrating with backend authentication and profile APIs.

## 1) Base URL and API prefix

- Development base URL: `http://localhost:3000`
- API prefix: `/api/v1`
- Example full endpoint: `http://localhost:3000/api/v1/auth/login`

## 2) Required request headers

- `Content-Type: application/json` for JSON bodies
- `Accept: application/json`
- For multipart upload routes: do not set `Content-Type` manually; let the client set boundary
- Browser clients must send credentials (`withCredentials: true` for axios/fetch)

## 3) Cookie-based auth contract

Auth uses httpOnly cookies, not localStorage tokens.

- Access cookie: `access_token`
- Refresh cookie: `refresh_token`
- Cookies are set on:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `GET /api/v1/auth/google/callback`
- Cookies are cleared on:
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/sessions/revoke-all`
  - `PATCH /api/v1/auth/change-password`

## 4) Critical Module 1 endpoint checklist

- `POST /api/v1/auth/register`
  - Validates DTO; returns registration message
- `GET /api/v1/auth/verify-email?token=...`
  - Verifies email token
- `POST /api/v1/auth/resend-verification`
- `POST /api/v1/auth/login`
  - Sets auth cookies
- `POST /api/v1/auth/refresh`
  - Accepts refresh token from cookie or body
  - Rotates session refresh token
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:sessionId`
- `POST /api/v1/auth/sessions/revoke-all`
- `PATCH /api/v1/auth/change-password`
- `POST /api/v1/auth/request-email-change`
- `POST /api/v1/auth/confirm-email-change`

## 5) Critical Module 2 endpoint checklist

- `GET /api/v1/profiles/me`
- `GET /api/v1/profiles/check-handle?handle=...`
- `GET /api/v1/profiles/:handle`
- `PATCH /api/v1/profiles/me`
- `PUT /api/v1/profiles/me/links`
- Upload routes (both supported):
  - `POST /api/v1/profiles/me/avatar`
  - `POST /api/v1/profiles/me/cover`
  - `POST /api/v1/profiles/me/images/avatar`
  - `POST /api/v1/profiles/me/images/cover`

## 6) Profile image upload contract

- Body type: `multipart/form-data`
- Field name: `file`
- Allowed MIME: `image/jpeg`, `image/png`, `image/webp`
- Route param `:type` must be `avatar` or `cover`

## 7) Expected response envelope for errors

Global HTTP exception filter shape:

- `statusCode`
- `error`
- `message`
- `timestamp`
- `path`

Frontend should always parse this envelope for user-facing errors.

## 8) Seed/test account requirements

Current repo status:

- Seed script command exists: `npm run db:seed`
- Ensure local DB has at least:
  - 1 verified user account for login/refresh/session testing
  - 1 private profile and 1 public profile for visibility testing
  - at least 1 artist profile for track-count profile rendering path

Suggested FE/Cross shared accounts:

- `integration_user_verified@spotly.local` (verified, active)
- `integration_user_private@spotly.local` (verified, private profile)
- `integration_artist@spotly.local` (verified, account_type = ARTIST)

## 9) FE/Cross smoke tests before sprint demo

- Register a new account and verify DTO validation behavior
- Login and confirm both cookies are present
- Call refresh and confirm session still valid
- Read and update own profile
- Upload avatar image with valid MIME and confirm URL response
- Upload with invalid `:type` and confirm `400`
- Check profile handle availability with valid/invalid handles

## 10) Known integration caveats

- E2E test harness is now present for critical Module 1/2 flows.
- OAuth provider full-browser flow requires environment-specific callback setup.
- If `AUTH_COOKIE_SECURE=true` in local non-HTTPS setups, auth cookies will not persist in browser.
