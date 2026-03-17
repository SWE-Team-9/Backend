# IQA3 — Full Study & Implementation Plan

> **Part-time schedule:** ~15–20 hours/week (2–3h weekdays, 4–5h weekends)  
> **Total estimate:** ~29 weeks (~7 months) — can compress to ~5–6 months if you know TS/SQL already

---

## PROJECT CONTEXT (Copilot Memory)

> **Read this section first.** It contains the full project description so that any future Copilot session understands exactly what IQA3 is, what it does, and how it's built.

### What is IQA3?

**IQA3** is a social music streaming platform (SoundCloud clone) — a full-stack web application where users can upload, stream, discover, and interact with audio content. Think Spotify meets SoundCloud: user-uploaded tracks, waveform comments, social following, playlists, direct messaging, and premium subscriptions.

### Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Framework | **NestJS** (not Express) | Module system, DI, guards, TypeScript-native, industry standard |
| Database | **PostgreSQL only** (no MongoDB) | Single relational DB for all data, managed via Prisma ORM |
| Language | **TypeScript** | NestJS native language, type safety |
| Architecture | **MVC + Service Layer** | Industry standard, clean separation, testable |
| Auth | **JWT in httpOnly cookies** + Google OAuth | Secure, no localStorage token exposure |
| Current Phase | **Phase 0 — Proposal** | README + folder structure only, no implementation code yet |
| Project Name | **IQA3** | The company/project name used everywhere |

### The 12 Modules — Full Feature Specification

---

#### Module 1: Registration & Authentication (`auth/`)

**Registration:**
- Sign up with email + password (validated: email format, password strength ≥8 chars, matching confirm)
- Google OAuth 2.0 sign-up (one-click via Google account)
- Google reCAPTCHA on registration form to block bots
- Email verification: send verification link on register, account is unverified until clicked
- Display name, age, and gender collected during registration

**Login:**
- Email + password login (argon2 hash comparison)
- Google OAuth login (existing account linked or new account created)
- JWT access token (15min) + refresh token (7d) stored in httpOnly secure cookies
- "Remember Me" option to extend session duration
- Account lockout / rate limiting after repeated failed attempts

**Password Management:**
- "Forgot Password" flow: enter email → receive reset link → set new password (token with expiry)
- "Change Password" for logged-in users (requires current password confirmation)

**Session & Security:**
- Logout: clear cookies, invalidate refresh token
- All auth routes rate-limited via @nestjs/throttler
- Helmet for secure HTTP headers
- CORS configured for frontend origin only

---

#### Module 2: User Profile (`users/`)

**Profile Page:**
- Display: profile picture (avatar), header/banner image, display name, bio/description, location, external links
- Stats shown: number of followers, following, tracks uploaded, total plays
- User's uploaded tracks listed on profile (paginated)
- User's public playlists/sets listed on profile
- User's reposts shown on profile
- User's liked tracks section (if public)

**Profile Editing:**
- Edit display name, bio, location, external links
- Upload/change avatar image (with file size + type validation)
- Upload/change header/banner image
- Profile URL is a human-readable slug (`/username`)

**Account Settings:**
- Change email (with re-verification)
- Change password
- Delete account (soft delete or hard delete with confirmation)
- Privacy settings: toggle profile visibility, toggle likes visibility

---

#### Module 3: Followers & Social Graph (`users/`)

**Following System:**
- Follow / Unfollow any user (toggle)
- Followers list page (paginated) — who follows you
- Following list page (paginated) — who you follow
- Follower/following counts displayed on profile
- Real-time WebSocket event when someone follows/unfollows you
- "Suggested Users" discovery: recommend users based on who your followers follow, or popular users not yet followed

**Blocking:**
- Block a user → they can't see your profile, tracks, or message you
- Unblock a user
- "Blocked Users" list in settings
- Blocking removes existing follow relationship in both directions

---

#### Module 4: Track Upload & Management (`tracks/`)

**Upload:**
- Upload audio file (MP3, WAV, FLAC, OGG — validated by MIME type and extension)
- File size limit (e.g., 100MB for free, 500MB for premium)
- Audio stored in AWS S3 (presigned upload or server-side upload)
- Automatic metadata extraction on upload: duration, bitrate, sample rate (via `music-metadata`)
- Audio transcoding if needed (via `fluent-ffmpeg`) — normalize to a standard format
- Track processing states: `uploading → processing → ready → failed`

