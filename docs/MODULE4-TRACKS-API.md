# Module 4: Audio Upload & Track Management — API Reference

> **Base URL:** `/api/v1`  
> **Auth:** JWT via httpOnly cookie (`access_token`) unless marked `Public`.  
> **Content-Type:** `application/json` unless noted otherwise.  
> **Swagger UI:** `http://localhost:3000/api/docs` (when server is running)

---

## Table of Contents

| # | Endpoint | Method | Auth |
|---|---|---|---|
| 1 | [Upload Track](#1-upload-track) | `POST /tracks` | Required |
| 2 | [Get Track Details](#2-get-track-details) | `GET /tracks/{trackId}` | Public |
| 3 | [Get Track Status](#3-get-track-status) | `GET /tracks/{trackId}/status` | Public |
| 4 | [Update Track Metadata](#4-update-track-metadata) | `PUT /tracks/{trackId}` | Required (owner) |
| 5 | [Delete Track](#5-delete-track) | `DELETE /tracks/{trackId}` | Required (owner/admin) |
| 6 | [Get Artist's Tracks](#6-get-artists-tracks) | `GET /users/{userId}/tracks` | Public |
| 7 | [Change Track Visibility](#7-change-track-visibility) | `PATCH /tracks/{trackId}/visibility` | Required (owner) |
| 8 | [Get Waveform Data](#8-get-waveform-data) | `GET /tracks/{trackId}/waveform` | Public |
| 9 | [Transcoding Callback](#9-transcoding-callback) | `POST /tracks/transcoding/callback` | API Key |
| 10 | [Resolve Private Track by Secret Token](#10-resolve-private-track-by-secret-token) | `GET /tracks/secret/{secretToken}` | Public |

---

## 1. Upload Track

**`POST /api/v1/tracks`** — Upload a new audio track.

### Auth
Requires JWT cookie. Rate limited to **5 uploads per minute**.

### Request
`Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `audioFile` | binary | **Yes** | MP3 or WAV file. Max **250 MB**. Validated by magic bytes (not just extension). |
| `title` | string | **Yes** | Track title. Max 100 characters. |
| `genre` | string | No | Must match an existing genre name in the database. |
| `tags` | string[] | No | Max 10 tags, each max 30 characters. |
| `releaseDate` | string | No | ISO 8601 date (e.g., `2026-03-01`). |
| `description` | string | No | Max 5000 characters. |

### Success Response — `202 Accepted`
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "Ya Ana",
  "artistId": "usr_456",
  "status": "PROCESSING",
  "visibility": "PRIVATE",
  "waveformData": null
}
```

### Error Responses

| Status | When | Example |
|---|---|---|
| `400` | No file, file too large, not a real audio file, genre not found, or validation error | `{ "statusCode": 400, "message": "Invalid audio file. Only MP3 and WAV files are accepted.", "error": "Bad Request" }` |
| `401` | Missing or invalid JWT | `{ "statusCode": 401, "message": "Unauthorized" }` |
| `429` | Rate limit exceeded | Too many uploads (max 5/min) |

### Notes
- Track starts with `status: "PROCESSING"` and `visibility: "PRIVATE"`.
- Frontend should poll `GET /tracks/{trackId}/status` until status becomes `FINISHED` or `FAILED`.
- Audio is validated by **magic bytes** (ID3 headers, MP3 frame sync, RIFF/WAVE), not by file extension or MIME type alone.

---

## 2. Get Track Details

**`GET /api/v1/tracks/{trackId}`** — Returns full track metadata.

### Auth
Public. Private tracks are only visible to their owner (others get 404).

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Success Response — `200 OK`
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "Ya Ana",
  "slug": "ya-ana",
  "description": "Latest single from the album",
  "artist": "Amr Diab",
  "artistId": "usr_456",
  "artistHandle": "amrdiab",
  "artistAvatarUrl": "https://example.com/avatars/amrdiab.jpg",
  "genre": "Pop",
  "tags": ["pop", "2026"],
  "releaseDate": "2026-03-06T00:00:00.000Z",
  "durationMs": 215000,
  "waveformData": [0.1, 0.3, 0.5, 0.7, 0.4],
  "visibility": "PUBLIC",
  "accessLevel": "PUBLIC",
  "status": "FINISHED",
  "license": "ALL_RIGHTS_RESERVED",
  "allowComments": true,
  "downloadable": false,
  "coverArtUrl": "https://example.com/covers/ya-ana.jpg",
  "secretToken": null,
  "publishedAt": "2026-03-06T12:00:00.000Z",
  "createdAt": "2026-03-06T11:00:00.000Z",
  "updatedAt": "2026-03-06T12:00:00.000Z",
  "files": [
    {
      "id": "file_001",
      "role": "ORIGINAL",
      "mimeType": "audio/mpeg",
      "format": "mp3",
      "size": 8500000,
      "status": "READY"
    }
  ]
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `trackId` | UUID | Unique track identifier |
| `title` | string | Track title |
| `slug` | string | URL-safe version of the title (for routing: `/@handle/slug`) |
| `description` | string \| null | Track description |
| `artist` | string \| null | Artist display name |
| `artistId` | UUID \| null | Artist user ID (for profile links / ownership checks) |
| `artistHandle` | string \| null | Artist handle (for profile URL: `/@amrdiab`) |
| `artistAvatarUrl` | string \| null | Artist avatar image URL |
| `genre` | string \| null | Primary genre name |
| `tags` | string[] | List of tag names |
| `releaseDate` | ISO datetime \| null | Release date |
| `durationMs` | number \| null | Track duration in milliseconds (for player progress bar) |
| `waveformData` | number[] \| null | Amplitude data for waveform rendering. `null` while processing. |
| `visibility` | `"PUBLIC"` \| `"PRIVATE"` | Track visibility |
| `accessLevel` | string | Access level (future: `LINK_ONLY`) |
| `status` | `"PROCESSING"` \| `"FINISHED"` \| `"FAILED"` | Processing status |
| `license` | string | License type |
| `allowComments` | boolean | Whether comments are enabled |
| `downloadable` | boolean | Whether the track can be downloaded |
| `coverArtUrl` | string \| null | Cover art image URL |
| `secretToken` | string \| null | Secret share token (only visible to owner). `null` for public tracks. |
| `publishedAt` | ISO datetime \| null | When the track was first made public |
| `createdAt` | ISO datetime | Upload timestamp |
| `updatedAt` | ISO datetime | Last modification timestamp |
| `files` | array | Attached audio files (original, transcoded streams) |
| `files[].role` | `"ORIGINAL"` \| `"STREAM"` | File purpose |
| `files[].mimeType` | string | MIME type (e.g., `audio/mpeg`) |
| `files[].size` | number \| null | File size in bytes |
| `files[].status` | `"READY"` \| `"PROCESSING"` | File availability |

### Error Responses

| Status | When | Example |
|---|---|---|
| `404` | Track not found, deleted, or private (and you're not the owner) | `{ "statusCode": 404, "message": "Track not found.", "error": "Not Found" }` |

### Notes
- Private tracks return 404 to non-owners (doesn't reveal the track exists).
- Use `GET /tracks/secret/{secretToken}` to share private tracks externally.
- The `files` array contains the streaming URLs your audio player needs.

---

## 3. Get Track Status

**`GET /api/v1/tracks/{trackId}/status`** — Lightweight status check for polling.

### Auth
Public. Private tracks return 404 for non-owners.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Success Response — `200 OK`
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "PROCESSING"
}
```

### Possible `status` Values
| Status | Meaning |
|---|---|
| `PROCESSING` | Audio is being transcoded / waveform being generated |
| `FINISHED` | Ready to play |
| `FAILED` | Processing failed |

### Error Responses

| Status | When |
|---|---|
| `404` | Track not found or private (non-owner) |

### Notes
- **Poll this endpoint** every 2–5 seconds after upload until status is `FINISHED` or `FAILED`.
- This is intentionally lightweight — only returns 2 fields.

---

## 4. Update Track Metadata

**`PUT /api/v1/tracks/{trackId}`** — Update one or more metadata fields.

### Auth
Requires JWT cookie. **Only the track owner** can update.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Request Body
`Content-Type: application/json` — All fields are optional. Only provided fields are changed.

```json
{
  "title": "New Title",
  "genre": "Pop",
  "tags": ["summer", "hit"],
  "releaseDate": "2026-06-01",
  "description": "Updated description"
}
```

| Field | Type | Rules |
|---|---|---|
| `title` | string | Max 100 chars. Changing the title also updates the `slug`. |
| `genre` | string | Must match an existing genre. Send `""` or `null` to remove. |
| `tags` | string[] | **Replaces all tags** (not merged). Max 10, each max 30 chars. |
| `releaseDate` | string | ISO date. Send `null` to remove. |
| `description` | string | Max 5000 chars. |

### Success Response — `200 OK`
Returns the full updated track detail object (same shape as [Get Track Details](#2-get-track-details)).

### Error Responses

| Status | When | Example |
|---|---|---|
| `400` | Genre not found, title too long, validation error | `{ "statusCode": 400, "message": "Genre \"NonExistent\" not found.", "error": "Bad Request" }` |
| `401` | Not authenticated | `{ "statusCode": 401, "message": "Unauthorized" }` |
| `403` | Authenticated but not the track owner | `{ "statusCode": 403, "message": "You do not have permission to modify this track.", "error": "Forbidden" }` |
| `404` | Track not found or deleted | `{ "statusCode": 404, "message": "Track not found.", "error": "Not Found" }` |

### Notes
- Does **not** change visibility. Use `PATCH /tracks/{trackId}/visibility` for that.
- Tags are **replaced entirely**, not merged. To add a tag, send the full new list.

---

## 5. Delete Track

**`DELETE /api/v1/tracks/{trackId}`** — Soft-delete a track.

### Auth
Requires JWT cookie. **Track owner or ADMIN** can delete.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Success Response — `204 No Content`
No response body.

### Error Responses

| Status | When | Example |
|---|---|---|
| `401` | Not authenticated | `{ "statusCode": 401, "message": "Unauthorized" }` |
| `403` | Not the owner and not an admin | `{ "statusCode": 403, "message": "You do not have permission to delete this track.", "error": "Forbidden" }` |
| `404` | Track not found or already deleted | `{ "statusCode": 404, "message": "Track not found.", "error": "Not Found" }` |

### Notes
- This is a **soft-delete** — the track is marked with a `deletedAt` timestamp and hidden from all queries.
- Associated files (S3 or local storage) are cleaned up asynchronously in the background.
- Soft-deleted tracks are retained for admin review, DMCA disputes, and analytics.

---

## 6. Get Artist's Tracks

**`GET /api/v1/users/{userId}/tracks`** — Paginated list of an artist's tracks.

### Auth
Public. Non-owners only see `PUBLIC` + `FINISHED` tracks. The owner sees all their tracks (including `PRIVATE` and `PROCESSING`).

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `userId` | UUID | Artist user ID |

### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | 1 | Page number (min: 1) |
| `limit` | integer | 20 | Items per page (min: 1, max: 100) |

### Success Response — `200 OK`
```json
{
  "artist": {
    "userId": "usr_456",
    "name": "Amr Diab",
    "avatarUrl": "https://example.com/avatars/amrdiab.jpg"
  },
  "page": 1,
  "limit": 20,
  "totalTracks": 500,
  "tracks": [
    {
      "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "title": "Ya Ana",
      "slug": "ya-ana",
      "durationMs": 215000,
      "waveformData": [0.1, 0.3, 0.5, 0.7, 0.4],
      "visibility": "PUBLIC",
      "status": "FINISHED",
      "coverArtUrl": "https://example.com/covers/ya-ana.jpg",
      "createdAt": "2026-03-06T11:00:00.000Z",
      "genre": "Pop",
      "artist": {
        "id": "usr_456",
        "displayName": "Amr Diab",
        "handle": "amrdiab",
        "avatarUrl": "https://example.com/avatars/amrdiab.jpg"
      }
    }
  ]
}
```

### Track List Item Fields

| Field | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |
| `title` | string | Track title |
| `slug` | string | URL slug |
| `durationMs` | number \| null | Duration in ms (for "3:35" display) |
| `waveformData` | number[] \| null | Waveform amplitudes |
| `visibility` | string | `PUBLIC` or `PRIVATE` |
| `status` | string | `PROCESSING`, `FINISHED`, or `FAILED` |
| `coverArtUrl` | string \| null | Cover art thumbnail |
| `createdAt` | ISO datetime | Upload time (for "2 days ago" labels) |
| `genre` | string \| null | Genre name |
| `artist.id` | UUID | Artist user ID |
| `artist.displayName` | string | Artist name |
| `artist.handle` | string | Artist handle |
| `artist.avatarUrl` | string \| null | Avatar URL |

### Notes
- Results are ordered by `createdAt` descending (newest first).
- The `artist` object is included per track to make the list reusable for mixed-artist views (e.g., search results).

---

## 7. Change Track Visibility

**`PATCH /api/v1/tracks/{trackId}/visibility`** — Toggle between PUBLIC and PRIVATE.

### Auth
Requires JWT cookie. **Only the track owner** can change visibility.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Request Body
```json
{
  "visibility": "PUBLIC"
}
```

| Field | Type | Values |
|---|---|---|
| `visibility` | string | `"PUBLIC"` or `"PRIVATE"` |

### Success Response — `200 OK`
Returns the full updated track detail object (same shape as [Get Track Details](#2-get-track-details)).

### Error Responses

| Status | When | Example |
|---|---|---|
| `401` | Not authenticated | `{ "statusCode": 401, "message": "Unauthorized" }` |
| `403` | Not the track owner | `{ "statusCode": 403, "message": "You do not have permission to modify this track.", "error": "Forbidden" }` |
| `404` | Track not found or deleted | `{ "statusCode": 404, "message": "Track not found.", "error": "Not Found" }` |

### Notes
- **Switching to PRIVATE** generates a new `secretToken` — old share links become invalid.
- **Switching to PUBLIC** for the first time sets the `publishedAt` timestamp.
- This endpoint is separate from `PUT /tracks/{trackId}` so visibility can be toggled without affecting other metadata.

---

## 8. Get Waveform Data

**`GET /api/v1/tracks/{trackId}/waveform`** — Returns waveform amplitudes only.

### Auth
Public.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `trackId` | UUID | Track ID |

### Success Response — `200 OK`
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "waveformData": [0.1, 0.3, 0.5, 0.8, 0.6, 0.4, 0.2, 0.7, 0.9, 0.3]
}
```

### Error Responses

| Status | When |
|---|---|
| `404` | Track not found or deleted |

### Notes
- Intentionally lightweight — only queries the `waveformData` column.
- `waveformData` will be `null` if processing is not yet complete.
- Use this for rendering the waveform visualization without loading full track metadata.

---

## 9. Transcoding Callback

**`POST /api/v1/tracks/transcoding/callback`** — Internal callback from the transcoding service.

### Auth
**API key** via `x-api-key` header (NOT JWT). This endpoint is `@Public()` — JWT is skipped.

### Headers

| Header | Required | Description |
|---|---|---|
| `x-api-key` | **Yes** | Shared secret between backend and transcoding service. Validated with constant-time comparison. |

### Request Body
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "FINISHED",
  "fileUrls": {
    "mp3": "https://cdn.example.com/tracks/abc123.mp3",
    "wav": "https://cdn.example.com/tracks/abc123.wav"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `trackId` | string | **Yes** | ID of the track that was processed |
| `status` | string | **Yes** | `"FINISHED"` or `"FAILED"` |
| `fileUrls` | object | No | Map of format → URL for generated files (only when `FINISHED`) |

### Success Response — `200 OK`
```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "FINISHED"
}
```

### Error Responses

| Status | When | Example |
|---|---|---|
| `400` | `x-api-key` is not configured on the server | `{ "statusCode": 400, "message": "Transcoding API key is not configured.", "error": "Bad Request" }` |
| `401` | Invalid or missing API key | `{ "statusCode": 401, "message": "Invalid transcoding API key.", "error": "Unauthorized" }` |
| `404` | Track not found | `{ "statusCode": 404, "message": "Track not found.", "error": "Not Found" }` |
| `409` | Track is not in `PROCESSING` state | `{ "statusCode": 409, "message": "Track is not in PROCESSING state.", "error": "Conflict" }` |

### Notes
- **Not for frontend use.** This is called by the transcoding service only.
- The API key is compared using `crypto.timingSafeEqual` to prevent timing attacks.
- When `status = "FINISHED"`, the provided `fileUrls` are stored as `TrackFile` records.
- When `status = "FAILED"`, no files are stored.

---

## 10. Resolve Private Track by Secret Token

**`GET /api/v1/tracks/secret/{secretToken}`** — Access a private track via a secret share link.

### Auth
Public — no authentication required. Anyone with the link can view.

### Path Parameters

| Param | Type | Description |
|---|---|---|
| `secretToken` | string | 24-character nanoid token from the share link |

### Success Response — `200 OK`
Returns the full track detail object (same fields as [Get Track Details](#2-get-track-details)) **plus** a `message` field:

```json
{
  "trackId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "title": "Unreleased Demo",
  "slug": "unreleased-demo",
  "description": null,
  "artist": "Amr Diab",
  "artistId": "usr_456",
  "artistHandle": "amrdiab",
  "artistAvatarUrl": "https://example.com/avatars/amrdiab.jpg",
  "genre": "Pop",
  "tags": ["pop", "2026"],
  "releaseDate": "2026-03-06T00:00:00.000Z",
  "durationMs": 215000,
  "waveformData": [0.1, 0.3, 0.5, 0.7, 0.4],
  "visibility": "PRIVATE",
  "status": "FINISHED",
  "coverArtUrl": null,
  "secretToken": "V1StGXR8_Z5jdHi6B-myT-RQ",
  "publishedAt": null,
  "createdAt": "2026-03-06T11:00:00.000Z",
  "updatedAt": "2026-03-06T11:00:00.000Z",
  "files": [],
  "message": "Access granted via secret token"
}
```

### Error Responses

| Status | When | Example |
|---|---|---|
| `404` | Token is invalid, track was deleted, or token expired (track changed visibility) | `{ "statusCode": 404, "message": "Track not found or token is invalid.", "error": "Not Found" }` |

### Notes
- Secret tokens are 24-character nanoid strings — unguessable by design.
- A **new token is generated** every time a track switches to PRIVATE, invalidating old share links.
- The response includes full track details so the frontend can render the complete track page.

---

## Enums Reference

### TrackVisibility
| Value | Description |
|---|---|
| `PUBLIC` | Visible to everyone |
| `PRIVATE` | Only visible to owner (or via secret token) |

### TrackStatus
| Value | Description |
|---|---|
| `PROCESSING` | Audio is being transcoded |
| `FINISHED` | Ready to play |
| `FAILED` | Processing failed |

### FileRole
| Value | Description |
|---|---|
| `ORIGINAL` | Original uploaded file |
| `STREAM` | Transcoded streaming version |

### FileStatus
| Value | Description |
|---|---|
| `READY` | File is available |
| `PROCESSING` | File is being generated |

---

## Common Error Format

All errors follow this structure:
```json
{
  "statusCode": 400,
  "message": "Human-readable error message.",
  "error": "Bad Request"
}
```

| Status | Meaning |
|---|---|
| `400` | Validation error / bad input |
| `401` | Not authenticated or invalid API key |
| `403` | Authenticated but not authorized (not owner / not admin) |
| `404` | Resource not found (also used for private resource access denial) |
| `409` | State conflict (e.g., processing already completed) |
| `429` | Rate limit exceeded |
