# Sprint 2 — Frontend/Cross Integration Q&A

> Quick answers for the cross-team. Based on actual codebase inspection (March 2026).

---

## ⚠️ Important: Tracks Module Is NOT Implemented Yet

The `src/tracks/` directory contains only `.gitkeep` — **no controller, service, or DTOs exist**. All track endpoint answers below are based on the **Prisma schema** (the database design is ready) and expected patterns. These will be confirmed once the module is built.

---

## Image Upload Questions

### Q1: What's the exact error for unsupported format / oversize image?

Both return **400 Bad Request** with standard error shape:

```json
// Unsupported format
{
  "statusCode": 400,
  "error": "VALIDATION_FAILED",
  "message": "Unsupported image type \"image/svg+xml\". Allowed: jpeg, png, webp.",
  "timestamp": "...",
  "path": "..."
}

// Oversize
{
  "statusCode": 400,
  "error": "VALIDATION_FAILED",
  "message": "File exceeds the 5 MB limit for avatar images.",
  "timestamp": "...",
  "path": "..."
}
```

**Limits:** Avatar = 5 MB, Cover = 15 MB. Formats: **JPEG, PNG, WebP** only.

---

### Q2: Is the returned image URL immediately usable?

**Yes.** No CDN processing delay. The URL returned in the response is valid and servable immediately (local dev: `http://localhost:3000/uploads/...`, production: S3/CloudFront direct).

---

### Q3: Avatar/cover via PATCH /profiles/me or only upload endpoint?

**Only the upload endpoint.** `PATCH /profiles/me` does NOT accept avatar or cover.

Upload endpoints:
- `POST /api/v1/profiles/me/avatar` (or `/profiles/me/images/avatar`)
- `POST /api/v1/profiles/me/cover` (or `/profiles/me/images/cover`)

Send as `multipart/form-data` with field name `file`.

---

### Q4: Do old image URLs stay valid after update?

**No.** The old file is deleted asynchronously after the new one is saved. Old URLs will return 404 eventually. **Invalidate them client-side** — always use the URL from the latest GET /profiles/me response.

---

## Track Questions (Schema-Based — Module Not Yet Coded)

### Q5: Does PUT /tracks/{trackId} support `description`?

**Not implemented yet.** But the Prisma schema has:

```
description  String?  @db.Text    // optional, unlimited length
```

Field name will be **`description`**. When the endpoint is built, it should support it.

---

### Q6: What are the validation rules for track fields?

**No DTO validators exist yet.** Based on the schema and project patterns, **recommended rules** for when the module is built:

| Field | Expected Rule |
|-------|---------------|
| `title` | Required, 1–255 chars |
| `description` | Optional, max ~5000 chars (Text type, no DB limit) |
| `genre` | Foreign key to Genre table (integer ID, not free text) |
| `tags` | Array of strings, likely max 10 tags, each tag max ~50 chars |
| `visibility` | Enum: `PUBLIC` or `PRIVATE` |

**These need to be confirmed once the tracks module is implemented.**

---

### Q7: What does PUT /tracks/{trackId} return?

**Not implemented.** Following the project's pattern (PATCH /profiles/me returns the full updated object), **expect:** full updated track object.

---

### Q8: Is DELETE hard delete or soft delete?

**Soft delete.** The schema has a `deletedAt DateTime?` field. From the frontend perspective:
- Track disappears from listings/search
- The URL may still resolve briefly (cache)
- Treat it as gone — don't try to re-fetch

---

### Q9: Do owner's private tracks appear in their own profile?

**Not implemented.** But based on the existing users module pattern — **yes**, the service checks `isOwner` and returns full data including private items when the requester is the owner.

---

### Q10: What are the allowed privacy/visibility values?

Prisma enum `TrackVisibility`:

```
PUBLIC    — visible to everyone
PRIVATE   — visible only to the owner
```

**No `LINK_ONLY` enum value exists.** Secret/unlisted sharing uses a separate `secretToken` field on the track — not a visibility enum value. Frontend should expose **PUBLIC** and **PRIVATE** for now.

---

### Q11: What can be edited on a track? (When implemented)

Based on the schema, editable fields should be:

| Field | Editable | Type |
|-------|----------|------|
| `title` | ✅ | string |
| `description` | ✅ | string (optional) |
| `genre` | ✅ | genre ID (integer) |
| `tags` | ✅ | string array (via TrackTag relation) |
| `visibility` | ✅ | `PUBLIC` \| `PRIVATE` |
| `license` | ✅ | enum (ALL_RIGHTS_RESERVED, CC_BY, etc.) |
| `allowComments` | ✅ | boolean |
| `downloadable` | ✅ | boolean |
| `releaseDate` | ✅ | ISO date (optional) |
| `coverArtUrl` | ✅ | via separate upload |

---

## Profile Fields (Implemented ✅)

`PATCH /api/v1/profiles/me` accepts:

| Field | Validation |
|-------|-----------|
| `display_name` | 2–50 chars |
| `bio` | Max 500 chars |
| `location` | Max 100 chars |
| `website` | Valid HTTPS URL (empty string clears it) |
| `favorite_genres` | Max 5 from allowed list |
| `account_type` | `LISTENER` \| `ARTIST` |
| `is_private` | Boolean |

Returns: full updated profile object.

---

## Summary for the FE Team

| Question | Short Answer |
|----------|-------------|
| Image error format | 400 + standard error shape with specific message |
| Image URL usable immediately? | **Yes** |
| Avatar/cover in PATCH /profiles/me? | **No** — use upload endpoints only |
| Old image URLs valid? | **No** — invalidate client-side |
| PUT tracks supports description? | **Not built yet** — schema has it |
| Track field validation? | **Not built yet** — see recommended rules above |
| PUT tracks return value? | **Not built yet** — expect full object |
| DELETE hard or soft? | **Soft delete** (schema has `deletedAt`) |
| Owner sees own private tracks? | **Yes** (expected) |
| Visibility values? | `PUBLIC`, `PRIVATE` only (no LINK_ONLY) |
