# Frontend Integration Guide (Module 8)

This guide summarizes the Feed, Search, and Discovery endpoints for frontend integration.

## 1) Activity Feed

### Method and URL
`GET /feed`

### Auth
Requires authenticated user (JWT/cookie auth).

### Query Parameters
- `limit` (optional, number, default: `20`, min: `1`, max: `100`)
- `page` (optional, number, default: `1`)
- `offset` (optional, number, overrides page-based offset)

### Sample Response
```json
{
  "data": [
    {
      "id": "3f4e26a8-ecf3-4c54-98f5-7e3bc0f1f611",
      "title": "Night Drive",
      "slug": "night-drive",
      "description": "Lo-fi synthwave session",
      "coverArtUrl": "https://cdn.example.com/covers/night-drive.jpg",
      "createdAt": "2026-04-28T20:10:11.000Z",
      "publishedAt": "2026-04-28T20:15:00.000Z",
      "uploaderId": "d2f18280-4c5e-4f41-b273-c59fdb3f0aab",
      "uploader": {
        "profile": {
          "handle": "retroartist",
          "displayName": "Retro Artist",
          "avatarUrl": "https://cdn.example.com/avatars/retroartist.jpg"
        }
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "offset": 0,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

---

## 2) Global Full-Text Search

### Method and URL
`GET /discovery/search`

### Auth
Public endpoint.

### Query Parameters
- `q` (required, string, max length: `120`)

### Search Behavior
Uses high-performance PostgreSQL full-text matching (optimized with GIN/trigram indexes) across title and description fields for Tracks and Playlists, and handle/display name fields for Users.

### Sample Response
```json
{
  "query": "lofi chill",
  "results": {
    "tracks": [
      {
        "id": "e7f87f4d-50df-4db6-a589-4dc090e88f8d",
        "title": "Lofi Chill Session",
        "slug": "lofi-chill-session",
        "description": "Warm tape textures and mellow drums",
        "coverArtUrl": "https://cdn.example.com/covers/lofi.jpg",
        "uploaderId": "0d2f7082-f4d5-4a8f-93fd-849b12fc2ab1",
        "uploader": {
          "profile": {
            "handle": "lofiroom",
            "displayName": "Lofi Room"
          }
        }
      }
    ],
    "users": [
      {
        "userId": "0d2f7082-f4d5-4a8f-93fd-849b12fc2ab1",
        "handle": "lofiroom",
        "displayName": "Lofi Room",
        "avatarUrl": "https://cdn.example.com/avatars/lofiroom.png",
        "bio": "Daily chill uploads"
      }
    ],
    "playlists": [
      {
        "id": "b1f81eef-f38c-4f95-98a6-2e9af1adf730",
        "ownerId": "0d2f7082-f4d5-4a8f-93fd-849b12fc2ab1",
        "title": "Late Night Lofi",
        "slug": "late-night-lofi",
        "description": "Slow and relaxed night mix",
        "coverArtUrl": "https://cdn.example.com/playlists/late-night-lofi.jpg",
        "owner": {
          "profile": {
            "handle": "lofiroom",
            "displayName": "Lofi Room"
          }
        }
      }
    ]
  },
  "totals": {
    "tracks": 1,
    "users": 1,
    "playlists": 1
  }
}
```

---

## 3) Trending and Charts

### Method and URL
`GET /discovery/trending`

### Auth
Public endpoint.

### Query Parameters
- `limit` (optional, number, default: `20`, min: `1`, max: `100`)
- `windowDays` (optional, number, default: `7`, min: `1`, max: `30`)

### Sample Response
```json
{
  "windowDays": 7,
  "items": [
    {
      "id": "f131a31f-ae34-47da-9bbb-d3219ea32d57",
      "title": "Midnight Waves",
      "slug": "midnight-waves",
      "coverArtUrl": "https://cdn.example.com/covers/midnight-waves.jpg",
      "uploaderId": "fce1a8d6-f56c-4d31-93f9-22a62cb7b2b9",
      "uploader": {
        "userId": "fce1a8d6-f56c-4d31-93f9-22a62cb7b2b9",
        "handle": "waveform",
        "displayName": "Waveform"
      },
      "recentPlays": 420,
      "recentLikes": 133,
      "velocityScore": 686
    }
  ]
}
```

---

## 4) Resource Resolver

### Method and URL
`GET /discovery/resolve`

### Auth
Public endpoint.

### Query Parameters
- `url` (required, string, max length: `512`)
- Supported examples:
  - `/handle`
  - `/handle/track-slug`
  - `/handle/sets/playlist-slug`

### Sample Response (User)
```json
{
  "matched": true,
  "resourceType": "USER",
  "id": "0d2f7082-f4d5-4a8f-93fd-849b12fc2ab1",
  "handle": "lofiroom"
}
```

### Sample Response (Track)
```json
{
  "matched": true,
  "resourceType": "TRACK",
  "id": "e7f87f4d-50df-4db6-a589-4dc090e88f8d",
  "slug": "lofi-chill-session"
}
```

### Sample Response (Playlist)
```json
{
  "matched": true,
  "resourceType": "PLAYLIST",
  "id": "b1f81eef-f38c-4f95-98a6-2e9af1adf730",
  "slug": "late-night-lofi"
}
```

### Sample Response (Not Found)
```json
{
  "matched": false
}
```
