# Modules 3–6: Sprint Plan & Team Division

## Current State

- **Prisma schema**: All models exist (UserFollow, UserBlock, Track, TrackFile, TrackLike, TrackRepost, TrackComment, PlayEvent, Genre, Tag, etc.)
- **Implemented**: Auth (Module 1), Users/Profiles (Module 2), OAuth, Mail, Common guards/decorators/filters, Storage service
- **Empty (to build)**: `src/tracks/`, `src/comments/`, `src/feed/` — plus new social controller in `src/users/` and new interactions/player logic

---

## Team Roster & Assignments

| Member | Module(s) | Role | Modules Owned |
|--------|-----------|------|---------------|
| **Dev 1** | Module 3 | Social Graph — Follow System | Follow/Unfollow, Followers/Following lists, Suggested Users |
| **Dev 2** | Module 3 + Module 6 | Social Graph — Blocking & Moderation + Timestamped Comments | Block/Unblock, Blocked Users list, Timestamped Comments (add/get/delete) |
| **Dev 3** | Module 4 | Audio Upload & Track Management | Upload, metadata CRUD, visibility toggle, waveform, transcoding callback, secret token access |
| **Dev 4** | Module 5 | Playback & Streaming Engine | Playback source, access states, play events, history, recently played, resume, queue/session, preview |
| **Dev 5** | Module 6 | Engagement & Social Interactions — Likes & Reposts | Like/Unlike, Repost/Remove Repost, Likers list, Reposters list |

### Why This Split is Fair

| Member | Endpoints | Complexity Notes |
|--------|-----------|-----------------|
| Dev 1 | 5 endpoints | Pagination, suggestion algorithm, follow count updates |
| Dev 2 | 6 endpoints | Block cascades (remove follows on block), comment timestamp validation |
| Dev 3 | 10 endpoints | File upload (multer + S3), ffmpeg transcoding, waveform generation — heaviest infra work |
| Dev 4 | 10 endpoints | Presigned URLs, access-state logic (tier/region), session persistence |
| Dev 5 | 6 endpoints | Simpler CRUD but must handle unique constraints, count aggregation, pagination |

Dev 3 and Dev 4 have more endpoints but everyone on the team should support them during Sprint 1 reviews since those modules touch file I/O and streaming.

---

## Sprint 1 (Week 1–2): Core Backend — Models, Services, Basic Endpoints

> **Goal**: Every module has its NestJS module/controller/service scaffold, DTOs with validation, and all core CRUD endpoints working against the database. Unit tests for services.

---

### Dev 1 — Social Graph: Follow System

| # | Task | Details |
|---|------|---------|
| 1 | Create `src/users/social.controller.ts` and `social.service.ts` | Register under UsersModule. Base route: `/api/v1/social` |
| 2 | Create DTOs: `follow.dto.ts` | Validation for userId param, pagination query (page, limit) |
| 3 | `POST /social/follow/:userId` | Insert into `UserFollow`. Reject self-follow. Check if target blocked requester. Return updated follower count |
| 4 | `DELETE /social/follow/:userId` | Delete from `UserFollow`. 404 if relation doesn't exist |
| 5 | `GET /social/:userId/followers` | Paginated list of followers with display_name, handle, avatar_url |
| 6 | `GET /social/:userId/following` | Paginated list of following with same fields |
| 7 | `GET /social/suggestions` | Return users not yet followed, exclude blocked, limit param. Use shared-genre logic or random fallback |
| 8 | Write unit tests for `social.service.ts` | Mock PrismaService. Test self-follow rejection, block check, pagination |

---

### Dev 2 — Blocking + Timestamped Comments

**Blocking (under Social controller):**

