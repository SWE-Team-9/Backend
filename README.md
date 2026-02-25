# IQA3 — Backend

# Phase 0: Proposal & Architecture

## Company & Project Overview
**Company Name:** IQA3  
**Project:** Social Streaming Platform (SoundCloud Clone)


## Architecture & Design Patterns

The backend follows the **MVC (Model-View-Controller)** architectural pattern, which NestJS implements natively through its module system. This is the industry-standard pattern for REST API backends and is explicitly recommended for projects of this scale.

### Design Patterns Used

1. **MVC (Model-View-Controller)**  
   Controllers handle incoming HTTP requests and delegate to Services. Services contain all business logic and interact with Models (Prisma) for data access. This separation keeps each layer testable and independent.

2. **Dependency Injection (IoC Container)**  
   NestJS provides a built-in IoC container. All services, repositories, and providers are injected through constructors rather than instantiated directly. This makes unit testing straightforward (swap real services for mocks) and keeps modules loosely coupled.

3. **DTO (Data Transfer Object) Pattern**  
   Every incoming request is validated against a DTO class using `class-validator` decorators before it reaches the controller logic. This prevents malformed data, injection attacks, and type mismatches at the boundary layer.

4. **Guard Pattern (Strategy variant)**  
   Authentication, role-based access control, and rate limiting are enforced through NestJS Guards — reusable classes that run before route handlers. Guards like `JwtAuthGuard`, `RolesGuard`, and `ThrottlerGuard` encapsulate access-control strategies and can be applied per-route or globally.

5. **Repository Pattern (via Prisma)**  
   Prisma ORM acts as the data access layer, abstracting raw SQL behind a type-safe query API. Services never write SQL directly — they call Prisma's generated client methods, which makes the data layer swappable and testable.

6. **Observer Pattern (Event-Driven)**  
   Real-time features (notifications, live comments, messaging) use Socket.io through NestJS WebSocket Gateways. The server emits events to subscribed clients, decoupling the event producer from consumers.

7. **Singleton Pattern**  
   NestJS services are singletons by default within their module scope. A single instance of each service is shared across the application, which avoids redundant database connections and ensures consistent state.

### Request Lifecycle (Flow)

```
Client Request
  → Middleware (helmet, cookie-parser, CORS)
    → Guards (JWT auth, roles, throttle)
      → Pipes (DTO validation via class-validator)
        → Controller (route handler)
          → Service (business logic)
            → Prisma (database query)
          ← Service returns result
        ← Controller sends response
      ← Interceptors (response transform, logging)
    ← Exception Filters (error formatting)
  → Client Response
```


## Backend Technology Stack

Our backend is built on Node.js using the NestJS framework with PostgreSQL as the sole database. NestJS provides a modular, testable architecture out of the box, and its built-in support for TypeScript, dependency injection, guards, interceptors, and decorators maps cleanly to the security and scalability requirements of a streaming platform.

### 1. Core Framework & Database
* **Runtime:** Node.js (LTS).
* **Framework:** NestJS — chosen for its opinionated module system, built-in validation pipes, and native TypeScript support.
* **Database:** PostgreSQL — all application data lives in a single relational database, managed through **Prisma ORM** for type-safe queries, migrations, and seeding.
* **`@nestjs/config`:** Centralized, schema-validated environment configuration.

### 2. Security & Authentication (Module 1)
* **`argon2`:** Password hashing algorithm (PHC winner). Superior resistance to GPU/ASIC brute-force compared to bcrypt.
* **`@nestjs/jwt`:** JWT-based authentication with access/refresh token strategy delivered via `httpOnly` secure cookies to prevent XSS token theft.
* **`@nestjs/passport` + `passport-google-oauth20`:** Google OAuth 2.0 social login integration.
* **`@nestjs/throttler`:** Rate limiting on global and auth routes to prevent brute-force and credential-stuffing attacks.
* **`helmet`:** Secure HTTP headers (Clickjacking, MIME-sniffing, XSS mitigation).
* **`class-validator` + `class-transformer`:** DTO-based request validation via NestJS `ValidationPipe` to reject malformed payloads and prevent injection.
* **Google reCAPTCHA:** Server-side CAPTCHA verification on registration to block automated abuse.
* **`@nestjs-modules/mailer` + `nodemailer`:** Automated email workflows for account verification, password reset, and recovery.

