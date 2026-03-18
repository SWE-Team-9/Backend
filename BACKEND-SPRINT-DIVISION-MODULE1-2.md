## Backend Team Sprint Division for Module 1 and Module 2

### 1. Team Members and Assigned Roles
- Member 1: Backend Lead + Security Owner
  - Owns backend architecture decisions, security design and implementation, auth/session/token logic review, API consistency, integration coordination, and final merge approval for sensitive backend features.
- Member 2: Core Authentication Engineer
  - Owns registration, email verification, resend verification, login, forgot password, and reset password.
- Member 3: OAuth + Sessions Engineer
  - Owns Google login, refresh token flow, logout, logout all devices, active sessions, single session revocation, and email change flow.
- Member 4: Profile & Identity Engineer
  - Owns get profile by handle, update profile, handle availability, privacy rules, favorite genres, external links, account tier logic, and account deactivation.
- Member 5: Media, Testing, Docs & Integration Engineer
  - Owns avatar and cover upload, storage layer, Swagger examples, Postman collection, test support, seeded test accounts, and backend integration support.

### 2. Completed Prior Work
- The ER diagram was already completed before sprint task division, so the remaining sprint plan focuses on API implementation, security, testing, documentation, and cross-team integration.

### 3. Sprint 1 Task Division
- Member 1
  - Finalize auth security architecture, token/cookie/session strategy, guards/authorization model, throttling and CAPTCHA policy, global error format, and DTO validation rules.
- Member 2
  - Prepare DTOs and service structure for register, verify email, resend verification, login, forgot password, and reset password.
- Member 3
  - Prepare DTOs and service structure for refresh, logout, sessions, revoke-all, revoke single session, Google OAuth, and email change.
- Member 4
  - Finalize DTOs and service structure for get profile, update profile, handle check, privacy visibility, external links, account tier logic, and deactivate account.
- Member 5
  - Set up upload module and storage abstraction; prepare Swagger examples, Postman structure, testing structure, and seed users for integration.

### 4. Sprint 2 Task Division
- Member 1
  - Implement auth guards, JWT validation, cookie handling, throttling/CAPTCHA verification; review all auth merges; support FE/Cross integration.
- Member 2
  - Implement POST /auth/register, GET /auth/verify-email, POST /auth/resend-verification, POST /auth/login, POST /auth/forgot-password, POST /auth/reset-password.
- Member 3
  - Implement POST /auth/refresh, POST /auth/logout, session/device tracking, and shared session service.
- Member 4
  - Implement GET /profiles/:handle, PATCH /profiles/me, GET /profiles/check-handle, and privacy-aware responses.
- Member 5
  - Implement POST /profiles/me/images/:type, connect upload to storage, update Swagger/Postman, and begin profile/upload tests.

### 5. Sprint 3 Task Division
- Member 1
  - Implement/supervise refresh rotation, token reuse detection, and revoke-all security behavior; complete security review for auth/session flows.
- Member 2
  - Implement PATCH /auth/change-password and GET /auth/me; improve validation and auth error handling; add unit tests.
- Member 3
  - Implement GET /auth/sessions, DELETE /auth/sessions/:sessionId, POST /auth/sessions/revoke-all, POST /auth/request-email-change, POST /auth/confirm-email-change, and Google OAuth login.
- Member 4
  - Implement external links update logic, artist/listener tier logic, DELETE /profiles/me, and finalize profile visibility rules.
- Member 5
  - Expand upload/profile tests, prepare demo seed accounts, finalize Postman examples, refine Swagger responses, and support integration tests.

### 6. Sprint 4 Task Division
- Member 1
  - Final security audit, final review of auth/session logic, verify cookie/CORS/rate limiting behavior, approve final merges, coordinate final backend integration.
- Member 2
  - Fix auth bugs, improve registration/login/recovery coverage, and finalize email flow edge cases.
- Member 3
  - Fix session/OAuth bugs, increase coverage for refresh/logout/session endpoints, and validate email-change and Google-login edge cases.
- Member 4
  - Fix profile/privacy bugs, improve profile endpoint coverage, and verify deactivation and handle edge cases.
- Member 5
  - Finalize Postman collection, Swagger docs, backend usage notes for FE/Cross teams, test reports, and backend documentation.

### 7. Deliverables per Sprint
- Sprint 1
  - Finalized API documentation draft, DTO validation rules, shared error format, shared auth/security structure, initial Swagger, initial Postman, seed accounts.
- Sprint 2
  - Registration/login completed, verification/password reset completed, profile retrieval/update completed, profile image upload completed, refresh/logout basics completed.
- Sprint 3
  - Session management completed, change password completed, email change completed, Google login completed, profile privacy completed, account deactivation completed.
- Sprint 4
  - Stable backend build, final Swagger docs, final Postman collection, finalized tests, integration-ready backend.

### 8. Integration Plan with Frontend and Cross-Platform Teams
API contracts will be stabilized early and documented using Swagger and Postman. Seeded test accounts and example requests/responses will be shared with the frontend and cross-platform teams to allow parallel development and reduce dependency on backend completion.

### 9. Code Review and Security Review Plan
The Backend Lead will also serve as the Security Owner and will be responsible for reviewing all authentication, session, token, and authorization-related backend work. Since authentication and session management are security-sensitive, all related pull requests will be reviewed by the Backend Lead, and module-specific pull requests will also be reviewed by the responsible feature owner before merging.