| # | Task | Details |
|---|------|---------|
| 1 | Add block endpoints to `social.controller.ts` and `social.service.ts` | Or create separate `block.service.ts` if preferred |
| 2 | `POST /social/block/:userId` | Insert into `UserBlock`. Auto-delete any existing follow relationships in BOTH directions. Reject self-block |
| 3 | `DELETE /social/block/:userId` | Delete from `UserBlock`. Does NOT restore follows |
| 4 | `GET /social/blocked-users` | Paginated list with display_name, handle, avatar_url, blockedAt |

**Timestamped Comments:**

| # | Task | Details |
|---|------|---------|
| 5 | Create `src/comments/comments.module.ts`, `comments.controller.ts`, `comments.service.ts` | Base route: `/api/v1/interactions/tracks/:trackId/comments` |
| 6 | Create DTOs: `create-comment.dto.ts` | Validate `text` (required, max 500 chars), `timestampSeconds` (required, >= 0, <= track duration) |
| 7 | `POST /interactions/tracks/:trackId/comments` | Insert into `TrackComment` with userId, trackId, text, timestampSeconds |
| 8 | `GET /interactions/tracks/:trackId/comments` | Paginated, ordered by createdAt. Include user info (id, display_name, avatar) |
| 9 | `DELETE /interactions/comments/:commentId` | Only comment owner or admin can delete |
| 10 | Write unit tests for block service + comments service | Test block cascade (follows removed), comment ownership check |

---

### Dev 3 — Track Upload & Management

| # | Task | Details |
|---|------|---------|
| 1 | Create `src/tracks/tracks.module.ts`, `tracks.controller.ts`, `tracks.service.ts` | Base route: `/api/v1/tracks`. Import StorageModule for S3 |
| 2 | Create DTOs: `create-track.dto.ts`, `update-track.dto.ts`, `track-visibility.dto.ts` | Validate title (required, max 100), genre, tags array, releaseDate (ISO), visibility enum |
| 3 | `POST /tracks` (multipart upload) | Use `@UseInterceptors(FileInterceptor)` with multer. Accept MP3/WAV (max 250MB). Upload to S3 via StorageService. Insert Track (status=PROCESSING, visibility=PRIVATE). Insert TrackFile (role=ORIGINAL). Generate secretToken via nanoid |
| 4 | `GET /tracks/:trackId` | Return full track metadata + waveform. Public tracks visible to all; private tracks only to owner or via secret token |
| 5 | `GET /tracks/:trackId/status` | Lightweight status-only response for frontend polling |
| 6 | `PUT /tracks/:trackId` | Owner-only. Update title, genre, tags, releaseDate, description |
| 7 | `DELETE /tracks/:trackId` | Owner or admin. Soft-delete (set deletedAt). Remove S3 files or mark for cleanup |
| 8 | `PATCH /tracks/:trackId/visibility` | Owner-only. Toggle PUBLIC/PRIVATE. Regenerate secretToken if switching to PRIVATE |
| 9 | `GET /users/:userId/tracks` | Paginated. Public tracks for any viewer; all tracks if owner is requesting |
| 10 | `GET /tracks/:trackId/waveform` | Return waveformData array only |
| 11 | `POST /tracks/transcoding/callback` | Internal endpoint (guard with API key or internal-only check). Update track status to FINISHED, store generated file URLs |
| 12 | `GET /tracks/secret/:secretToken` | Resolve private track by nanoid token |
| 13 | Write unit tests for `tracks.service.ts` | Test ownership checks, visibility rules, status transitions |

---

### Dev 4 — Playback & Streaming Engine

