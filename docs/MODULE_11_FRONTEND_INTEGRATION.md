# Module 11 – Moderation & Admin Dashboard
## Frontend Integration Guide

**Base URL:** `https://api.example.com/api/v1`  
**Auth:** All endpoints require an authenticated session via httpOnly cookie (`access_token`). The cookie is set automatically on login — no manual Authorization header needed.

---

## 1. Authentication & Role-Based Access

### Admin Login
Admin users share the **same login endpoint** as regular users.

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "your-password",
  "captcha_token": "<reCAPTCHA token>"
}
```

**Response (200)**
```json
{
  "user": {
    "id": "...",
    "email": "admin@example.com",
    "systemRole": "ADMIN",
    ...
  }
}
```

After login, redirect to the admin dashboard based on `systemRole`:
- `"ADMIN"` → full admin dashboard
- `"MODERATOR"` → moderation dashboard (limited access)
- `"USER"` → regular app

### How roles are enforced
Every admin/moderator route checks the JWT cookie using `JwtAuthGuard` + `RolesGuard`. If the `systemRole` in the JWT does not match, the server returns **403 Forbidden**.

### SystemRole values
| Value | Description |
|-------|-------------|
| `USER` | Regular user |
| `MODERATOR` | Can moderate content (tracks, comments, playlists) |
| `ADMIN` | Full admin access (users, reports, moderation, stats) |

### AccountStatus values
| Value | Description |
|-------|-------------|
| `ACTIVE` | Normal account |
| `SUSPENDED` | Temporarily suspended |
| `BANNED` | Permanently banned |
| `DELETED` | Soft-deleted |

---

## 2. Admin User Management

> **Requires:** `ADMIN` role

### List Users
```
GET /api/v1/admin/users
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `status` | `ACTIVE\|SUSPENDED\|BANNED` | Filter by account status |
| `role` | `USER\|MODERATOR\|ADMIN` | Filter by system role |
| `search` | string | Search by email, display name, or handle |
| `sortBy` | `created_at\|last_login_at\|display_name` | Sort field |
| `sortOrder` | `asc\|desc` | Sort direction |

**Response (200)**
```json
{
  "page": 1,
  "limit": 20,
  "total": 150,
  "total_pages": 8,
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "display_name": "Alice",
      "handle": "alice",
      "avatar_url": null,
      "account_type": "PRO",
      "system_role": "USER",
      "account_status": "ACTIVE",
      "is_verified": true,
      "track_count": 12,
      "report_count": 0,
      "last_login_at": "2024-01-15T10:00:00Z",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get User Detail
```
GET /api/v1/admin/users/:userId
```
**Response (200)**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "display_name": "Alice",
  "handle": "alice",
  "system_role": "USER",
  "account_status": "ACTIVE",
  "is_verified": true,
  "suspended_until": null,
  "stats": {
    "tracks_uploaded": 12,
    "playlists_created": 3,
    "followers_count": 100,
    "following_count": 50
  },
  "subscription": {
    "tier": "PRO",
    "status": "ACTIVE",
    "current_period_end": "2024-02-01T00:00:00Z"
  },
  "moderation_history": [
    {
      "id": "action-uuid",
      "action_type": "WARN_USER",
      "admin_handle": "admin",
      "notes": "Repeated spam",
      "created_at": "2024-01-10T00:00:00Z"
    }
  ],
  "reports_against": { "total": 5, "pending": 2, "resolved": 3 },
  "reports_submitted": { "total": 1, "pending": 0, "resolved": 0 }
}
```

