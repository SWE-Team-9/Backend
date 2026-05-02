# AI Assistant — n8n Webhook Integration

## Overview

When `AI_PROVIDER=n8n`, the backend sends every chat message to an n8n webhook.
n8n runs an AI Agent node (OpenAI, Anthropic, etc.) and returns a structured intent JSON.
The backend validates and executes the intent — **n8n never touches the IQA3 database directly.**

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AI_PROVIDER` | yes | Set to `n8n` to enable this provider |
| `N8N_AI_WEBHOOK_URL` | yes | Full URL of the n8n webhook node (e.g. `https://your-n8n.com/webhook/iqa3-ai`) |
| `N8N_AI_WEBHOOK_SECRET` | recommended | Shared secret sent as `X-IQA3-AI-SECRET` header |

---

## Payload the Backend Sends (POST)

```json
{
  "message": "find sha3by tracks",
  "context": {
    "trackId": "uuid-or-null",
    "playlistId": "uuid-or-null",
    "currentPage": "discover"
  },
  "user": {
    "id": "user-uuid"
  },
  "allowedActions": [
    "faq_help",
    "search_tracks",
    "get_trending_tracks",
    "recommend_by_genre",
    "create_playlist",
    "list_my_playlists",
    "add_track_to_playlist",
    "create_playlist_from_genre",
    "create_playlist_from_artist_genre",
    "share_track_message",
    "queue_track_or_play_next",
    "profile_or_subscription_help",
    "unknown",
    "clarification_needed"
  ],
  "schemaVersion": 1
}
```

---

## Response Format n8n Must Return

```json
{
  "intent": "search_tracks",
  "parameters": {
    "query": "sha3by"
  },
  "confidence": 0.9,
  "needsConfirmation": false,
  "replyDraft": "Searching for sha3by tracks...",
  "clarifyingQuestion": null
}
```

### Field Rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `intent` | string | yes | Must be one of `allowedActions` — any other value triggers fallback to mock |
| `parameters` | object | yes | Intent-specific parameters (see below) |
| `confidence` | number 0-1 | yes | Below 0.5 → backend returns `clarification_needed` to user |
| `needsConfirmation` | boolean | yes | Pass `true` for destructive or ambiguous actions |
| `replyDraft` | string | no | Suggested reply text (backend may override) |
| `clarifyingQuestion` | string | no | Used when `confidence < 0.5` |

### Parameters by Intent

| Intent | Parameters |
|---|---|
| `search_tracks` | `{ "query": "string" }` |
| `recommend_by_genre` | `{ "genre": "sha3by", "limit": 5 }` |
| `create_playlist` | `{ "playlistName": "string" }` |
| `create_playlist_from_genre` | `{ "genre": "sha3by", "limit": 10, "playlistName": "My Sha3by", "allRequested": false }` |
| `create_playlist_from_artist_genre` | `{ "genre": "sha3by", "artist": "Ahmed" }` |
| `add_track_to_playlist` | `{ "trackId": "uuid", "playlistName": "string" }` |
| `share_track_message` | `{ "recipient": "username", "trackId": "uuid" }` |
| `queue_track_or_play_next` | `{ "trackId": "uuid" }` |
| `faq_help` | `{ "originalMessage": "full user message" }` |
| `get_trending_tracks` | `{}` |
| `list_my_playlists` | `{}` |
| `profile_or_subscription_help` | `{}` |

---

## n8n Workflow Setup

### Step 1: Webhook Node

- Method: POST
- Authentication: Header Auth → name `X-IQA3-AI-SECRET`, value from your secret
- Response Mode: "Last Node"

### Step 2: Validate Secret (optional but recommended)

Add an IF node:
```
{{ $headers['x-iqa3-ai-secret'] === $env.IQA3_AI_SECRET }}
```

If false → return HTTP 401.

### Step 3: AI Agent Node (e.g. OpenAI GPT-4o-mini)

System prompt example:

```
You are a music streaming assistant for IQA3.
The user message is: {{ $json.message }}
The user context is: {{ JSON.stringify($json.context) }}
Allowed intents: {{ $json.allowedActions.join(', ') }}

Respond with ONLY valid JSON matching this schema:
{
  "intent": "<one of the allowed intents>",
  "parameters": {},
  "confidence": <0.0 to 1.0>,
  "needsConfirmation": false,
  "replyDraft": "<optional short reply>",
  "clarifyingQuestion": "<only if confidence < 0.5>"
}

Rules:
- NEVER return an intent not in the allowedActions list.
- NEVER include user PII, passwords, payment data, or database queries.
- If unsure, return intent "clarification_needed" with confidence 0.3.
```

### Step 4: Response Node

Return the AI Agent's JSON output as the HTTP response body (200 OK).

---

## Security

- Always validate `X-IQA3-AI-SECRET` before processing.
- The backend whitelists all returned intents against `ALLOWED_INTENTS` — any injection attempt returns `unknown`.
- Confidence below 0.5 triggers a clarifying question, never an action.
- n8n must NEVER write to the IQA3 PostgreSQL database directly. All data mutations happen through the NestJS backend after intent validation.
- Do not log the full user message in n8n to avoid storing PII in workflow logs.

---

## Fallback Behavior

If the n8n webhook is unreachable, returns a non-2xx status, times out (10 s), or returns an invalid/unknown intent, the backend automatically falls back to the built-in mock provider. Users will always get a response.