| # | Task | Details |
|---|------|---------|
| 1 | Create `src/tracks/player.controller.ts` and `player.service.ts` | Keep under tracks module. Base route: `/api/v1/player` |
| 2 | Create DTOs: `playback-progress.dto.ts`, `player-session.dto.ts` | Validate positionSeconds (>= 0), durationSeconds (> 0), isCompleted (boolean), volume (0-1) |
| 3 | `GET /player/tracks/:trackId/source` | Generate presigned S3 URL for the STREAM file. Check access state (PLAYABLE/PREVIEW/BLOCKED). Return streamUrl + accessState + expiresAt. 409 if PROCESSING |
| 4 | `GET /player/tracks/:trackId/state` | Return access state + reason (e.g. "Premium required", "Region blocked", or null) |
| 5 | `POST /player/tracks/:trackId/progress` | Upsert playback progress for user+track |
| 6 | `POST /player/tracks/:trackId/play` | Insert into PlayEvent. Increment play count (or compute from PlayEvent aggregate) |
| 7 | `GET /player/history/recent` | Paginated recently played tracks, ordered by lastPlayedAt DESC. Distinct tracks |
| 8 | `GET /player/history` | Full listening history with progress snapshots |
| 9 | `DELETE /player/history` | Delete all PlayEvent + progress records for user |
| 10 | `GET /player/tracks/:trackId/resume` | Return last saved positionSeconds for user+track |
| 11 | `GET /player/session` | Return current player state (currentTrack, queue, volume, position, isPlaying) |
| 12 | `PUT /player/session` | Upsert player session state |
| 13 | `GET /player/tracks/:trackId/preview` | Return presigned URL for PREVIEW file role, capped at 30s |
| 14 | Write unit tests for `player.service.ts` | Test access state logic, presigned URL generation, history ordering |

---

### Dev 5 — Likes, Reposts & Engagement Lists

| # | Task | Details |
|---|------|---------|
| 1 | Create `src/tracks/interactions.controller.ts` and `interactions.service.ts` | Keep under tracks module or create a shared interactions module. Base route: `/api/v1/interactions` |
| 2 | Create DTOs: pagination query DTO (reusable) | page, limit with defaults and min/max validation |
| 3 | `POST /interactions/tracks/:trackId/like` | Insert into `TrackLike` (unique constraint handles duplicates). Return updated likesCount |
| 4 | `DELETE /interactions/tracks/:trackId/like` | Delete from `TrackLike`. Return updated likesCount |
| 5 | `POST /interactions/tracks/:trackId/repost` | Insert into `TrackRepost` (unique constraint). Return updated repostsCount |
| 6 | `DELETE /interactions/tracks/:trackId/repost` | Delete from `TrackRepost`. Return updated count |
| 7 | `GET /interactions/tracks/:trackId/likers` | Paginated list of users who liked the track |
| 8 | `GET /interactions/tracks/:trackId/reposters` | Paginated list of users who reposted the track |
| 9 | Write unit tests for `interactions.service.ts` | Test duplicate prevention, count accuracy, pagination |

---

## Sprint 2 (Week 3–4): Advanced Logic, Integration, Edge Cases & Testing

> **Goal**: All business rules enforced, cross-module integration working, E2E tests passing, Swagger docs complete.

---

### Dev 1 — Social Graph: Real-time + Integration

| # | Task | Details |
|---|------|---------|
| 1 | Add WebSocket events for follow/unfollow | Emit `USER_FOLLOWED` / `USER_UNFOLLOWED` via Socket.io gateway so frontend can update feed in real-time |
| 2 | Integrate block checks into follow endpoints | If user A blocks user B mid-session, ensure follow attempts fail immediately |
| 3 | Improve suggestion algorithm | Factor in mutual followers, shared genre preferences from UserProfile.favoriteGenres |
| 4 | Add `isFollowing` and `isFollowedBy` flags to profile responses | When viewing another user's profile, include relationship status |
| 5 | Add follower/following counts to profile response | Aggregate counts on UserProfile or compute on read |
| 6 | Swagger decorators on all social endpoints | `@ApiOperation`, `@ApiResponse`, `@ApiParam`, `@ApiQuery` |
| 7 | E2E tests for follow/unfollow/suggestions | Test full HTTP flow including auth |

---

### Dev 2 — Blocking Cascades + Comments Polish