### Get Audit Log
```
GET /api/v1/admin/audit-log
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `limit` | number | Items per page |
| `actionType` | string | Filter by `ModerationActionType` (see enum below) |
| `adminId` | uuid | Filter by admin who performed the action |
| `targetUserId` | uuid | Filter by target user |
| `dateFrom` | ISO date | Start date filter |
| `dateTo` | ISO date | End date filter |

### Platform Stats Overview
```
GET /api/v1/admin/stats/overview
```
**Response (200)** — cached 5 minutes
```json
{
  "users": {
    "total": 5000,
    "active": 4800,
    "suspended": 50,
    "banned": 150
  },
  "tracks": { "total": 20000 },
  "play_events": { "total": 1500000 },
  "active_subscriptions": { "total": 300 },
  "storage": { "total_bytes": 524288000 },
  "moderation_reports": { "pending": 12 },
  "moderation_actions": { "total": 450 }
}
```

### Daily Stats
```
GET /api/v1/admin/stats/daily
```
**Query params:** `days` (number, default: 30)

### Most Reported Content
```
GET /api/v1/admin/stats/most-reported
```
**Query params:** `limit` (number, default: 10), `targetType` (`TRACK|USER|PLAYLIST`)

---

## 3. User Enforcement

> **Requires:** `ADMIN` role  
> **Note:** All write actions require the admin's current password for re-authentication.

### Warn User
```
POST /api/v1/admin/users/:userId/warn
Content-Type: application/json

{
  "reason": "Repeated policy violations",
  "currentPassword": "admin-password",
  "reportId": "uuid" // optional, links to a report
}
```
**Response (200)**
```json
{
  "action_id": "uuid",
  "action_type": "WARN_USER",
  "target_user": { "id": "uuid", "display_name": "Alice", "handle": "alice" },
  "admin_id": "uuid",
  "notes": "Repeated policy violations",
  "created_at": "2024-01-15T10:00:00Z"
}
```

### Suspend User
```
POST /api/v1/admin/users/:userId/suspend
Content-Type: application/json

{
  "reason": "Harassment",
  "currentPassword": "admin-password",
  "durationDays": 7,
  "reportId": "uuid" // optional
}
```

### Ban User
```
POST /api/v1/admin/users/:userId/ban
Content-Type: application/json

{
  "reason": "Severe violation",
  "currentPassword": "admin-password",
  "reportId": "uuid" // optional
}
```
> Banning also hides all user's visible tracks and playlists, and revokes all active sessions.

### Restore User
```
POST /api/v1/admin/users/:userId/restore
Content-Type: application/json

{
  "reason": "Appeal approved",
  "restoreContent": true // optional, restores hidden tracks/playlists
}
```
> Note: Restore does NOT require password re-authentication.

### Enforcement Error Codes
| HTTP | Code | Meaning |
|------|------|---------|
| 403 | `CANNOT_SELF_ENFORCE` | Admin tried to act on their own account |
| 403 | `CANNOT_WARN_ADMIN` / `CANNOT_BAN_ADMIN` / `CANNOT_SUSPEND_ADMIN` | Cannot enforce on another admin |
| 403 | `INSUFFICIENT_PERMISSIONS` | Admin role DB verification failed |
| 401 | `INCORRECT_PASSWORD` | Wrong current password |
| 409 | `USER_ALREADY_BANNED` | User is already banned |
| 409 | `USER_ALREADY_ACTIVE` | User is already active (for restore) |
| 404 | `USER_NOT_FOUND` | Target user not found |

---

## 4. Content Moderation

> **Requires:** `ADMIN` or `MODERATOR` role

### Moderate Track
```
PATCH /api/v1/admin/tracks/:id/moderation
Content-Type: application/json

{
  "moderationState": "HIDDEN",
  "reason": "Violates copyright policy",
  "reportId": "uuid" // optional
}
```

**ModerationState values:**
| Value | Description |
|-------|-------------|
| `VISIBLE` | Content is visible (restore) |
| `HIDDEN` | Hidden from public |
| `REMOVED` | Permanently removed |

**Response (200)**
```json
{
  "action_id": "uuid",
  "action_type": "HIDE_TRACK",
  "track": {
    "id": "uuid",
    "title": "My Track",
    "previous_state": "VISIBLE",
    "new_state": "HIDDEN"
  },
  "admin_id": "uuid",
  "notes": "Violates copyright policy",
  "created_at": "2024-01-15T10:00:00Z"
}
```

### Moderate Comment
```
PATCH /api/v1/admin/comments/:id/moderation
Content-Type: application/json

{
  "isHidden": true,
  "reason": "Hate speech",
  "reportId": "uuid" // optional
}
```

### Moderate Playlist
```
PATCH /api/v1/admin/playlists/:id/moderation
Content-Type: application/json

