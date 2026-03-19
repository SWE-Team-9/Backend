# Auth API Endpoints

This document lists all authentication-related API URLs currently registered in the backend.

## Base URL

- Local base URL: `http://localhost:3000`
- Global API prefix (from `src/main.ts`): `/api/v1`

For most auth routes in `AuthController` (`@Controller("auth")`), the full base path is:

- `http://localhost:3000/api/v1/auth`

## Public Endpoints (`AuthController`)

1. `POST /api/v1/auth/register`
- Purpose: Register a new user account.
- Body: `RegisterDto` (`email`, `password`, `password_confirm`, `display_name`, `date_of_birth`, `gender`, optional `captchaToken`).

2. `GET /api/v1/auth/verify-email?token=...`
- Purpose: Verify email address using verification token.
- Query: `VerifyEmailQueryDto` (`token`).

3. `POST /api/v1/auth/resend-verification`
- Purpose: Resend verification email for unverified accounts.
- Body: `ResendVerificationDto` (`email`).

4. `POST /api/v1/auth/login`
- Purpose: Login with email/password and set auth cookies.
- Body: `LoginDto` (`email`, `password`, optional `remember_me`).

5. `POST /api/v1/auth/forgot-password`
- Purpose: Request password reset link.
- Body: `ForgotPasswordDto` (`email`).

6. `POST /api/v1/auth/reset-password`
- Purpose: Reset password via token.
- Body: `ResetPasswordDto` (`token`, `new_password`, `new_password_confirm`).

7. `POST /api/v1/auth/refresh`
- Purpose: Rotate refresh token and issue new access token.
- Body: `RefreshTokenDto` (optional fallback if cookie missing).

8. `POST /api/v1/auth/logout`
- Purpose: Logout current session and clear cookies.
- Body: `RefreshTokenDto` (optional).

9. `GET /api/v1/auth/google`
- Purpose: Start Google OAuth flow.

10. `GET /api/v1/auth/google/callback`
- Purpose: Google OAuth callback.

## Protected Endpoints (`AuthController`)

1. `POST /api/v1/auth/sessions/revoke-all`
- Purpose: Revoke all active sessions for current user.

2. `GET /api/v1/auth/sessions`
- Purpose: List active sessions for current user.

3. `DELETE /api/v1/auth/sessions/:sessionId`
- Purpose: Revoke one specific session.
- Params: `RevokeSessionParamsDto` (`sessionId`).

4. `PATCH /api/v1/auth/change-password`
- Purpose: Change current user password.
- Body: `ChangePasswordDto` (`current_password`, `new_password`, `new_password_confirm`).

5. `GET /api/v1/auth/me`
- Purpose: Fetch current authenticated user profile.

6. `POST /api/v1/auth/request-email-change`
- Purpose: Request email change.
- Body: `RequestEmailChangeDto` (`new_email`, `current_password`).

7. `POST /api/v1/auth/confirm-email-change`
- Purpose: Confirm email change with token.
- Body: `ConfirmEmailChangeDto` (`token`).

## Additional Endpoints (`AuthSessionController`)

`AuthSessionController` currently uses `@Controller("api/v1/auth")` while the app already has global prefix `/api/v1`.

That means these endpoints are currently mounted under:

- `/api/v1/api/v1/auth/...`

### Public

1. `POST /api/v1/api/v1/auth/refresh`
- Purpose: Refresh access token via session-management service.

### Protected

2. `GET /api/v1/api/v1/auth/sessions`
- Purpose: Get active sessions.

3. `DELETE /api/v1/api/v1/auth/sessions/:sessionId`
- Purpose: Revoke a specific session.

4. `POST /api/v1/api/v1/auth/logout`
- Purpose: Logout from all devices.

5. `POST /api/v1/api/v1/auth/email-change/request`
- Purpose: Request email change.

6. `POST /api/v1/api/v1/auth/email-change/confirm`
- Purpose: Confirm email change.

## Swagger

In development mode, open:

- `http://localhost:3000/api/docs`

Auth endpoints appear under the `Auth` tag.

## Note

There is overlap between `AuthController` and `AuthSessionController` for session-related features (`refresh`, `sessions`, `logout`, email-change flows). If you want a single clean public API surface, keep one controller as the source of truth and retire duplicate routes.