| # | Task | Details |
|---|------|---------|
| 1 | Block cascade: hide blocked user's tracks from search/feed | Coordinate with Dev 3/Dev 4 — blocked user's content should not appear |
| 2 | Block cascade: prevent blocked users from commenting on your tracks | Check block status in comment creation |
| 3 | Block cascade: prevent messaging blocked users | Coordinate with messaging module (future) — add utility `isBlocked(userA, userB)` in social service and export it |
| 4 | Comment count on track response | Add `commentsCount` to track detail response. Coordinate with Dev 3 |
| 5 | Validate timestampSeconds <= track durationMs | Cross-check against Track record when creating comment |
| 6 | Swagger decorators on all block + comment endpoints | Full API docs |
| 7 | E2E tests for blocking cascades + comments | Test block removes follows, blocked user can't comment, timestamp validation |

---

### Dev 3 — Track Processing Pipeline + Edge Cases

| # | Task | Details |
|---|------|---------|
| 1 | Implement actual transcoding with fluent-ffmpeg | On upload: spawn ffmpeg job to create MP3 stream copy (128kbps), generate waveform peaks array, store as TrackFile entries |
| 2 | Waveform generation | Extract amplitude peaks using ffmpeg/music-metadata. Store as float[] in Track.waveformData |
| 3 | File validation | Verify uploaded files are actual audio (check magic bytes, not just extension). Reject corrupt files |
| 4 | Track status state machine | PROCESSING → FINISHED or FAILED. Prevent edits/playback while PROCESSING. Handle FAILED state gracefully |
| 5 | S3 lifecycle: delete files on track deletion | When track is soft-deleted, schedule S3 object cleanup |
| 6 | Ownership guard | Create reusable `TrackOwnerGuard` or check in service. Used by update, delete, visibility toggle |
| 7 | Swagger decorators on all track endpoints | Full API docs with file upload examples |
| 8 | E2E tests for track upload + CRUD | Test upload flow, metadata update, visibility toggle, status polling |

---

### Dev 4 — Playback Access Logic + Session Persistence

| # | Task | Details |
|---|------|---------|
| 1 | Implement access-state resolver | Logic: check track.accessLevel, user subscription tier, region (if applicable). Return PLAYABLE / PREVIEW / BLOCKED with reason |
| 2 | Presigned URL generation with expiry | Use `@aws-sdk/s3-request-presigner` to generate time-limited stream URLs (e.g., 1 hour) |
| 3 | Play count deduplication | Prevent counting rapid replays — e.g., minimum 30s between play events from same user on same track |
| 4 | Player session persistence (DB-backed) | Create `PlayerSession` storage (can use existing schema or JSON column). Upsert on PUT, return on GET |
| 5 | Cross-device resume | Ensure resume position is per-user-per-track, latest write wins |
| 6 | Handle edge cases: deleted tracks in history, private tracks in history | Don't crash — return null/filtered results |
| 7 | Swagger decorators on all player endpoints | Full API docs |
| 8 | E2E tests for playback flow | Test source URL generation, access states, history tracking, session CRUD |

---

### Dev 5 — Engagement Counts + Cross-Module Integration

| # | Task | Details |
|---|------|---------|
| 1 | Add `likesCount`, `repostsCount`, `isLiked`, `isReposted` to track responses | Coordinate with Dev 3 to enrich GET /tracks/:trackId response |
| 2 | WebSocket events for likes/reposts | Emit `TRACK_LIKED`, `TRACK_REPOSTED` events for real-time UI updates |
| 3 | Prevent liking/reposting your own tracks (optional business rule) | Discuss with team — if required, add check |
| 4 | Validate track exists and is FINISHED before allowing like/repost | Return 404 or 409 for non-existent or PROCESSING tracks |
| 5 | Get user's liked tracks list | `GET /interactions/me/likes` — paginated list of tracks the current user has liked |
| 6 | Get user's reposted tracks list | `GET /interactions/me/reposts` — paginated list of tracks the current user has reposted |
| 7 | Swagger decorators on all interaction endpoints | Full API docs |
| 8 | E2E tests for like/unlike, repost/remove | Test duplicate handling, count accuracy, auth required |