{
  "moderationState": "REMOVED",
  "reason": "Mass copyright violation",
  "reportId": "uuid" // optional
}
```

### ModerationActionType values
| Value | Triggered By |
|-------|-------------|
| `WARN_USER` | warnUser |
| `SUSPEND_USER` | suspendUser |
| `BAN_USER` | banUser |
| `RESTORE_CONTENT` | restoreUser or moderateTrack/Playlist to VISIBLE |
| `HIDE_TRACK` | moderateTrack to HIDDEN |
| `REMOVE_TRACK` | moderateTrack to REMOVED |
| `HIDE_PLAYLIST` | moderatePlaylist to HIDDEN |
| `REMOVE_PLAYLIST` | moderatePlaylist to REMOVED |
| `HIDE_COMMENT` | moderateComment to hidden |

---

## 5. Reports System

### Submit a Report (Authenticated Users)
```
POST /api/v1/reports
Content-Type: application/json

{
  "targetType": "TRACK",
  "targetId": "uuid",
  "reason": "SPAM",
  "description": "This track contains spam content"
}
```

**ReportTargetType values:** `TRACK`, `USER`, `PLAYLIST`

**ReportReason values** (check your Prisma schema for the full enum — common values):
`SPAM`, `HARASSMENT`, `HATE_SPEECH`, `COPYRIGHT`, `INAPPROPRIATE_CONTENT`, `MISINFORMATION`, `OTHER`

**Rate limit:** 5 reports per minute per user.

**Error Codes:**
| HTTP | Code | Meaning |
|------|------|---------|
| 409 | `DUPLICATE_REPORT` | Already reported this content (and not rejected yet) |
| 404 | `TRACK_NOT_FOUND` / `USER_NOT_FOUND` / `PLAYLIST_NOT_FOUND` | Target does not exist |
| 400 | `INVALID_TARGET_TYPE` | Unsupported target type |
| 429 | (throttle) | Too many reports submitted |

### Submit an Appeal
```
POST /api/v1/reports/appeal
Content-Type: application/json

{
  "reportId": "uuid",
  "message": "I believe this report was made in error. Please review."
}
```

---

## 6. Admin Report Management

> **Requires:** `ADMIN` or `MODERATOR` role

### List Reports
```
GET /api/v1/admin/reports
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `limit` | number | Items per page |
| `status` | `PENDING\|UNDER_REVIEW\|RESOLVED\|REJECTED` | Filter by status |
| `targetType` | `TRACK\|USER\|PLAYLIST` | Filter by target type |

**ReportStatus values:**
| Value | Description |
|-------|-------------|
| `PENDING` | Not yet reviewed |
| `UNDER_REVIEW` | Assigned to a moderator |
| `RESOLVED` | Action taken |
| `REJECTED` | Dismissed |

### Get Report by ID
```
GET /api/v1/admin/reports/:id
```
Returns report + all associated appeals.

### Update Report
```
PATCH /api/v1/admin/reports/:id
Content-Type: application/json

{
  "status": "RESOLVED",
  "resolutionNotes": "Content removed and user warned."
}
```

### Bulk Update Reports
```
PATCH /api/v1/admin/reports/bulk
Content-Type: application/json

{
  "reportIds": ["uuid1", "uuid2", "uuid3"],
  "status": "REJECTED",
  "resolutionNotes": "False reports"
}
```

### Assign Report to Admin
```
PATCH /api/v1/admin/reports/:id/assign
Content-Type: application/json

{
  "adminId": "uuid-of-admin-to-assign"
}
```

---

## 7. Common Error Response Format

All errors follow this format:
```json
{
  "statusCode": 403,
  "code": "CANNOT_SELF_ENFORCE",
  "message": "Admins cannot perform enforcement actions on themselves."
}
```

## 8. Common HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error or business logic error |
| 401 | Not authenticated (no valid session cookie) |
| 403 | Authenticated but forbidden (wrong role) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, already in state) |
| 429 | Too many requests (rate limited) |
| 500 | Internal server error |

---

## 9. Swagger UI

Full interactive API documentation is available at:
```
http://localhost:3006/api/docs
```
> Note: Swagger uses cookie auth — log in first via `POST /api/v1/auth/login` in the browser, then Swagger requests will include the session cookie automatically.
