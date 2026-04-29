# Front-End Integration Guide: Discovery Search & Resolver (Modules 8 & 11)

## Overview

This guide covers the new enriched response fields and resolver logic for the Discovery Search and Resolver endpoints. These changes enable your front-end to display richer user profiles, track metadata, and playlist information without requiring additional API calls.

---

## 1. Discovery Search Endpoint

### Endpoint
```
GET /api/v1/discovery/search?q=<query>
```

### Response Structure
The search endpoint now returns categorized results (tracks, users, playlists) with enriched metadata:

```json
{
  "query": "lofi chill",
  "results": {
    "tracks": [
      {
        "id": "trk_123",
        "title": "Night Drive",
        "slug": "night-drive",
        "description": "Late-night synthwave track",
        "coverArtUrl": "https://cdn.example.com/cover.jpg",
        "coverArt": "https://cdn.example.com/cover.jpg",
        "genre": "synthwave",
        "artist_handle": "nightowl"
      }
    ],
    "users": [
      {
        "userId": "usr_456",
        "handle": "nightowl",
        "displayName": "Night Owl",
        "avatarUrl": "https://cdn.example.com/avatar.jpg",
        "avatar_url": "https://cdn.example.com/avatar.jpg"
      }
    ],
    "playlists": [
      {
        "id": "pl_789",
        "title": "Night Drive Mix",
        "slug": "night-drive-mix",
        "description": "Late-night playlist",
        "coverArtUrl": "https://cdn.example.com/playlist-cover.jpg",
        "coverArt": "https://cdn.example.com/playlist-cover.jpg",
        "owner_handle": "nightowl"
      }
    ]
  },
  "totals": {
    "tracks": 12,
    "users": 4,
    "playlists": 3
  }
}
```

### Key New Fields

#### Tracks
- **`coverArt`** *(string | null)*: Alias for coverArtUrl; use for your UI
- **`genre`** *(string | null)*: Genre classification (e.g., "synthwave", "lofi")
- **`artist_handle`** *(string)*: Artist's handle for attribution and linking

#### Users
- **`avatar_url`** *(string | null)*: Alias for avatarUrl; standardized naming
- Use for user profile cards or mentions

#### Playlists
- **`coverArt`** *(string | null)*: Playlist cover image URL
- **`owner_handle`** *(string)*: Playlist owner's handle

---

## 2. Resolver Endpoint (Resource Resolution)

### Endpoint
```
GET /api/v1/discovery/resolve?url=<public_path>
```

### Purpose
Converts public-facing URLs (like `/username/track-slug`) into internal resource IDs and returns full resource metadata.

### Response Structure

The resolver now returns **full resource objects** instead of just IDs:

```json
{
  "matched": true,
  "resourceType": "TRACK",
  "id": "trk_123",
  "title": "Night Drive",
  "slug": "night-drive",
  "description": "Late-night synthwave track",
  "coverArtUrl": "https://cdn.example.com/cover.jpg",
  "coverArt": "https://cdn.example.com/cover.jpg",
  "genre": "synthwave",
  "artist_handle": "nightowl"
}
```

### Resource Types

The resolver can match three resource types:

| Resource Type | Typical URL Pattern | Response Includes |
|---|---|---|
| **TRACK** | `/artist-handle/track-slug` | `id`, `title`, `slug`, `coverArt`, `genre`, `artist_handle` |
| **USER** | `/username` | `id`, `handle`, `displayName`, `avatar_url` |
| **PLAYLIST** | `/owner-handle/playlist-slug` | `id`, `title`, `slug`, `coverArt`, `owner_handle` |

### Example Resolve Requests

**Resolve a track:**
```
GET /api/v1/discovery/resolve?url=/nightowl/night-drive
```

**Response:**
```json
{
  "matched": true,
  "resourceType": "TRACK",
  "id": "trk_123",
  "title": "Night Drive",
  "artist_handle": "nightowl",
  "coverArt": "https://cdn.example.com/cover.jpg"
}
```

**Resolve a user:**
```
GET /api/v1/discovery/resolve?url=/nightowl
```

**Response:**
```json
{
  "matched": true,
  "resourceType": "USER",
  "id": "usr_456",
  "handle": "nightowl",
  "displayName": "Night Owl",
  "avatar_url": "https://cdn.example.com/avatar.jpg"
}
```

**Resolve fails (not found):**
```json
{
  "matched": false,
  "resourceType": null
}
```

---

## 3. TypeScript Interfaces

Use these interfaces in your React/Vue/Angular front-end:

### Search Response

```typescript
// Search result for a track
interface SearchTrackResult {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverArtUrl: string | null;
  coverArt: string | null; // Use this for UI
  genre: string | null;
  artist_handle: string;
}

// Search result for a user
interface SearchUserResult {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  avatar_url: string | null; // Use this for UI
}

// Search result for a playlist
interface SearchPlaylistResult {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverArtUrl: string | null;
  coverArt: string | null; // Use this for UI
  owner_handle: string;
}

interface DiscoverySearchResults {
  tracks: SearchTrackResult[];
  users: SearchUserResult[];
  playlists: SearchPlaylistResult[];
}

interface DiscoverySearchTotals {
  tracks: number;
  users: number;
  playlists: number;
}

interface DiscoverySearchResponse {
  query: string;
  results: DiscoverySearchResults;
  totals: DiscoverySearchTotals;
}
```