**Track Details (set by uploader):**
- Title (required), description, genre (dropdown), tags (comma-separated)
- Track artwork/cover image (upload or default)
- Privacy: Public, Private, or Secret Link (shareable via `nanoid` token — anyone with the link can listen, but it doesn't appear in search/feed)
- Release date (optional — schedule a future release)
- Downloadable toggle: allow or disallow free downloads
- License type selection (All Rights Reserved, Creative Commons variants)

**Track Management:**
- Edit track details after upload
- Delete track (removes from S3, removes all associated likes/reposts/comments)
- View track stats: play count, like count, repost count, comment count
- Track page URL is a human-readable slug (`/username/track-title`)

---

#### Module 5: Track Playback & Engagement (`tracks/`)

**Playback:**
- Stream audio via S3 presigned URL (audio is not served through the Node.js process)
- Play count incremented on play (with basic dedup — don't count rapid replays from same user)
- Continuous playback: track keeps playing while navigating the site (persistent player)
- Queue: up next list, play next, add to queue

**Likes:**
- Like / Unlike a track (toggle)
- "Liked Tracks" list on user profile
- Like count displayed on track
- Real-time like event broadcast via WebSocket

**Reposts:**
- Repost / Un-repost a track to your profile/feed (toggle)
- Repost count displayed on track
- Reposted tracks appear on reposter's profile and in followers' feed
- Real-time repost event broadcast

---

#### Module 6: Timestamped Comments (`comments/`)

**Waveform Comments:**
- Post a comment on a track at a specific timestamp (seconds offset into the audio)
- Comments appear as dots/markers on the waveform at their timestamp position
- Comments list below the waveform, ordered by timestamp or by date posted
- Each comment shows: commenter avatar, display name, comment text, timestamp, time posted

**Comment Management:**
- Edit your own comment
- Delete your own comment
- Track owner can delete any comment on their track
- Admin can delete any comment (moderation)
- Reply to a comment (optional nested thread — 1 level deep)
- Paginated comment list (load more)

**Real-Time:**
- New comments appear in real-time via WebSocket (no page refresh needed)

---

#### Module 7: Playlists / Sets (`playlists/`)

**Playlist CRUD:**
- Create a playlist (title, description, cover image)
- Add tracks to playlist (from any user's public tracks, or your own private tracks)
- Remove tracks from playlist
- Reorder tracks in playlist (drag-and-drop → `position` column in junction table)
- Edit playlist details (title, description, cover image)
- Delete playlist

**Playlist Settings:**
- Privacy: Public, Private, Secret Link (via `nanoid` — shareable URL)
- Collaborative playlists (optional — allow other users to add tracks)

**Playlist Page:**
- Playlist cover image, title, creator, description, total duration, track count
- Track list with play buttons, track artwork, title, artist, duration
- "Play All" button, "Shuffle" button
- Embed support: generate an iframe embed URL for external sites

---

#### Module 8: Activity Feed & Discovery (`feed/` + `search/`)

**Activity Feed (Home Page):**
- Feed shows activity from users you follow: new uploads, reposts, likes (configurable)
- Feed items ordered reverse-chronologically
- Each item shows: actor (who did it), action (uploaded/reposted/liked), target (the track), timestamp
- Paginated feed (infinite scroll / load more)
- "Trending" section: tracks with most plays/likes/reposts in the last 24h/7d

**Global Search:**
- Search bar: keyword search across Tracks, Users, and Playlists simultaneously
- Search results grouped by type (Tracks tab, Users tab, Playlists tab)
- Filters: genre, duration range, date uploaded, sort by (relevance, date, plays)
- Implemented via PostgreSQL full-text search (`tsvector`, `tsquery`)
- Paginated search results

**Permalink / Slug Resolution:**
- Every user, track, and playlist has a unique slug URL
- `/:username` → user profile
- `/:username/:trackSlug` → track page
- `/:username/sets/:playlistSlug` → playlist page
- Slug resolver service: takes a slug, returns the internal resource ID

---

#### Module 9: Direct Messages (`messages/`)

**1-to-1 Messaging:**
- Send a direct message to any user (unless blocked)
- Conversation thread view: list of messages between you and another user, ordered chronologically
- Conversations list: all your open conversations, sorted by most recent message
- Real-time delivery via WebSocket (Socket.io) — messages appear instantly without refresh
- REST API fallback: load message history via paginated GET endpoint

**Message Features:**
- Text messages (with basic input sanitization)
- Read receipts: "seen" indicator when recipient opens the conversation
- Unread count badge on messages icon
- Delete a message (for yourself only — soft delete)
- Optional: send a track link as a message (renders inline player)

---

#### Module 10: Notifications (`notifications/`)

**Notification Types:**
- Someone followed you
- Someone liked your track
- Someone reposted your track
- Someone commented on your track
- Someone sent you a direct message
- Admin action on your content (track removed, warning issued)

**Notification Behavior:**
- Notifications list page (paginated, reverse-chronological)
- Each notification: icon, actor avatar, action text, target link, timestamp, read/unread state
- Mark individual notification as read
- "Mark all as read" button
- Unread count badge on notification bell icon
- Real-time delivery: new notifications appear instantly via WebSocket
- Push notifications to mobile via `firebase-admin` (FCM)
- Optional: email notification digest (daily/weekly summary)

---

#### Module 11: Admin & Moderation (`admin/`)

**Report System:**
- Any user can report a track, comment, or user (select reason: spam, abuse, copyright, etc.)
- Report stored with: reporter, reported item, reason, status (pending/reviewed/resolved), timestamp
- Admin dashboard: list all pending reports, review, take action

**Admin Actions:**
- Remove a track (copyright violation, ToS breach)
- Remove a comment
- Warn a user (send warning notification)
- Suspend a user (temporary ban — can't login for X days)
- Ban a user (permanent — account disabled)
- Admin action audit log: every admin action recorded with admin ID, action, target, timestamp

**Platform Stats (Admin Dashboard API):**
- Total users (active, suspended, banned)
- Total tracks uploaded
- Total streams/plays
- Total storage used
- New signups over time (daily/weekly/monthly)
- Most reported users/tracks

**Access Control:**
- All admin endpoints protected by `RolesGuard` requiring `ADMIN` role
- Admin role assigned manually in database or via a super-admin endpoint

---

#### Module 12: Subscriptions & Monetization (`subscriptions/`)

**Plans:**
- Free tier: limited uploads (e.g., 3 hours total), no offline download, standard audio quality
- Premium tier: unlimited uploads, offline download, high-quality audio, priority support, no ads (if ads exist)

**Stripe Integration (Test Mode):**
- Create Stripe customer on user registration
- Subscription checkout: redirect to Stripe Checkout or use Stripe Elements
- Handle Stripe webhooks: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- Subscription status synced to database: `active`, `past_due`, `canceled`, `expired`
- Cancel subscription (at period end — access continues until billing cycle ends)
- Resubscribe / upgrade plan

**Paywall Enforcement:**
- `SubscriptionGuard`: custom NestJS guard that checks user's plan tier before allowing access
- Premium-only features gated: offline downloads (S3 presigned download URLs), extended upload limits, high-quality streaming
- Upload limit enforcement: check total uploaded duration against plan limits before allowing new upload

**Mock Offline Download:**
- Premium users can request a temporary download link (presigned S3 URL with short expiry)
- Download count tracked per track

---

### Project Structure

```
Backend/
├── prisma/                     # Prisma schema, migrations, seed
├── src/
│   ├── config/                 # Environment & app configuration
│   ├── prisma/                 # PrismaService (database connection provider)
│   ├── common/                 # Shared decorators, guards, filters, pipes, utils
│   ├── auth/                   # Module 1
│   ├── users/                  # Modules 2 & 3
│   ├── tracks/                 # Modules 4 & 5
│   ├── comments/               # Module 6
│   ├── playlists/              # Module 7
│   ├── feed/                   # Module 8
│   ├── search/                 # Module 8 (partial)
│   ├── messages/               # Module 9
│   ├── notifications/          # Module 10
│   ├── admin/                  # Module 11
│   └── subscriptions/          # Module 12
├── test/                       # E2E tests
├── uploads/                    # Local file storage (dev only)
├── .env.example
└── package.json
```

### Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (LTS) |
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | argon2, @nestjs/jwt, passport-jwt, passport-google-oauth20 |
| Validation | class-validator + class-transformer |
| Rate Limiting | @nestjs/throttler |
| File Upload | multer (@nestjs/platform-express) |
| Storage | AWS S3 (@aws-sdk/client-s3) |
| Audio | fluent-ffmpeg, music-metadata |
| WebSockets | @nestjs/websockets + socket.io |
| Push | firebase-admin (FCM) |
| Payments | Stripe (test mode) |
| Email | @nestjs-modules/mailer + nodemailer |
| API Docs | @nestjs/swagger |
| Testing | Jest |
| Security | helmet, CORS, httpOnly cookies, reCAPTCHA |

### Architecture: 7 Design Patterns

1. **MVC** — Controllers → Services → Prisma (thin controllers, fat services)
2. **Dependency Injection** — NestJS IoC container, constructor injection
3. **DTO** — class-validator decorators on every request body
4. **Guard / Strategy** — JwtAuthGuard, RolesGuard, ThrottlerGuard, SubscriptionGuard
5. **Repository** — Prisma ORM as the data access layer
6. **Observer** — Socket.io WebSocket events (pub/sub for real-time features)
7. **Singleton** — NestJS services are singletons by default

### Request Lifecycle

```
Client → Middleware (helmet, CORS, cookies) → Guards (auth, roles, throttle)
  → Pipes (DTO validation) → Controller → Service → Prisma → DB
  → Response ← Interceptors (transform) ← Exception Filters (errors) ← Client
```

---

### Original Course Specification (Full Document)

> Everything below in this section is the raw project specification from the course. It defines requirements, team roles, deliverables, phases, and constraints that the IQA3 project must follow.

---

#### Course Objectives

1. **Software process tools:**
   - Task Management Tool
   - Version Control Tool (GitHub)
   - Documentation Tools: API Documentation + Functional (code) Documentation

2. **Concepts:**
   - Back-end, front-end architecture
   - Design patterns (e.g., MVC)
   - Unit Testing
   - RESTful API
   - Using a well-known software engineering model (Incremental/Sprints recommended)

3. **Implementing:**
   - Learning how to use package managers
   - Implementing and consuming a RESTful API
   - Unit Testing
   - Using recent technologies and appropriate stacks
   - Using a unified code style for the back-end and another (or the same) for the front-end

4. **Teamwork Skills:**
   - Designing and Managing Software Processes
   - Dealing with large teams
   - Separation of responsibilities & smooth integration

---

#### Team Members and Positions

- The team leader is also DevOps or Testing teams ONLY.
- Extra team members join the frontend or cross-platform team.

1. **Team Leader**
   - Manage duties and tasks
   - Mainly responsible for delivering the project deployed, integrated, and completely running
   - Deadlines determination and announcements (early enough for integration and testing)
   - Main communicator with TAs
   - Communication with other sub-team leaders
   - Construct and manage a smooth and formal communication channel

2. **DevOps Team [1 member]**
   - Use cloud or HaaS (Hardware as services)
   - Very quick deployments
   - Manage Linux-based systems (logs, remote access, automation, scripting)
   - Set up monitoring and automation tools (e.g., Jenkins, Travis CI, GitHub Actions)
   - With team leader, make deployment and process decisions
   - Auto-scaling (optional), Kubernetes (optional), Docker (optional but recommended)

3. **Back-end Team [4 members]** — Sub-Team Leader + Engineers
   - Construct a complete requests collection with API Client (e.g., Postman)
   - Unit testing with coverage above 95%
   - Auto-generate documentation for REST APIs and source code
   - Authentication and Authorization for applicable API requests
   - Design and implement database system (Migrations and Seeds for easy deployment)
   - Deliver ER diagram and API documentation
   - Software Design (Requests Design) + Integration
   - Each member should implement one large module or two medium modules

4. **Front-end Team [5 members]** — Sub-Team Leader + Engineers
   - Unit testing with coverage above 95%
   - Responsive (tested on various screen sizes)
   - AJAX requests whenever possible
   - Mock services to mimic back-end responses (dependency injection, global config toggle)
   - Each member: 5 mid-level pages with all relevant services

5. **Testing Team [2 members]** — Sub-Team Leader + Engineers
   - E2E testing: 90% coverage for web, 90% for Android/Cross Platform
   - Stress testing

6. **Cross Platform Team [5 members]** — Sub-Team Leader + Engineers
   - Unit testing with coverage above 95%
   - Must work on Android + at least one other platform (desktop, iOS, or web)

**For all members:**
- Submit weekly progress report to team leader
- Update task states
- Push code periodically (no major pushes)
- Use tools chosen at Phase 0
- Mention at least 3 used Design Patterns
- Understand the project's architecture and how work integrates between sub-teams
- Documentation: all used tools, license allowance, acknowledge external code

---

#### Project Phases

**Phase 0 [Proposal] (Week 3):**
- Used tools & language (all teams: FE, BE, DB, etc.)
- Team members, positions, and company name
- Preparing repo & Task Management Tool
- Google Drive link with deliverables (uploaded each Saturday before 8pm, 11:59pm deadline)
- Keep original deliverables when revising (V1, V2, etc.)

**Phase 1 [Proposal] (Week 5) [5%]:**
- Task division for all tasks among all members (use task management tool)
- Code style for each team
- System Design (with help of Open APIs)
- [BE] ER Diagram, API documentation
- [FE] [Android] pages choices and assignments

**Phase 2 (Week 7) [10%]:**
- 20% of the project finished (each member finishes part of assigned position tasks)
- Progress report per member + combined team progress report

**Phase 3 (Week 10) [25%]:**
- 50% of the project finished
- Prototype should be deployed and running

**Phase 4 (Week 13) [60%]:**
- 100% of the project finished
- All deliverables ready
- Each sub-team delivers 1 version of each diagram taught in lectures (e.g., use-case diagram)
- Presentation with working prototype
- Version history sheet (versions, releases, all member contributions)

---

#### SoundCloud Clone — Modules & Features (Original Spec)

**Module 1: Authentication & User Management**
- Registration & Verification: Email-based registration with CAPTCHA and automated verification/resend workflows
- Account Recovery: Self-service password reset and email update triggers
- Social Identity: One-click Google/social login integration
- OAuth Flow: Secure authorization using SoundCloud's current standard
- JWT & Refresh Tokens: Industry-standard secure token handling for persistent sessions

**Module 2: User Profile & Social Identity**
- Profile Customization: Dynamic bio, location, and "Favorite Genres" tagging
- Account Tiers: Logic to distinguish between Artist (uploader) and Listener roles
- Visual Assets: Management of avatars and high-resolution cover photos
- Web Profiles: Ability to link external social profiles (Instagram, Twitter, personal website)
- Privacy Control: Public vs. private profile visibility settings

**Module 3: Followers & Social Graph**
- Relationship Management: Real-time follow/unfollow system with automatic feed updates
- Network Lists: Dedicated views for Followers, Following, and "Suggested Users"
- Moderation: User blocking and unblocking logic with a managed "Blocked Users" list

**Module 4: Audio Upload & Track Management**
- Multi-Format Support: Upload and storage for MP3, WAV, and high-bitrate audio
- Metadata Engine: Title, genre, descriptive tags, and release date management
- Transcoding Logic: Automatic handling of track state (Processing vs. Finished)
- Track Visibility: Toggle tracks between Public (searchable) and Private (link-only)
- Waveform Generation: Visual representation of audio peaks (Mock or generated)

**Module 5: Playback & Streaming Engine**
- High-Fidelity Streaming: Core player with Play, Pause, Seek, and Volume control
- Playback Accessibility: Logic to handle Playable, Preview, or Blocked states (Region or Tier based)
- User History: "Recently Played" and "Listening History" tracking
- Responsive Player: Sticky/persistent player UI that works on Web and Mobile

**Module 6: Engagement & Social Interactions**
- Favorites & Likes: One-tap liking of tracks with a global "Favoriters" count
- Reposts: Social sharing of tracks to a user's own feed/profile
- Timestamped Comments: Ability to leave comments at specific seconds in the audio waveform
- Engagement Lists: View list of users who Liked or Reposted a specific track

**Module 7: Sets & Playlists**
- Playlist CRUD: Create, edit, and delete collections of tracks (Sets)
- Track Sequencing: Drag-and-drop reordering and "Add/Remove" functionality
- Playlist Privacy: Secret vs. Public playlists with unique shareable "Secret Tokens"
- Embed Support: Generate simple iframe codes for sharing playlists externally

**Module 8: Feed, Search & Discovery**
- Stream/Activity Feed: Chronological feed of new tracks from followed artists
- Resource Resolver: Feature to resolve standard permalinks (URLs) into internal resource IDs
- Global Search: Advanced search across Tracks, Users, and Playlists using keyword matching
- Trending & Charts: Discovery logic based on recent play counts and engagement velocity

**Module 9: Messaging & Track Sharing**
- 1-to-1 Direct Messaging: Private text communication between users
- In-Chat Previews: Embeddable track/playlist cards within the message thread
- Status Tracking: Unread message counts and message-specific blocking rules

**Module 10: Real-Time Notifications**
- Activity Triggers: Instant alerts for new Followers, Likes, Reposts, and Comments
- State Management: Global "Mark as Read" and unread notification counter
- Push Notifications: Mobile-ready alerts for time-sensitive social actions

**Module 11: Moderation & Admin Dashboard**
- Report System: User-facing flags for Copyright or Inappropriate Content
- Admin Panel: Content management tools to hide/remove tracks and suspend accounts
- Platform Health: Analytics dashboard (Total active users, play-through rates, storage usage)

**Module 12: Premium Subscription (Pro/Go+)**
- Paywall Logic: Enforce upload limits (e.g., 3 tracks for Free vs. Unlimited for Pro)
- Stripe Integration: Mocked payment processing for subscription lifecycles
- Premium Perks: Ad-free experience and mock "Offline Listening" (downloading) capabilities

---

#### Feature Q&A (Course Clarifications)

**1. How does authentication work?**
- Register with email + password, CAPTCHA required, automated confirmation email
- Login via email/password or Google social login (only one social platform required)
- Account recovery via password reset to registered email

**2. What information can users add to profiles?**
- Display name, bio, location
- Account type: Artist (creator) or Listener (consumer)
- Profile picture + high-resolution cover photo
- Public or Private profile visibility

**3. How do followers and the social graph work?**
- Follow/unfollow to see latest uploads in feed
- Dedicated "Followers" and "Following" lists
- Blocking system with "Blocked Users" list

**4. How does audio upload and management work?**
- Upload MP3 and WAV
- Must provide metadata: Title, Genre, Description, Tags
- Tracks: Public (searchable) or Private (link-only)
- Validate track duration, generate basic waveform visualization

**5. How does audio playback and streaming work?**
- Stream with Play, Pause, Seek controls
- Track playback progress, maintain "Recently Played" history
- Persistent player across web and mobile

**6. How do social interactions on tracks work?**
- Like/favorite and Repost to profile feed
- Timestamped comments at specific playback points
- Engagement metrics visible on each track (play counts, likes)

**7. How do playlists (Sets) work?**
- Create, update, delete custom playlists
- Add, remove, reorder tracks
- Share via unique links with privacy settings (Public/Private)

**8. How does the Feed and Discovery system work?**
- Activity Feed: new uploads, likes, reposts from followed users (chronological)
- Global search by title/tags or user profiles
- "Trending" section based on recent engagement and plays

**9. How does messaging work?**
- 1-to-1 private text messages
- Share track/playlist links within messages
- Unread message counts, block specific users from messaging

**10. What notifications do users receive?**
- Real-time for: likes, comments, reposts, followers, messages
- Mark as read, unseen notification count

**11. What is the role of the Admin Panel?**
- Monitor reports, remove inappropriate tracks/comments
- Platform analytics: total users, tracks, aggregate plays

**12. How do Premium plans and payments work?**
- Stripe Test Mode (mock payments)
- Free Plan: 3 track uploads, 2 playlists, standard streaming
- Premium Plan: unlimited uploads, unlimited playlists, mock "Offline Listening"

---

#### Implementation Constraints (Course Specific)

- **Groups:** No group chats; only 1-to-1 Direct Messaging
- **Reactions:** Standard "Likes" and timestamped comments only
- **Replies:** Comment replies restricted to one level deep only
- **Message Reactions:** Not implemented
- **API Format:** RESTful API, JSON format for requests and responses
- **Authentication:** Token-based authentication (JWT)
- **Docker:** Optional but recommended
- **Database Seeder:** Must have a seeder with logical data for demos + a clean seeder with only fundamental data and one user
- **Code Style:** Must be specific (e.g., "NestJS coding style" not just "TypeScript")
- **Functional Documentation:** Required from BE, FE, and Cross-platform teams
- **External Code:** Must be acknowledged in source code, README.md, and final documentation (unacknowledged copied code = cheating)
- **Tool Changes:** Require TA confirmation with strong reason, must not affect other members

---

#### General Q&A (Course Answers)

- **Cross-platform testing:** Any framework compiling to Android + one other client (iOS/Browser/Desktop)
- **"System Design" in Phase 1:** Complete API documentation, main modules with all features, architecture & design patterns, naming conventions, DB models, third-party libraries, GitHub workflow (branch naming, PR process)
- **Phase discussions:** Phase 0-1: team leader + sub-team leaders. Phase 2+: all members
- **Non-working members:** Team leader must report early; repeated issues → 0 grade or removal
- **Prototype demos (50%, 100%):** Seeder with logical data to show all functionalities; separate clean seed for fresh version
- **Monitoring (DevOps):** Internal (resource usage, email alert on threshold) + External (uptime, internet disconnection)
- **API documentation before coding:** Use SoundCloud/LinkedIn docs as reference, document relevant endpoints ASAP for integration, later modifications kept minimal (in our case we used the SoundCloud Web API as reference)

---
> **END OF PROJECT CONTEXT** — Everything below is the study plan.

---

## Your Background (What You Already Know)

- **JavaScript** — comfortable
- **Express.js** — comfortable (you've built APIs before)
- **MySQL** — comfortable (relational DBs, SQL queries, joins)
- **Status:** Uni student, part-time availability (~12–15 hrs/week)
- **Timeline:** 10 weeks total for the entire project

**What this means:** You can skip SQL fundamentals, REST basics, JS, and Express. The MySQL → PostgreSQL jump is trivial (Prisma abstracts it). The main learning curve is Express → NestJS (decorators, modules, DI) and writing TypeScript.

---

## What You CANNOT Skip (Must Study Upfront)

| Topic | Why | Time |
|-------|-----|------|
| **TypeScript** (decorators, generics, classes) | NestJS is 100% TypeScript — every file uses decorators, interfaces, and types. Without this, you'll fight the language. | ~11h |
| **NestJS module system** (modules, controllers, services, DI) | Fundamentally different from Express. Everything is decorators + DI. | ~13h |
| **Prisma** (schema, migrations, queries) | Your entire data layer. Replaces raw MySQL queries. | ~8h |
| **JWT + Guards in NestJS** | Every protected route depends on these. Can't defer. | ~14h |

## What You CAN Safely Learn On-The-Fly

- Socket.io / WebSockets in NestJS (Week 8 — one gateway file, great docs)
- Stripe API (Week 9 — excellent docs, test mode is forgiving)
- Firebase push notifications (`firebase-admin` — straightforward)
- `fluent-ffmpeg` / `music-metadata` (just npm README examples)
- PostgreSQL full-text search (a few queries to learn when you reach search module)
- `@nestjs/swagger` (decorator-based, learn in 30 minutes)
- `@nestjs-modules/mailer` (simple SMTP setup)

---

## 10-Week Plan (Part-Time, ~12–15 hrs/week)

> **Strategy:** 2 weeks of focused study, then build while learning the rest on-the-fly.

---

### Week 1: TypeScript (MUST-DO before anything)

You know JS, so this is about learning what TS adds on top. Focus on what NestJS uses heavily.

| Day | Topic | Time | Resource |
|-----|-------|------|----------|
| D1 | Types, interfaces, enums, union types | 2h | [TS Handbook — Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) |
| D2 | Classes + access modifiers (`public`/`private`/`protected`) | 2h | [TS Handbook — Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) |
| D3 | Generics (functions, classes, constraints) | 2h | [TS Handbook — Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) |
| D4 | **Decorators** — class, method, property, parameter decorators (NestJS is BUILT on these) | 2h | [TS Handbook — Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) |
| D5 | `async`/`await` with types, `Promise<T>`, error handling | 1h | [MDN — async/await](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Promises) |
| D6 | **Practice:** rewrite a small Express route handler in TypeScript (types, interfaces, async) | 2h | Self-practice |

**Total: ~11h**  
**Checkpoint:** You can read and write TS with decorators and generics. Skip if you already can.

---

### Week 2: NestJS Core + Prisma + Validation + Config

| Day | Topic | Time | Resource |
|-----|-------|------|----------|
| D1 | NestJS CLI, scaffold project (`nest new`), explore `main.ts`, `app.module.ts` | 2h | [NestJS — First Steps](https://docs.nestjs.com/first-steps) |
| D2 | Modules, Controllers (`@Get`, `@Post`, `@Param`, `@Body`), Services (`@Injectable`), DI | 3h | [NestJS — Controllers](https://docs.nestjs.com/controllers) + [Providers](https://docs.nestjs.com/providers) |
| D3 | Prisma: install, `schema.prisma`, define `User` + `Track` models, `prisma migrate dev` | 3h | [Prisma Quickstart](https://www.prisma.io/docs/getting-started/quickstart) |
| D4 | `PrismaService` provider, inject into service, wire up real CRUD | 2h | [NestJS Prisma Recipe](https://docs.nestjs.com/recipes/prisma) |
| D5 | DTOs + `class-validator` + global `ValidationPipe` (`whitelist: true`, `transform: true`) | 2h | [NestJS — Validation](https://docs.nestjs.com/techniques/validation) |
| D6 | `@nestjs/config` + `.env` loading, Helmet, CORS, cookie-parser in `main.ts` | 1h | [NestJS — Configuration](https://docs.nestjs.com/techniques/configuration) |

**Total: ~13h**  
**Checkpoint:** Running NestJS app with Prisma, one working `users/` module with real DB CRUD, DTO validation, config loaded from `.env`.

**Key resource:** [NestJS Docs — Overview section (read First Steps through Modules)](https://docs.nestjs.com/)

---

### Week 3: Auth Module — JWT, Guards, OAuth

This is the hardest and most important module. Everything else depends on it.

| Day | Topic | Time | Resource |
|-----|-------|------|----------|
| D1 | `argon2` hashing — register endpoint (hash password), login endpoint (verify hash) | 3h | argon2 npm README |
| D2 | `@nestjs/jwt` + `passport-jwt` strategy — generate access token (15min) + refresh token (7d), httpOnly cookies | 3h | [NestJS — Authentication](https://docs.nestjs.com/security/authentication) |
| D3 | `JwtAuthGuard` — protect routes, `@Public()` decorator for open routes | 2h | [NestJS — Authorization](https://docs.nestjs.com/security/authorization) |
| D4 | Refresh token flow (`/auth/refresh`), logout (clear cookies, invalidate token) | 2h | Same docs |
| D5 | `RolesGuard` + `@Roles()` decorator, `@nestjs/throttler` rate limiting | 2h | [NestJS — Rate Limiting](https://docs.nestjs.com/security/rate-limiting) |
| D6 | Google OAuth (`passport-google-oauth20`) — strategy + callback, link/create account | 2h | [Passport Google Strategy](https://www.passportjs.org/packages/passport-google-oauth20/) |

**Total: ~14h**  
**Checkpoint:** Full auth flow — register, login, JWT in cookies, refresh, logout, Google OAuth, role-based guards, rate limiting.

**Defer to later (Week 7):** Email verification + password reset (requires mailer setup — not blocking).

---

### Week 4: Full Prisma Schema + Users Module (Modules 2 & 3)

| Day | What to Build | Time |
|-----|--------------|------|
| D1–2 | **Full Prisma schema** — define ALL models for all 12 modules (User, Track, Comment, Playlist, PlaylistTrack, Follow, Block, Like, Repost, Message, Notification, Report, AdminLog, Subscription, Activity). Run migrations. | 5h |
| D3 | **Prisma seed** — `prisma/seed.ts` with test users, tracks, follows for development | 2h |
| D4 | **User profile** — CRUD (get profile, update bio/location/links), avatar upload via multer (local storage first) | 3h |
| D5–6 | **Follow/Unfollow** — junction table, followers list, following list, follower/following counts. **Block/Unblock** — removes follow relationship, restricts access. **Suggested Users** — basic query. | 4h |

**Total: ~14h**  
**Checkpoint:** Complete DB schema, seed data, user profiles, social graph (follow/block).

---

### Week 5: Tracks Module (Modules 4 & 5)

| Day | What to Build | Time |
|-----|--------------|------|
| D1 | Multer file upload (MP3, WAV validation), `music-metadata` extraction (duration, bitrate) | 3h |
| D2 | AWS S3 upload (`@aws-sdk/client-s3`), presigned streaming URL generation | 3h |
| D3 | Track CRUD — create (with metadata), get, update details, delete (cascade S3 + DB) | 3h |
| D4 | Track privacy — Public / Private / Secret Link (`nanoid` token), processing states | 2h |
| D5 | **Like/Unlike** toggle, **Repost/Un-repost** toggle, engagement counts, play count increment (with dedup) | 3h |

**Total: ~14h**  
**Checkpoint:** Full track pipeline — upload → S3 → stream → like → repost. Track management with privacy controls.

---

### Week 6: Comments + Playlists (Modules 6 & 7)

| Day | What to Build | Time |
|-----|--------------|------|
| D1 | **Comments** — Create comment with `timestampSeconds`, edit, delete (own + track owner + admin) | 3h |
| D2 | **Comment replies** (1-level deep), paginated comment list per track | 2h |
| D3 | **Playlist CRUD** — create, edit, delete, cover image | 2h |
| D4 | **Playlist tracks** — add/remove tracks, `position` column for ordering, reorder endpoint | 3h |
| D5 | Playlist privacy (Public/Private/Secret via `nanoid`), embed URL generation | 2h |

**Total: ~12h**  
**Checkpoint:** Timestamped comments with replies, playlists with drag-and-drop ordering and secret links.

---

### Week 7: Feed + Search + Email Flows (Module 8 + deferred auth)

| Day | What to Build | Time |
|-----|--------------|------|
| D1 | **Activity Feed** — Activity model (upload, like, repost, comment, follow), feed from followed users, pagination | 3h |
| D2 | **Trending** — tracks sorted by plays/likes/reposts in last 24h/7d | 2h |
| D3 | **Global Search** — PostgreSQL full-text search (`tsvector`/`tsquery`) across users, tracks, playlists | 3h |
| D4 | **Slug Resolver** — permalink resolution (`/:username`, `/:username/:trackSlug`) | 1h |
| D5 | **Email verification** — `@nestjs-modules/mailer` setup, send verification token on register, verify endpoint | 2h |
| D6 | **Password reset** — forgot password (send reset link), reset endpoint with token expiry | 2h |

**Total: ~13h**  
**Checkpoint:** Activity feed, trending, search, slug resolution, email verification, password reset all working.

---

### Week 8: Messages + Notifications + Admin (Modules 9, 10, 11)

These are simpler modules — mostly CRUD plus one WebSocket gateway.

| Day | What to Build | Time |
|-----|--------------|------|
| D1 | **Messages** — Socket.io WebSocket gateway (`@nestjs/websockets`), 1-to-1 chat rooms, auth handshake | 3h |
| D2 | **Messages** — Message persistence in DB, REST fallback for history, read receipts, unread count | 3h |
| D3 | **Notifications** — Notification model (type, actor, target, read/unread), create on events (follow, like, repost, comment, message) | 2h |
| D4 | **Notifications** — WebSocket broadcast for real-time delivery, mark-as-read, mark-all-as-read, unread count | 2h |
| D5 | **Admin** — Report model (user reports track/user/comment), admin list/resolve reports, audit log | 2h |
| D6 | **Admin** — Platform stats (total users, tracks, plays, storage), ban/suspend user, remove content, `RolesGuard` on all admin routes | 2h |

**Total: ~14h**  
**Checkpoint:** Real-time DMs, live notifications, admin moderation panel — all working.

---

### Week 9: Subscriptions + Swagger + Polish (Module 12)

| Day | What to Build | Time |
|-----|--------------|------|
| D1 | **Stripe** — test mode setup, create customer on register, subscription plans (Free/Premium) | 3h |
| D2 | **Stripe webhooks** — `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, sync to DB | 2h |
| D3 | **SubscriptionGuard** — check plan tier, gate premium features (upload limits, offline download) | 2h |
| D4 | **Swagger** — `@nestjs/swagger` decorators on ALL endpoints (`@ApiTags`, `@ApiOperation`, `@ApiResponse`) | 3h |
| D5 | **Exception filter** cleanup — consistent error JSON format across all modules. **Response interceptor** — wrap all responses in `{ status, data }` | 2h |
| D6 | **reCAPTCHA** + **Firebase push** (if not done) — quick additions | 2h |

**Total: ~14h**  
**Checkpoint:** Stripe subscriptions working in test mode, full Swagger docs, clean error handling.

---

### Week 10: Testing + Documentation + Demo

| Day | What to Build | Time |
|-----|--------------|------|
| D1–2 | **Unit tests** — `Test.createTestingModule()`, mock PrismaService, test auth + users + tracks services. Aim for >80% on core services. | 5h |
| D3 | **E2E tests** — Supertest for critical flows: register → login → upload track → like → comment → search | 3h |
| D4 | **Postman collection** — all endpoints organized by module, with environment variables | 2h |
| D5 | **Seed data** — logical seed for demo (users, tracks, follows, playlists, messages) + clean seed (1 user, fundamental data) | 2h |
| D6 | **Final polish** — README update, code cleanup, migration squash, verify everything runs fresh from `git clone` | 2h |

**Total: ~14h**  
**Checkpoint:** Tests passing, Postman collection ready, demo seed works, documentation complete. Project deliverable.

---

## Summary Timeline

```
Week 1     TypeScript (decorators, generics, classes, async)        ~11h
Week 2     NestJS Core + Prisma + DTOs + Config                     ~13h
Week 3     Auth (JWT, guards, roles, throttle, Google OAuth)        ~14h
Week 4     Full Prisma schema + Users (profiles, follow, block)     ~14h
Week 5     Tracks (upload, S3, streaming, likes, reposts)           ~14h
Week 6     Comments + Playlists                                     ~12h
Week 7     Feed + Search + Email flows                              ~13h
Week 8     Messages + Notifications + Admin                         ~14h
Week 9     Subscriptions (Stripe) + Swagger + Polish                ~14h
Week 10    Testing + Postman + Seed + Documentation                 ~14h
──────────────────────────────────────────────────────────────────────
Total: ~133 hours over 10 weeks (~13h/week average)
```

---

## Implementation Order

```
1.  config/ + prisma/       ← Prisma schema, PrismaService, env config          (Week 2)
2.  common/                 ← Guards, filters, pipes, decorators                 (Weeks 2–3)
3.  auth/                   ← Register, login, JWT, OAuth                        (Week 3)
4.  users/                  ← Profile CRUD, follow/unfollow, blocking            (Week 4)
5.  tracks/                 ← Upload, S3, metadata, streaming, likes, reposts    (Week 5)
6.  comments/               ← Timestamped comments on tracks                     (Week 6)
7.  playlists/              ← Sets, ordering, secret sharing links               (Week 6)
8.  feed/                   ← Activity feed, trending                            (Week 7)
9.  search/                 ← Full-text search, slug resolver                    (Week 7)
10. messages/               ← WebSocket DM gateway                               (Week 8)
11. notifications/          ← Real-time alerts + Firebase push                   (Week 8)
12. admin/                  ← Moderation, reports, stats                         (Week 8)
13. subscriptions/          ← Stripe plans, paywall guard                        (Week 9)
```