### 3. Followers & Social Graph (Module 3)
* **PostgreSQL (Prisma):** Relational follow/unfollow tables, follower/following lists, and indexed queries for "Suggested Users" discovery.
* **`@nestjs/websockets` + `socket.io`:** Real-time follow/unfollow events and automatic feed refresh triggers.
* **Blocking Logic (Prisma):** User blocking/unblocking with relational constraints and a managed "Blocked Users" list.

### 4. Media Processing & Streaming (Modules 2, 4, 5)
* **`multer` (via `@nestjs/platform-express`):** Multipart file uploads for audio and images.
* **`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`:** Object storage for audio files and presigned streaming URLs to offload bandwidth from the Node.js process.
* **`fluent-ffmpeg` + `music-metadata`:** Audio transcoding and ID3 metadata extraction for processing-state management.
* **`nanoid`:** Generates unguessable secret tokens for private "link-only" track access.

### 5. Engagement & Social Interactions (Module 6)
* **PostgreSQL (Prisma):** Likes, Reposts, and engagement lists with unique constraints to prevent duplicates.
* **Timestamped Comments (Prisma):** Comments stored with second-offset data for waveform-synced display.
* **`socket.io`:** Real-time broadcast of engagement events (likes, reposts, new comments).

### 6. Sets & Playlists (Module 7)
* **PostgreSQL (Prisma):** Playlist CRUD with ordered join tables for drag-and-drop track reordering.
* **`nanoid`:** Secret tokens for private/shareable playlist links.
* **Embed Support:** Iframe embed URL generation backed by playlist identifiers and secret tokens.

### 7. Real-Time Interactions & Discovery (Modules 8, 9, 10)
* **`@nestjs/websockets` + `socket.io`:** Bidirectional WebSocket gateway for 1-to-1 direct messaging and live UI updates.
* **`firebase-admin`:** Push notifications bridged to the cross-platform mobile app.
* **PostgreSQL Full-Text Search:** Keyword-based global search across Tracks, Users, and Playlists without external search infrastructure.
* **Slug Resolver:** Indexed unique slugs to resolve human-readable permalinks into internal resource IDs.

### 8. Moderation & Admin Dashboard (Module 11)
* **PostgreSQL (Prisma):** Moderation reports, account status flags, admin action audit logs.
* **Role-Based Access Control (NestJS Guards):** `@Roles()` decorator with a custom RBAC guard restricts admin-only endpoints.

### 9. Monetization (Module 12)
* **`stripe`:** Mock payment processing (Stripe Test Mode) for subscription lifecycles.
* **PostgreSQL Subscription Management (Prisma):** User plan tiers, usage limits, and paywall enforcement.
* **Tier-Based Access Guard:** Custom NestJS guard enforcing Premium feature permissions.
* **S3 Presigned Download URLs:** Mock offline listening via temporary download links for premium users.


## Software Process & Quality Assurance
* **Version Control:** GitHub
* **Task Management:** ClickUp
* **Testing:** Jest (NestJS built-in) with >95% unit test coverage.
* **API Documentation:** `@nestjs/swagger` for auto-generated OpenAPI / Swagger docs from decorators.
* **Code Quality:** ESLint + Prettier (NestJS default config).
* **Logging:** NestJS built-in `Logger` service.
* **API Client:** Postman collection for all endpoints.


## Project Structure (Backend)

The project uses the **module-per-feature** layout, which is the standard NestJS convention and how production NestJS codebases are organized.

```
Backend/
├── prisma/                     # Prisma schema, migrations, seed
├── src/
│   ├── config/                 # Environment & app configuration
│   ├── prisma/                 # PrismaService (database connection provider)
│   ├── common/                 # Shared decorators, guards, filters, pipes, utils
│   ├── auth/                   # Module 1 — Registration, login, OAuth, JWT
│   ├── users/                  # Modules 2 & 3 — Profile, followers, blocking
│   ├── tracks/                 # Modules 4 & 5 — Audio upload, playback, likes, reposts
│   ├── comments/               # Module 6 — Timestamped waveform comments
│   ├── playlists/              # Module 7 — Sets, track ordering, secret tokens
│   ├── feed/                   # Module 8 — Activity feed, trending
│   ├── search/                 # Module 8 (partial) — Global search, permalink resolve
│   ├── messages/               # Module 9 — 1-to-1 direct messaging
│   ├── notifications/          # Module 10 — Real-time alerts, push notifications
│   ├── admin/                  # Module 11 — Reports, moderation, platform stats
│   └── subscriptions/          # Module 12 — Stripe, premium plans, paywall
├── test/                       # E2E tests
├── uploads/                    # Local file storage (dev only)
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

Each module will follow the NestJS MVC convention internally as development begins (controller, service, module, DTOs).