### Resolver Response

```typescript
import { ReportTargetType } from '@prisma/client'; // Or your own enum

interface DiscoveryResolveResponse {
  matched: boolean;
  resourceType?: ReportTargetType | 'TRACK' | 'USER' | 'PLAYLIST';
  
  // Common fields
  id?: string;
  slug?: string;
  
  // User fields
  handle?: string;
  displayName?: string;
  avatar_url?: string | null;
  
  // Track/Playlist fields
  title?: string;
  description?: string | null;
  coverArt?: string | null;
  
  // Track-specific
  genre?: string | null;
  artist_handle?: string | null;
  
  // Playlist-specific
  owner_handle?: string | null;
}
```

---

## 4. Usage Examples

### Example 1: Display Search Results

```typescript
const handleSearch = async (query: string) => {
  const response = await fetch(`/api/v1/discovery/search?q=${encodeURIComponent(query)}`);
  const data: DiscoverySearchResponse = await response.json();
  
  // Render tracks with cover art and genre
  data.results.tracks.forEach(track => {
    console.log(`${track.title} by ${track.artist_handle}`);
    console.log(`Genre: ${track.genre}`);
    console.log(`Cover: ${track.coverArt}`);
  });
  
  // Render users with avatars
  data.results.users.forEach(user => {
    console.log(`@${user.handle} - ${user.displayName}`);
    console.log(`Avatar: ${user.avatar_url}`);
  });
};
```

### Example 2: Resolve and Navigate

```typescript
const resolveAndNavigate = async (publicUrl: string) => {
  const response = await fetch(`/api/v1/discovery/resolve?url=${encodeURIComponent(publicUrl)}`);
  const resolved: DiscoveryResolveResponse = await response.json();
  
  if (!resolved.matched) {
    console.error('Resource not found');
    return;
  }
  
  // Navigate based on resource type
  switch (resolved.resourceType) {
    case 'TRACK':
      window.location.href = `/track/${resolved.id}?artist=${resolved.artist_handle}`;
      break;
    case 'USER':
      window.location.href = `/profile/${resolved.handle}`;
      break;
    case 'PLAYLIST':
      window.location.href = `/playlist/${resolved.id}`;
      break;
  }
};
```

---

## 5. Testing with Swagger UI

View the interactive API documentation:

**URL:** `http://localhost:3000/api/docs` (development) or your production Swagger URL

**Available endpoints in Discovery:**
- `GET /discovery/search` - Test search queries
- `GET /discovery/resolve` - Test URL resolution
- `GET /discovery/trending` - Get trending tracks (bonus feature)

### How to Test

1. Open Swagger UI at `/api/docs`
2. Navigate to the "Discovery" section
3. Click "Try it out" on any endpoint
4. Enter your parameters (e.g., `q=lofi` or `url=/nightowl/night-drive`)
5. Click "Execute" to see the full response with actual data

---

## 6. Migration Guide from Old API

### Before (Old)
```typescript
// Old resolver returned just an ID
const response = await fetch(`/api/v1/discovery/resolve?url=/nightowl/night-drive`);
const { resourceId } = await response.json();

// Needed a second request to fetch details
const trackDetails = await fetch(`/api/v1/tracks/${resourceId}`);
```

### After (New)
```typescript
// New resolver returns full resource
const response = await fetch(`/api/v1/discovery/resolve?url=/nightowl/night-drive`);
const { id, title, coverArt, genre, artist_handle } = await response.json();

// Can use data directly, no second request needed!
renderTrackCard({ title, coverArt, genre, artist_handle });
```

---

## 7. Field Naming Conventions

The DTOs use both camelCase and snake_case for compatibility:

| Use in TypeScript | Maps to | Use in UI |
|---|---|---|
| `coverArtUrl` | DB column `cover_art_url` | `coverArt` (provided alias) |
| `avatarUrl` | DB column `avatar_url` | `avatar_url` (provided alias) |
| `artist_handle` | Artist's handle | `artist_handle` (display as-is) |
| `owner_handle` | Playlist owner's handle | `owner_handle` (display as-is) |

---

## 8. Error Handling

### Validation Errors
```json
{
  "statusCode": 400,
  "message": "Query string too long",
  "error": "Bad Request"
}
```

### Resource Not Found
```json
{
  "matched": false,
  "resourceType": null
}
```

### Server Errors
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## 9. Performance Notes

- **Search** returns up to 50 results per category (tracks, users, playlists) by default
- **Resolver** is optimized to resolve most URLs in <100ms
- All responses include cover images and metadata inline (no follow-up requests needed)
- Use pagination if you implement "Load More" for search results

---

## 10. Questions or Issues?

- Check the Swagger docs at `/api/docs` for the most up-to-date schema
- Refer to `src/discovery/dto/discovery-response.dto.ts` in the backend repo for field definitions
- Contact the backend team for schema changes or clarifications

---

**Document Version:** 1.0  
**Last Updated:** April 29, 2026  
**Modules:** 8 (Search) & 11 (Reports Integration)