---

## Endpoint Summary by Module

### Module 3: Followers & Social Graph (11 endpoints)
| Endpoint | Method | Owner |
|----------|--------|-------|
| `/social/follow/:userId` | POST | Dev 1 |
| `/social/follow/:userId` | DELETE | Dev 1 |
| `/social/:userId/followers` | GET | Dev 1 |
| `/social/:userId/following` | GET | Dev 1 |
| `/social/suggestions` | GET | Dev 1 |
| `/social/block/:userId` | POST | Dev 2 |
| `/social/block/:userId` | DELETE | Dev 2 |
| `/social/blocked-users` | GET | Dev 2 |

### Module 4: Audio Upload & Track Management (10 endpoints)
| Endpoint | Method | Owner |
|----------|--------|-------|
| `/tracks` | POST | Dev 3 |
| `/tracks/:trackId` | GET | Dev 3 |
| `/tracks/:trackId/status` | GET | Dev 3 |
| `/tracks/:trackId` | PUT | Dev 3 |
| `/tracks/:trackId` | DELETE | Dev 3 |
| `/tracks/:trackId/visibility` | PATCH | Dev 3 |
| `/tracks/:trackId/waveform` | GET | Dev 3 |
| `/tracks/transcoding/callback` | POST | Dev 3 |
| `/tracks/secret/:secretToken` | GET | Dev 3 |
| `/users/:userId/tracks` | GET | Dev 3 |

### Module 5: Playback & Streaming Engine (10 endpoints)
| Endpoint | Method | Owner |
|----------|--------|-------|
| `/player/tracks/:trackId/source` | GET | Dev 4 |
| `/player/tracks/:trackId/state` | GET | Dev 4 |
| `/player/tracks/:trackId/progress` | POST | Dev 4 |
| `/player/tracks/:trackId/play` | POST | Dev 4 |
| `/player/history/recent` | GET | Dev 4 |
| `/player/history` | GET | Dev 4 |
| `/player/history` | DELETE | Dev 4 |
| `/player/tracks/:trackId/resume` | GET | Dev 4 |
| `/player/session` | GET | Dev 4 |
| `/player/session` | PUT | Dev 4 |
| `/player/tracks/:trackId/preview` | GET | Dev 4 |

### Module 6: Engagement & Social Interactions (8 endpoints)
| Endpoint | Method | Owner |
|----------|--------|-------|
| `/interactions/tracks/:trackId/like` | POST | Dev 5 |
| `/interactions/tracks/:trackId/like` | DELETE | Dev 5 |
| `/interactions/tracks/:trackId/repost` | POST | Dev 5 |
| `/interactions/tracks/:trackId/repost` | DELETE | Dev 5 |
| `/interactions/tracks/:trackId/likers` | GET | Dev 5 |
| `/interactions/tracks/:trackId/reposters` | GET | Dev 5 |
| `/interactions/tracks/:trackId/comments` | POST | Dev 2 |
| `/interactions/tracks/:trackId/comments` | GET | Dev 2 |
| `/interactions/comments/:commentId` | DELETE | Dev 2 |

---

## Cross-Module Dependencies

```
Dev 3 (Tracks) ← Dev 4 (Player) needs Track + TrackFile to generate stream URLs
Dev 3 (Tracks) ← Dev 5 (Engagement) needs Track to exist before like/repost
Dev 3 (Tracks) ← Dev 2 (Comments) needs Track to validate timestampSeconds
Dev 1 (Follows) ← Dev 2 (Blocking) needs block check in follow logic
Dev 2 (Blocking) → exports isBlocked() utility for use by other modules
```

**Sprint 1 priority**: Dev 3 should have basic `POST /tracks` and `GET /tracks/:trackId` working by mid-Sprint 1 so Dev 4 and Dev 5 can test against real track records.
