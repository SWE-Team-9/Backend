#!/usr/bin/env node
/**
 * ClickUp Sprint Generator — IQA3 Backend (M7–M12)
 * ─────────────────────────────────────────────────────────
 * Creates Sprints 7–10 as ClickUp Lists, with tasks assigned
 * to each team member using their ClickUp User ID.
 *
 * TEAM DIVISION:
 *  Mohannad  → M12 (Subscriptions + Upload Guard)
 *              + M11 Admin Stats
 *              + M11 User Enforcement (warn/suspend/ban/restore)
 *              + M11 Admin User Management (users list, detail, audit log)
 *              + Security Lead across ALL sprints
 *  Farah     → M7 (Sets & Playlists — full module)
 *  Mohammed  → M8 (Feed, Search & Discovery)
 *              + M11 Reports, Appeals & Analytics
 *  Yahia     → M9 (Messaging + WebSocket — full module)
 *  Heikal    → M10 (Notifications + WebSocket + Listener)
 *              + M11 Content Moderation
 *
 * WORKLOAD BALANCE:
 *  Mohannad  13 endpoints + upload guard + security reviews all 4 sprints
 *  Farah     10 endpoints (full playlist module)
 *  Mohammed  11 endpoints
 *  Yahia      8 endpoints + WebSocket gateway
 *  Heikal    12 endpoints + WebSocket gateway + listener
 *
 * USAGE:
 *  node generate-sprints.js
 *  → fetches your workspace members from ClickUp
 *  → lets you map each dev to their ClickUp account
 *  → creates sprints with tasks assigned + due dates set
 *
 * REQUIREMENTS:
 *  Node.js 18+  (no npm install — uses built-in https + readline)
 *  ClickUp API token — Settings → Apps → API Token
 *  Folder ID — open the target folder in ClickUp, copy ID from URL
 */

'use strict';
const https    = require('https');
const readline = require('readline');

// ─── Low-level API client ─────────────────────────────────────────────────────

let _autoQueue = null;
function ask(rl, prompt) {
  if (_autoQueue) {
    const ans = (_autoQueue.shift() || '').trim();
    process.stdout.write(prompt + ans + '\n');
    return Promise.resolve(ans);
  }
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiCall(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const data    = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'api.clickup.com',
      path:     `/api/v2${path}`,
      method,
      headers: {
        Authorization:  token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} — ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── ClickUp entity creators ──────────────────────────────────────────────────

async function createList(token, folderId, { name, dueDate }) {
  process.stdout.write(`  Creating list: "${name}" ... `);
  const body = { name, content: '' };
  if (dueDate) body.due_date = dueDate;
  const res = await apiCall(token, 'POST', `/folder/${folderId}/list`, body);
  console.log(`OK (id: ${res.id})`);
  return res.id;
}

async function createTask(token, listId, { name, description, priority = 2, assignees = [], dueDate }) {
  const body = { name, description, priority };
  if (assignees.length > 0)  body.assignees     = assignees;
  if (dueDate)               body.due_date       = dueDate;
  if (dueDate)               body.due_date_time  = false;
  const res = await apiCall(token, 'POST', `/list/${listId}/task`, body);
  return res.id;
}

async function createSubtask(token, listId, parentId, { name, description, priority = 3, assignees = [] }) {
  const body = { name, description, priority, parent: parentId };
  if (assignees.length > 0) body.assignees = assignees;
  await apiCall(token, 'POST', `/list/${listId}/task`, body);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Unix ms for end-of-day N days after startMs (1-based: daysOffset=2 → end of day 2) */
function endOfDay(startMs, daysOffset) {
  const d = new Date(startMs);
  d.setDate(d.getDate() + (daysOffset - 1));
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseDate(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: "${str}"`);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ─── Member setup ─────────────────────────────────────────────────────────────

const DEVS = [
  { key: 'mohannad', label: 'Mohannad', role: 'Security Lead + M12 + M11 Admin Stats + M11 User Enforcement + M11 Admin User Management' },
  { key: 'farah',    label: 'Farah',    role: 'M7 — Sets & Playlists (full)' },
  { key: 'mohammed', label: 'Mohammed', role: 'M8 + M11 Reports & Analytics' },
  { key: 'yahia',    label: 'Yahia',    role: 'M9 (Messaging + WebSocket — full module)' },
  { key: 'heikal',   label: 'Heikal',   role: 'M10 (Notifications) + M11 Content Moderation' },
];

async function selectMembers(rl, token) {
  // Fetch workspace members
  console.log('\nFetching workspace members from ClickUp...');
  const res = await apiCall(token, 'GET', '/team', null);
  const teams = (res.teams || []);
  if (teams.length === 0) throw new Error('No workspaces found for this token.');

  let team;
  if (teams.length === 1) {
    team = teams[0];
    console.log(`    Workspace: "${team.name}"`);
  } else {
    console.log('\nMultiple workspaces found:');
    teams.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
    const idx = parseInt(await ask(rl, 'Select workspace number: '), 10) - 1;
    team = teams[Math.max(0, Math.min(idx, teams.length - 1))];
  }

  const members = (team.members || []).map((m) => m.user);
  if (members.length === 0) throw new Error('No members found in the workspace.');

  console.log('\nWorkspace members:');
  members.forEach((m, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${m.username || m.email}  (id: ${m.id})`),
  );

  // Map each dev to a ClickUp user
  console.log('\nFor each team member, enter the NUMBER from the list above.');
  console.log('Press ENTER to skip (task will be unassigned).\n');

  const TEAM = {};
  for (const dev of DEVS) {
    const answer = await ask(rl, `  ${dev.label.padEnd(10)} [${dev.role}] → `);
    if (answer === '') {
      TEAM[dev.key] = { label: dev.label, userId: null };
    } else {
      const idx = parseInt(answer, 10) - 1;
      const member = members[idx];
      if (!member) {
        console.log(`    [!] Invalid selection — "${dev.label}" will be unassigned.`);
        TEAM[dev.key] = { label: dev.label, userId: null };
      } else {
        TEAM[dev.key] = { label: dev.label, userId: member.id };
        console.log(`    OK  Assigned: ${member.username || member.email}`);
      }
    }
  }

  return TEAM;
}

// ─── Sprint data ──────────────────────────────────────────────────────────────
//
// a(key) returns the assignees array for a team member key.
// Descriptions use ClickUp Markdown (## headings, tables, code blocks, - bullets).

function getSprints(TEAM, startMs) {
  const a  = (key) => (TEAM[key]?.userId ? [TEAM[key].userId] : []);
  const due = {
    s7:  endOfDay(startMs, 2),
    s8:  endOfDay(startMs, 4),
    s9:  endOfDay(startMs, 5),
    s10: endOfDay(startMs, 7),
  };

  return [

    // ═══════════════════════════════════════════════════════════════════════════
    //  SPRINT 7 — Foundation & Primary Endpoints            Days 1–2
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name:    `Sprint 7 — Foundation & Primary Endpoints  [Days 1–2 · Due ${shortDate(due.s7)}]`,
      dueDate: due.s7,
      tasks: [

        // ── MOHANNAD ─────────────────────────────────────────────────────────
        {
          assignee: 'mohannad', priority: 1, dueDate: due.s7,
          name: '[M12 + Security] Mohannad — Subscriptions Core & Sprint 7 Security Baseline',
          description:
`## Overview
Implement M12 (Subscriptions & Upload Guard) and establish the global security baseline for the entire project. You are the **Security Lead** — all other modules ship through you for security review.

## Why You
You built M4 (Tracks). The upload quota guard injects directly into \`TracksService.uploadTrack()\`. As Security Lead you also own user enforcement (warn/suspend/ban/restore) — the most security-sensitive admin actions in the entire application.

## M12 — Endpoints

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | GET | /api/v1/subscriptions/me | JWT |
| 2 | POST | /api/v1/subscriptions/subscribe | JWT |
| 3 | GET | /api/v1/subscriptions/offline/:trackId | JWT |
| 4 | — | Upload Guard in TracksService | — |

**Prisma model:** \`UserSubscription { userId, subscriptionType: FREE\|PRO\|GO_PLUS, uploadLimit: Int, currentPeriodEnd: DateTime? }\`

## Security Baseline (Sprint 7)
- \`app.use(helmet())\` in main.ts
- CORS: \`origin: process.env.FRONTEND_URL\` (not \`*\`)
- Global ValidationPipe: \`whitelist: true, forbidNonWhitelisted: true, transform: true\`
- Throttler: verify Redis storage is wired for production
- Audit all M1–6 controller guards → log findings in AUTHENTICATION-AUDIT-REPORT.json

## Definition of Done
- [ ] GET /me returns FREE defaults when no subscription record exists
- [ ] Upload guard throws \`403 UPLOAD_LIMIT_REACHED\` at quota
- [ ] Helmet + CORS hardening committed to main.ts
- [ ] Sprint 7 security findings documented`,
          subtasks: [
            {
              name: 'M12: Scaffold subscriptions module + DTOs + Prisma model',
              description:
`Create \`src/subscriptions/\`:
- subscriptions.module.ts (imports PrismaModule)
- subscriptions.controller.ts (@ApiTags('Subscriptions') @ApiBearerAuth() @Controller('subscriptions'))
- subscriptions.service.ts (inject PrismaService)
- dto/subscribe.dto.ts: subscriptionType (PRO | GO_PLUS, required), paymentMethodId (string 1–100)

Prisma — add/verify model:
\`\`\`prisma
model UserSubscription {
  userId           String   @id @map("user_id")
  subscriptionType String   @default("FREE")
  uploadLimit      Int      @default(3)
  currentPeriodEnd DateTime?
  user             User     @relation(fields: [userId], references: [id])
}
\`\`\`

Register SubscriptionsModule in app.module.ts.`,
            },
            {
              name: 'M12: GET /subscriptions/me — Current Subscription Status',
              description:
`**Auth:** JwtAuthGuard

Logic:
1. \`upsert\` UserSubscription by userId (create FREE defaults if missing)
2. \`COUNT\` Track where uploaderId = userId AND deletedAt IS NULL → uploadedTracks
3. remainingUploads = uploadLimit − uploadedTracks

**Response (200):**
\`\`\`json
{
  "userId": "...",
  "subscriptionType": "FREE",
  "uploadLimit": 3,
  "uploadedTracks": 1,
  "remainingUploads": 2,
  "perks": { "adFree": false, "offlineListening": false }
}
\`\`\`

Perks by tier: FREE → all false | PRO → adFree + offlineListening true | GO_PLUS → all true`,
            },
            {
              name: 'M12: POST /subscribe + GET /offline/:trackId',
              description:
`**POST /api/v1/subscriptions/subscribe** — Auth: JWT
Body: { subscriptionType: "PRO" | "GO_PLUS", paymentMethodId: string }
- Log paymentMethodId (mock payment — no Stripe call)
- Upsert: PRO → uploadLimit 100 | GO_PLUS → uploadLimit 1000 | currentPeriodEnd = now + 30d
- Return same shape as GET /me

**GET /api/v1/subscriptions/offline/:trackId** — Auth: JWT
1. Subscription type === FREE → 403 "Premium subscription required for offline listening."
2. Fetch track + TrackFile (STREAM key)
3. S3: generate presigned URL (GetObjectCommand, TTL 3600 s)
4. Local: return direct URL

**Response:** \`{ trackId, title, artist, downloadUrl }\``,
            },
            {
              name: 'M12: Upload Guard — inject quota check into TracksService.uploadTrack()',
              description:
`In \`src/tracks/tracks.service.ts\` → inside \`uploadTrack()\`, **at the very top** before any S3 or DB write:

\`\`\`typescript
const sub = await this.prisma.userSubscription.upsert({
  where: { userId },
  update: {},
  create: { userId, subscriptionType: 'FREE', uploadLimit: 3 },
});
const uploadedCount = await this.prisma.track.count({
  where: { uploaderId: userId, deletedAt: null },
});
if (uploadedCount >= sub.uploadLimit) {
  throw new ForbiddenException({
    code: 'UPLOAD_LIMIT_REACHED',
    message: 'You have reached your upload limit. Upgrade your plan to upload more tracks.',
  });
}
\`\`\``,
            },
            {
              name: 'SEC: Sprint 7 — Global Security Baseline Audit',
              description:
`**1. main.ts hardening**
\`\`\`typescript
import helmet from 'helmet';
app.use(helmet());
app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
\`\`\`

**2. Global ValidationPipe**
Confirm in main.ts: \`app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))\`

**3. Controller guard audit (M1–M6)**
Run: \`grep -rn "@Controller" src/ --include="*.controller.ts"\`
For each controller: verify every route has JwtAuthGuard OR explicit @Public() decorator.
Flag any that are accidentally public → document in AUTHENTICATION-AUDIT-REPORT.json.

**4. Throttler verification**
Check ThrottlerModule config in app.module.ts — ensure sensitive endpoints (auth, reports) have @Throttle() applied.

**Deliverable:** Commit updated main.ts + updated AUTHENTICATION-AUDIT-REPORT.json`,
            },
          ],
        },

        // ── FARAH ─────────────────────────────────────────────────────────────
        {
          assignee: 'farah', priority: 2, dueDate: due.s7,
          name: '[M7] Farah — Sets & Playlists Core CRUD',
          description:
`## Overview
Scaffold the Playlists module and implement all core CRUD endpoints plus the "my playlists" listing.

## Why You
You built M3 (Social Graph — follow/block). Playlists are social objects with visibility rules, secret-link sharing, and owner-only mutations — the exact same ownership and privacy patterns you implemented in the follow system.

## Endpoints (Sprint 7)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | POST | /api/v1/playlists | JWT |
| 2 | GET | /api/v1/playlists/me | JWT |
| 3 | GET | /api/v1/playlists/:id | Public* |
| 4 | PATCH | /api/v1/playlists/:id | JWT (owner) |
| 5 | DELETE | /api/v1/playlists/:id | JWT (owner) |

*Privacy-enforced: PRIVATE/SECRET hidden from non-owners.

**Prisma models:**
- \`Playlist\`: id, title, description, visibility (PUBLIC\|PRIVATE\|SECRET), secretToken, ownerId, deletedAt
- \`PlaylistTrack\`: playlistId, trackId, position (Int), addedAt

## Definition of Done
- [ ] POST: SECRET visibility auto-generates secretToken via nanoid(24)
- [ ] GET /:id: PRIVATE playlist returns 404 for non-owner (not 403)
- [ ] PATCH/DELETE: non-owner gets 403 NOT_OWNER
- [ ] GET /me: route declared BEFORE /:id (avoid "me" matching as UUID param)
- [ ] \`npx tsc --noEmit\` passes`,
          subtasks: [
            {
              name: 'M7: Scaffold playlists.module, controller, service + DTOs',
              description:
`Create \`src/playlists/\`:
- playlists.module.ts (imports PrismaModule)
- playlists.controller.ts (@ApiTags('Playlists') @ApiBearerAuth() @Controller('playlists'))
- playlists.service.ts (inject PrismaService)
- dto/create-playlist.dto.ts: title (@IsString, @MaxLength(100)), description? (@MaxLength(2000)), visibility (@IsEnum PUBLIC|PRIVATE|SECRET)
- dto/update-playlist.dto.ts: PartialType(CreatePlaylistDto)

Run: \`npx prisma migrate dev --name add_playlists\`
Register PlaylistsModule in app.module.ts.`,
            },
            {
              name: 'M7: POST /playlists — Create + GET /playlists/me — My Playlists',
              description:
`**POST /api/v1/playlists** — Auth: JWT
- If visibility = SECRET → secretToken = nanoid(24), else secretToken = null
- INSERT Playlist with ownerId = req.user.userId
- 201: \`{ playlistId, title, visibility, secretToken: string | null }\`

---

**GET /api/v1/playlists/me** — Auth: JWT | Query: page=1, limit=20
[!] Declare \`@Get('me')\` BEFORE \`@Get(':playlistId')\` in the controller.
- WHERE ownerId = userId AND deletedAt IS NULL
- Include \_count: { tracks: true }
- Order by createdAt DESC
- 200: \`{ page, limit, total, playlists: [{ playlistId, title, visibility, tracksCount, createdAt }] }\``,
            },
            {
              name: 'M7: GET /playlists/:id — Get Playlist Details',
              description:
`**Auth:** Public (privacy-enforced)

Privacy rules:
- visibility = PRIVATE AND requester !== owner → **404 NOT_FOUND** (not 403, do not reveal existence)
- visibility = SECRET → accessible only via /secret/:token OR if requester is owner
- visibility = PUBLIC → open to all

Include in response:
- owner: { id, displayName, handle }
- tracks: ordered by PlaylistTrack.position ASC → each: { trackId, title, coverArtUrl, durationMs, artist }
- tracksCount

**200:** full playlist object | **404:** NOT_FOUND`,
            },
            {
              name: 'M7: PATCH /playlists/:id — Update + DELETE /playlists/:id — Delete',
              description:
`**PATCH /api/v1/playlists/:playlistId** — Auth: JWT (owner only)
- Fetch playlist → if ownerId !== req.user.userId → **403 NOT_OWNER**
- If switching TO SECRET and secretToken is null → generate nanoid(24)
- If switching FROM SECRET to PUBLIC/PRIVATE → set secretToken = null
- 200: \`{ message: "Playlist updated successfully" }\`

---

**DELETE /api/v1/playlists/:playlistId** — Auth: JWT (owner only)
- Verify owner → 403 if not
- Delete all PlaylistTrack records for this playlist (or cascade)
- Hard delete Playlist (or set deletedAt = now())
- **204:** No Content`,
            },
          ],
        },

        // ── MOHAMMED ─────────────────────────────────────────────────────────
        {
          assignee: 'mohammed', priority: 2, dueDate: due.s7,
          name: '[M8] Mohammed — Feed, Search & Discovery Core',
          description:
`## Overview
Scaffold and implement the Activity Feed and Discovery endpoints (search, trending, permalink resolver).

## Why You
You built M6 (Engagement — likes, reposts, comments). The activity feed is a stream of those exact engagement actions from followed users. Trending scores are computed from the play/like/repost counts you know best.

## Endpoints (Sprint 7)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | GET | /api/v1/feed | JWT |
| 2 | GET | /api/v1/discovery/search | Public |
| 3 | GET | /api/v1/discovery/trending | Public |
| 4 | GET | /api/v1/discovery/resolve | Public |

**Cross-module note:** GET /feed reads the Follow table (Farah's M3 work). Coordinate if you need the model name/field names.

## Definition of Done
- [ ] GET /feed returns \`{ data: [] }\` for user with no follows (NOT 404)
- [ ] GET /discovery/search runs track + user + playlist queries in parallel (Promise.all)
- [ ] GET /discovery/trending sorts by computed score DESC
- [ ] GET /discovery/resolve handles both \`/handle\` and \`/handle/slug\` formats`,
          subtasks: [
            {
              name: 'M8: Scaffold feed.module + discovery.module, controllers, services + DTOs',
              description:
`Create \`src/feed/\` and \`src/discovery/\`:

**FeedModule:** feed.controller.ts (@Controller('feed')), feed.service.ts
**DiscoveryModule:** discovery.controller.ts (@Controller('discovery')), discovery.service.ts

DTOs:
- \`PaginationQueryDto\`: page (default 1), limit (default 20, max 100)
- \`SearchQueryDto\` extends PaginationQueryDto: q (@IsString @MinLength(1) required), type? (track|user|playlist|all), genre?, uploaded_after? (ISO date string)

Prisma — verify/create \`FeedActivity\`:
\`{ id, actorId, actionType: UPLOAD|REPOST, trackId, createdAt }\`

Register both modules in app.module.ts.`,
            },
            {
              name: 'M8: GET /feed — Activity Feed (Chronological)',
              description:
`**Auth:** JWT | Query: page=1, limit=20

Logic:
1. Get followingIds: WHERE followerId = userId in Follow table
2. If empty → return \`{ data: [], meta: { current_page: 1, total_pages: 0 } }\`
3. Query FeedActivity WHERE actorId IN followingIds
4. Exclude tracks with visibility = PRIVATE that requester does not own
5. Order by createdAt DESC, paginate

**200 Response:**
\`\`\`json
{
  "data": [{
    "feed_id": "...",
    "action_type": "UPLOAD",
    "actor": { "id": "...", "handle": "..." },
    "track": { "id": "...", "title": "...", "coverArtUrl": "..." },
    "created_at": "..."
  }],
  "meta": { "current_page": 1, "total_pages": 3 }
}
\`\`\`

**Coordination:** Ask Mohannad (TracksService) to emit a FeedActivity record on track upload. Ask Yahia (InteractionsService) to emit on repost.`,
            },
            {
              name: 'M8: GET /discovery/search — Full-Text Search',
              description:
`**Auth:** None | Query: q (required), type, genre, uploaded_after, page, limit

Implementation:
- Use Prisma: \`{ title: { contains: q, mode: 'insensitive' } }\`
- Run queries **in parallel**: \`Promise.all([tracksQuery, usersQuery, playlistsQuery])\`
- Skip queries not needed by \`type\` param (e.g. type="track" → skip users + playlists)
- Genre filter: \`{ primaryGenre: { name: genre } }\`
- Date filter: \`{ publishedAt: { gte: new Date(uploaded_after) } }\`
- Playlists: visibility = PUBLIC only

**200 Response:**
\`\`\`json
{
  "data": { "tracks": [...], "users": [...], "playlists": [...] },
  "meta": { "current_page": 1, "total_results": 42, "total_pages": 3 }
}
\`\`\``,
            },
            {
              name: 'M8: GET /discovery/trending + GET /discovery/resolve',
              description:
`**GET /discovery/trending** — Auth: None | Query: genre?, limit=50

Trending score (last 7 days):
\`score = play_count + (likes_count × 3) + (reposts_count × 2)\`

- Query Track WHERE status=FINISHED AND visibility=PUBLIC
- Use \`\_count\` for likes/reposts; count PlayEvent WHERE startedAt > 7 days ago
- Sort by score DESC, apply limit + optional genre filter

---

**GET /discovery/resolve** — Auth: None | Query: permalink (e.g. \`/ahmed-beats/layali\`)

Logic:
1. Validate: must start with "/" and contain at least one "/"
2. Split: \`[handle, slug] = permalink.replace(/^\\//, '').split('/')\`
3. Find UserProfile by handle → 404 if missing
4. If slug: find Track by slug + uploaderId → return type="TRACK"
5. Else: return type="USER"

**400:** malformed permalink | **404:** NOT_FOUND`,
            },
          ],
        },

        // ── YAHIA ─────────────────────────────────────────────────────────────
        {
          assignee: 'yahia', priority: 2, dueDate: due.s7,
          name: '[M9] Yahia — Messaging Core REST Endpoints',
          description:
`## Overview
Scaffold the Messaging module and implement all REST endpoints. The WebSocket real-time gateway is Sprint 8.

## Why You
You built M3 (follow/block — block rules govern who can message) and M6 (track interactions — shared in messages). You understand both layers that messaging depends on.

## Endpoints (Sprint 7)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | GET | /api/v1/messages/conversations | JWT |
| 2 | GET | /api/v1/messages/conversations/:id | JWT |
| 3 | POST | /api/v1/messages | JWT |
| 4 | GET | /api/v1/messages/unread-count | JWT |

**Dependency note:** POST /messages/share/playlist (Sprint 8) requires Farah's Playlist model to be ready.

## Definition of Done
- [ ] POST /messages: blocked user → 403 BLOCKED\_USER
- [ ] GET /conversations/:id: non-participant → 403 ACCESS\_DENIED
- [ ] Find-or-create Conversation logic is correct (no duplicate conversations)
- [ ] GET /unread-count returns accurate count`,
          subtasks: [
            {
              name: 'M9: Scaffold messages.module, controller, service + Prisma models',
              description:
`Create \`src/messages/\`:
- messages.module.ts (imports PrismaModule)
- messages.controller.ts (@ApiTags('Messages') @ApiBearerAuth() @Controller('messages'))
- messages.service.ts (inject PrismaService)
- messages.gateway.ts (stub — full implementation Sprint 8)
- dto/send-message.dto.ts: receiverId (UUID), text (@MinLength(1) @MaxLength(2000))
- dto/share-track.dto.ts: receiverId (UUID), trackId (UUID), text? (max 2000)
- dto/share-playlist.dto.ts: receiverId (UUID), playlistId (UUID), text? (max 2000)

Prisma — verify/create:
\`\`\`prisma
model Conversation {
  id             String    @id @default(uuid())
  participant1Id String
  participant2Id String
  lastMessageId  String?
  lastActivityAt DateTime  @default(now())
}
model Message {
  id               String   @id @default(uuid())
  conversationId   String
  senderId         String
  receiverId       String
  type             String   // TEXT | TRACK_SHARE | PLAYLIST_SHARE
  text             String?
  sharedTrackId    String?
  sharedPlaylistId String?
  isRead           Boolean  @default(false)
  createdAt        DateTime @default(now())
  deletedAt        DateTime?
}
\`\`\``,
            },
            {
              name: 'M9: GET /messages/conversations — List Conversations',
              description:
`**Auth:** JWT | Query: page=1, limit=20

Logic:
- Find all Conversations WHERE participant1Id = userId OR participant2Id = userId
- For each: resolve the OTHER participant's profile (id, displayName, handle, avatarUrl)
- Include lastMessage: \`{ id, type, text, createdAt }\`
- Include unreadCount: COUNT Messages WHERE receiverId = userId AND isRead = false AND conversationId = conv.id
- Order by lastActivityAt DESC

**200:** \`{ page, limit, total, conversations: [{ conversationId, participant, lastMessage, unreadCount }] }\``,
            },
            {
              name: 'M9: GET /messages/conversations/:id — Messages in Conversation',
              description:
`**Auth:** JWT | Query: page=1, limit=50

Logic:
1. Fetch Conversation by id → 404 if not found
2. Verify userId === participant1Id OR participant2Id → **403 ACCESS\_DENIED** if not
3. Fetch paginated Messages WHERE conversationId = id AND deletedAt IS NULL
4. Order by createdAt ASC (oldest first for chat UI)
5. For TRACK\_SHARE: include \`sharedTrack: { id, title, artist }\`
6. For PLAYLIST\_SHARE: include \`sharedPlaylist: { id, title, tracksCount }\`

**200:** \`{ conversationId, page, limit, messages: [...] }\` | **403** | **404**`,
            },
            {
              name: 'M9: POST /messages — Send Text Message + GET /unread-count',
              description:
`**POST /api/v1/messages** — Auth: JWT | Body: SendMessageDto

Logic:
1. Block check: query UserBlock WHERE (blockerId=userId AND blockedId=receiverId) OR (blockerId=receiverId AND blockedId=userId) → **403 BLOCKED\_USER** if found
2. Find Conversation WHERE (participant1Id=userId AND participant2Id=receiverId) OR reverse → create if none
3. Create Message: { type: TEXT, senderId, receiverId, conversationId, text, isRead: false }
4. Update Conversation: { lastMessageId, lastActivityAt: new Date() }
5. [Sprint 8 stub] gateway.notifyNewMessage(conversationId, message)

**201:** \`{ messageId, conversationId, type: "TEXT", text, createdAt }\`

---

**GET /api/v1/messages/unread-count** — Auth: JWT
COUNT Messages WHERE receiverId = userId AND isRead = false AND deletedAt IS NULL
**200:** \`{ count: number }\``,
            },
          ],
        },

        // ── HEIKAL ────────────────────────────────────────────────────────────
        {
          assignee: 'heikal', priority: 2, dueDate: due.s7,
          name: '[M10] Heikal — Notifications Core REST & Listener Stubs',
          description:
`## Overview
Scaffold the Notifications module, implement all REST endpoints, and create the EventEmitter2 listener stubs that other devs depend on.

## Why You
You built M5 (Playback & Streaming) using event-driven patterns. Notifications use the same EventEmitter2 architecture. Your experience with @OnEvent decorators and real-time socket emissions maps directly here.

## [!] CRITICAL — Listener Stubs Due End of Day 2
Mohammed (M11 reports) and Yahia (M9 messages) will emit events your listener needs to catch. Get the stubs merged before they start emitting or notifications will silently fail.

## Endpoints (Sprint 7)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | GET | /api/v1/notifications | JWT |
| 2 | GET | /api/v1/notifications/unread-count | JWT |
| 3 | PATCH | /api/v1/notifications/:id/read | JWT |
| 4 | PATCH | /api/v1/notifications/read-all | JWT |
| 5 | DELETE | /api/v1/notifications/:id | JWT |
| 6 | GET | /api/v1/notifications/preferences | JWT |
| 7 | PUT | /api/v1/notifications/preferences | JWT |
| 8 | POST | /api/v1/notifications/push/register | JWT |
| 9 | DELETE | /api/v1/notifications/push/:deviceId | JWT |

## Definition of Done
- [ ] GET /notifications supports \`type\` + \`isRead\` filters
- [ ] PATCH /:id/read: ownership enforced (403)
- [ ] Route ordering: \`read-all\` declared BEFORE \`:id\` to avoid param collision
- [ ] Listener stubs handle: track.liked, user.followed, track.commented, track.reposted, report.created`,
          subtasks: [
            {
              name: 'M10: Scaffold notifications.module, controller, service, listener + Prisma models',
              description:
`Create \`src/notifications/\`:
- notifications.module.ts (imports PrismaModule, EventEmitterModule)
- notifications.controller.ts (@ApiTags('Notifications') @ApiBearerAuth() @Controller('notifications'))
- notifications.service.ts (inject PrismaService + EventEmitter2)
- notifications.listener.ts (stub — see subtask below)
- dto/notification-query.dto.ts: page, limit, type? (like|comment|follow|repost), isRead? (boolean)
- dto/update-preferences.dto.ts: likes?, comments?, follows?, reposts? (all optional boolean)
- dto/push-register.dto.ts: deviceToken (string), platform (ios|android|web)

Prisma — verify/create:
\`\`\`prisma
model Notification {
  id         String   @id @default(uuid())
  userId     String
  type       String   // like | comment | follow | repost | report | system
  message    String
  actorId    String?
  entityType String?  // track | comment | playlist
  entityId   String?
  isRead     Boolean  @default(false)
  createdAt  DateTime @default(now())
}
model NotificationPreference {
  userId   String  @id
  likes    Boolean @default(true)
  comments Boolean @default(true)
  follows  Boolean @default(true)
  reposts  Boolean @default(true)
}
model PushDevice {
  id          String   @id @default(uuid())
  userId      String
  deviceToken String   @unique
  platform    String   // ios | android | web
  createdAt   DateTime @default(now())
}
\`\`\``,
            },
            {
              name: 'M10: GET /notifications + GET /notifications/unread-count',
              description:
`**GET /api/v1/notifications** — Auth: JWT | Query: page=1, limit=20, type?, isRead?

Logic:
- WHERE userId = currentUser.userId
- Apply type filter if provided
- Apply isRead filter (parse string "true"/"false" → boolean using \`@Transform\`)
- Order by createdAt DESC, paginate

**200:** \`{ page, limit, total, notifications: [{ id, type, message, actorId, entityType, entityId, isRead, createdAt }] }\`

---

**GET /api/v1/notifications/unread-count** — Auth: JWT
COUNT WHERE userId = userId AND isRead = false
**200:** \`{ count: number }\``,
            },
            {
              name: 'M10: PATCH read/read-all + DELETE + preferences + push endpoints',
              description:
`[!] Route order in controller: \`read-all\` BEFORE \`:notificationId\`, \`preferences\` BEFORE \`:notificationId\`

**PATCH /:id/read** — verify ownership (403) → set isRead = true
**PATCH /read-all** — updateMany WHERE userId AND isRead = false → isRead = true
**DELETE /:id** — verify ownership (403) → hard-delete

**GET /preferences** — upsert NotificationPreference (defaults all true if missing) → return it
**PUT /preferences** — body: UpdatePreferencesDto → upsert with provided values

**POST /push/register** — upsert PushDevice by deviceToken (update platform if same token)
**DELETE /push/:deviceId** — verify PushDevice.userId === currentUser.userId (403) → delete`,
            },
            {
              name: 'M10: NotificationsListener — Event Handler Stubs (CRITICAL — due Day 2)',
              description:
`Implement \`notifications.listener.ts\` with working handlers:

\`\`\`typescript
@Injectable()
export class NotificationsListener {
  constructor(private readonly notifService: NotificationsService) {}

  @OnEvent('track.liked')
  async handleTrackLiked(payload: { trackId: string; actorId: string; ownerId: string }) {
    const pref = await this.notifService.getPreferences(payload.ownerId);
    if (!pref.likes) return;
    await this.notifService.create({
      userId: payload.ownerId, type: 'like', actorId: payload.actorId,
      entityType: 'track', entityId: payload.trackId,
      message: 'Someone liked your track',
    });
  }
  // Replicate pattern for:
  // @OnEvent('track.commented')  → check pref.comments
  // @OnEvent('user.followed')    → check pref.follows
  // @OnEvent('track.reposted')   → check pref.reposts
  // @OnEvent('report.created')   → notify all ADMIN/MODERATOR users
}
\`\`\`

Share payload interface types with Mohammed (report.created) and Yahia (messaging events).`,
            },
          ],
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════════
    //  SPRINT 8 — Advanced Features & Real-Time                   Days 3–4
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name:    `Sprint 8 — Advanced Features & Real-Time  [Days 3–4 · Due ${shortDate(due.s8)}]`,
      dueDate: due.s8,
      tasks: [

        // ── MOHANNAD ─────────────────────────────────────────────────────────
        {
          assignee: 'mohannad', priority: 2, dueDate: due.s8,
          name: '[M11 Stats + Enforcement + Security] Mohannad — Admin Analytics + User Enforcement + Sprint 8 Security Review',
          description:
`## Overview
Implement the Admin Analytics Dashboard (M11 — stats endpoints), the User Enforcement endpoints (warn/suspend/ban/restore), and perform a security review of all Sprint 7 code.

## Part A — M11 Admin Stats Endpoints

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | GET | /api/v1/admin/stats/overview | ADMIN |
| 2 | GET | /api/v1/admin/stats/daily | ADMIN |
| 3 | GET | /api/v1/admin/stats/most-reported | ADMIN |

## Part B — M11 User Enforcement Endpoints

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 4 | POST | /api/v1/admin/users/:id/warn | ADMIN + re-auth |
| 5 | POST | /api/v1/admin/users/:id/suspend | ADMIN + re-auth |
| 6 | POST | /api/v1/admin/users/:id/ban | ADMIN + re-auth |
| 7 | POST | /api/v1/admin/users/:id/restore | ADMIN |

## Part C — Sprint 8 Security Review
Review all new endpoints shipped by Farah (M7), Mohammed (M8), Yahia (M9), Heikal (M10) for:
- Missing or incorrect auth guards
- Input validation gaps (DTO missing decorators)
- IDOR vulnerabilities (can user A access user B's resources?)
- Rate limiting on high-frequency endpoints

## Why User Enforcement is Yours
Warn/suspend/ban are the most security-sensitive endpoints in the app. As Security Lead you should own and fully understand these controls.

## Definition of Done
- [ ] GET /admin/stats/overview runs all DB queries in parallel
- [ ] Stats cached in-memory for 5 minutes (simple Map TTL)
- [ ] warn/suspend/ban: argon2 re-auth + DB role re-verification implemented
- [ ] ban: hides all PUBLIC tracks + playlists of banned user
- [ ] restore: restore\_content=true brings tracks/playlists back to PUBLIC
- [ ] Sprint 8 security review findings logged in AUTHENTICATION-AUDIT-REPORT.json`,
          subtasks: [
            {
              name: 'M11: Scaffold admin.module (if not yet created) + stats controller/service',
              description:
`Create or update \`src/admin/\`:
- admin.module.ts (imports PrismaModule)
- stats.controller.ts (@ApiTags('Admin Stats') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Controller('admin/stats'))
- stats.service.ts (inject PrismaService)

Add 5-minute in-memory cache in stats.service.ts:
\`\`\`typescript
private cache = new Map<string, { data: any; expiresAt: number }>();
private getCached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = this.cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
  return fn().then((data) => { this.cache.set(key, { data, expiresAt: Date.now() + ttlMs }); return data; });
}
\`\`\``,
            },
            {
              name: 'M11: GET /admin/stats/overview — Platform Overview',
              description:
`**Auth:** ADMIN only

Run ALL counts **in parallel** using \`Promise.all([...])\`:
- users: total, active, suspended, banned
- content: tracks by status, playlists count, comments count
- engagement: total PlayEvents, Likes, Reposts (COUNT from each table)
- storage: SUM(fileSizeBytes) from TrackFile (BigInt → Number)
- subscriptions: count by subscriptionType
- moderation: pending reports, in_review, resolved this week, actions this week

Cache result for 5 minutes using the cache helper.

**200:** full stats object (see apidoc M11 for exact field names)`,
            },
            {
              name: 'M11: GET /admin/stats/daily + GET /admin/stats/most-reported',
              description:
`**GET /admin/stats/daily** — Auth: ADMIN
Query: date\_from, date\_to, granularity (daily|weekly|monthly)
- \`prisma.\$queryRaw\` with \`DATE_TRUNC(granularity, "createdAt")\`
- Return time-series: \`[{ date, active_users, new_users, tracks_uploaded, total_storage_bytes }]\`
- Order by date DESC

---

**GET /admin/stats/most-reported** — Auth: ADMIN
Query: period (last\_7\_days|last\_30\_days|last\_90\_days|all\_time), limit=10
- Compute date cutoff from period enum
- GROUP BY targetType, category
- Return: \`{ most_reported_users, most_reported_tracks, most_reported_playlists }\` each with report\_count`,
            },
            {
              name: 'M11: POST /admin/users/:id/warn — Warn User',
              description:
`**Auth:** ADMIN + password re-authentication

Body: { reason (10–2000), report_id? (UUID), current_password (required) }

Logic:
1. **Re-verify admin role from DB** (not JWT): \`prisma.user.findUnique({ where: { id: adminId }, select: { role: true, passwordHash: true } })\` → 403 if not ADMIN
2. \`argon2.verify(admin.passwordHash, current_password)\` → **401 INCORRECT_PASSWORD** if fails
3. Find target user → 404 USER_NOT_FOUND
4. Target is ADMIN role → **403 CANNOT_WARN_ADMIN**
5. Target is BANNED → **409 USER_ALREADY_BANNED**
6. INSERT ModerationAction: { actionType: "WARN_USER", adminId, targetUserId, linkedReportId, notes: reason }
7. Insert Notification for target user
8. Emit to Heikal's gateway if target is online

**201:** \`{ action_id, action_type: "WARN_USER", target_user, admin_id, notes, created_at }\``,
            },
            {
              name: 'M11: POST /suspend + /ban + /restore',
              description:
`All require ADMIN role + DB role re-verification (no password re-auth on restore).

**POST /admin/users/:id/suspend** — Body: { duration_days (1–365), reason, report_id?, current_password }
- argon2 re-auth → Update User: accountStatus=SUSPENDED, suspendedUntil=now+days
- \`prisma.userSession.updateMany({ where: { userId }, data: { revokedAt: new Date() } })\` (revoke all sessions)
- INSERT ModerationAction + Notification

**POST /admin/users/:id/ban** — Body: { reason, report_id?, current_password }
- Target is ADMIN → **403 CANNOT_BAN_ADMIN**
- Target already BANNED → **409 USER_ALREADY_BANNED**
- argon2 re-auth → accountStatus=BANNED, revoke all sessions
- Hide content: \`prisma.track.updateMany({ where: { uploaderId: userId, visibility: 'PUBLIC' }, data: { visibility: 'PRIVATE' } })\`
- Same for playlists
- INSERT ModerationAction + Notification

**POST /admin/users/:id/restore** — Body: { reason, restore_content?: boolean = false }
- Target must be SUSPENDED or BANNED → **409 USER_ALREADY_ACTIVE** if ACTIVE
- Update accountStatus=ACTIVE, suspendedUntil=null
- If restore_content=true: restore tracks + playlists back to PUBLIC`,
            },
            {
              name: 'M11: GET /admin/users (list) + GET /admin/users/:id (detail) + GET /admin/audit-log',
              description:
`**GET /admin/users** — Auth: ADMIN
Query: page, limit, status, role, search (email or handle), sort\_by (created\_at|last\_login\_at), sort\_order
- Dynamic Prisma where clause from filters
- Include: profile (displayName, handle, avatarUrl), \_count.tracks, reports against user count

**GET /admin/users/:userId** — Auth: ADMIN
Full user object including:
- UserSubscription (type, uploadLimit)
- Last 20 ModerationActions WHERE targetUserId = userId
- Reports stats: total, pending, resolved (reports against this user)

---

**GET /admin/audit-log** — Auth: ADMIN
[!] IMMUTABLE: ModerationAction has NO PATCH or DELETE endpoints. This is a permanent record.
Query: page, limit, action\_type, admin\_id, target\_user\_id, date\_from, date\_to
- Include: admin profile, target user profile, target track/comment/playlist
- Order by created\_at DESC
- This satisfies OWASP A09 (Security Logging and Monitoring)`,
            },
            {
              name: 'SEC: Sprint 8 — Security Review of All New Modules',
              description:
`Review every endpoint added by the team in Sprint 7+8 before Sprint 9 testing.

**Checklist per module:**
- [ ] **M7 (Farah — Playlists):** PRIVATE playlist privacy enforced? secretToken never leaked in list endpoints?
- [ ] **M8 (Mohammed — Feed/Discovery):** search results exclude PRIVATE tracks/playlists?
- [ ] **M9 (Yahia — Messaging):** block check on send? conversation access control correct?
- [ ] **M10 (Heikal — Notifications):** notification ownership check on mark-read and delete?
- [ ] **M11 Reports (Mohammed):** duplicate report check? rate limit on submission?
- [ ] **M11 Enforcement (Mohannad):** DB role re-verification on warn/suspend/ban?

**For each issue found:**
1. Create a GitHub issue OR directly fix if < 30 min
2. Log in AUTHENTICATION-AUDIT-REPORT.json with: endpoint, issue type, severity, fix applied`,
            },
          ],
        },

        // ── FARAH ─────────────────────────────────────────────────────────────
        {
          assignee: 'farah', priority: 2, dueDate: due.s8,
          name: '[M7] Farah — Playlists Advanced (Track Management, Secret Link, Embed)',
          description:
`## Overview
Complete the remaining playlist endpoints: adding/removing/reordering tracks, secret link access, and embed code generation.

## Endpoints (Sprint 8)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 6 | POST | /api/v1/playlists/:id/tracks | JWT (owner) |
| 7 | DELETE | /api/v1/playlists/:id/tracks/:trackId | JWT (owner) |
| 8 | PATCH | /api/v1/playlists/:id/reorder | JWT (owner) |
| 9 | GET | /api/v1/playlists/secret/:token | Public |
| 10 | GET | /api/v1/playlists/:id/embed | Public |

## Definition of Done
- [ ] Add track: 409 on duplicate track in same playlist
- [ ] Reorder uses Prisma.\$transaction (atomic position update)
- [ ] GET /secret/:token declared BEFORE GET /:id (avoid token matching as UUID)
- [ ] Embed code generates correct iframe URL using FRONTEND\_URL env var`,
          subtasks: [
            {
              name: 'M7: POST /playlists/:id/tracks — Add Track + DELETE /:id/tracks/:trackId — Remove',
              description:
`**POST /api/v1/playlists/:playlistId/tracks** — Auth: JWT (owner)
Body: \`{ trackId: UUID }\`
1. Verify playlist exists + ownerId === currentUser.userId → 403 NOT\_OWNER
2. Verify track exists + not deleted → 404 TRACK\_NOT\_FOUND
3. Check PlaylistTrack doesn't already exist → **409 TRACK\_ALREADY\_IN\_PLAYLIST**
4. INSERT PlaylistTrack with position = MAX(position) + 1

**201:** \`{ message: "Track added successfully", playlistId, trackId }\`

---

**DELETE /api/v1/playlists/:playlistId/tracks/:trackId** — Auth: JWT (owner)
1. Verify owner → 403
2. Delete PlaylistTrack WHERE playlistId + trackId → 404 if not found
**200:** \`{ message: "Track removed from playlist successfully" }\``,
            },
            {
              name: 'M7: PATCH /playlists/:id/reorder — Atomic Track Reorder',
              description:
`**Auth:** JWT (owner) | Body: \`{ orderedTrackIds: string[] }\`

Logic:
1. Fetch all PlaylistTrack.trackId for this playlist
2. Validate: every ID in orderedTrackIds must belong to this playlist → **400 INVALID\_TRACK\_IDS** if any missing
3. Use \`prisma.\$transaction\` to update all positions atomically:

\`\`\`typescript
await this.prisma.$transaction(
  orderedTrackIds.map((trackId, index) =>
    this.prisma.playlistTrack.update({
      where: { playlistId_trackId: { playlistId, trackId } },
      data: { position: index },
    }),
  ),
);
\`\`\`

**200:** \`{ message: "Playlist reordered successfully" }\``,
            },
            {
              name: 'M7: GET /playlists/secret/:token + GET /playlists/:id/embed',
              description:
`[!] Declare \`@Get('secret/:secretToken')\` BEFORE \`@Get(':playlistId')\` in the controller.

**GET /api/v1/playlists/secret/:secretToken** — Auth: None
- Find Playlist WHERE secretToken = token → 404 if missing or secretToken is null
- Return full playlist details (same shape as GET /:id)
- 200: \`{ playlistId, title, visibility: "SECRET", message: "Access granted via secret token", tracks: [...] }\`

---

**GET /api/v1/playlists/:playlistId/embed** — Auth: None
- If PRIVATE/SECRET and requester is not owner → 403
- Build embed URL: \`\${configService.get('FRONTEND_URL')}/embed/playlists/\${playlistId}\`
- 200: \`{ playlistId, embedCode: "<iframe src=\\"...\\" width=\\"100%\\" height=\\"166\\" scrolling=\\"no\\" frameborder=\\"no\\"></iframe>" }\``,
            },
          ],
        },

        // ── MOHAMMED ─────────────────────────────────────────────────────────
        {
          assignee: 'mohammed', priority: 2, dueDate: due.s8,
          name: '[M8 + M11] Mohammed — Search Optimization & Reports Core',
          description:
`## Overview
Optimize search with a GIN full-text index migration and implement the core M11 report management endpoints (submit, list, get, update status, bulk, assign, appeal).

## M11 — Report Endpoints (Sprint 8)

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | POST | /api/v1/reports | JWT |
| 2 | GET | /api/v1/admin/reports | ADMIN/MOD |
| 3 | GET | /api/v1/admin/reports/:id | ADMIN/MOD |
| 4 | PATCH | /api/v1/admin/reports/:id | ADMIN/MOD |
| 5 | PATCH | /api/v1/admin/reports/bulk | ADMIN/MOD |
| 6 | PATCH | /api/v1/admin/reports/:id/assign | ADMIN/MOD |
| 7 | POST | /api/v1/reports/appeal | JWT |

## Definition of Done
- [ ] POST /reports: exactly one target field validation + duplicate check (409)
- [ ] Status transition: RESOLVED → any state throws 400 INVALID\_TRANSITION
- [ ] Bulk update respects max 50 IDs limit
- [ ] GIN index migration created and applied`,
          subtasks: [
            {
              name: 'M8: Prisma migration — GIN indexes for Full-Text Search',
              description:
`Run: \`npx prisma migrate dev --name add_fts_gin_indexes\`

In the generated migration SQL, add:
\`\`\`sql
CREATE INDEX IF NOT EXISTS "tracks_fts_idx"
  ON "Track" USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

CREATE INDEX IF NOT EXISTS "profiles_fts_idx"
  ON "UserProfile" USING GIN (to_tsvector('english', coalesce("displayName",'') || ' ' || coalesce(handle,'')));

CREATE INDEX IF NOT EXISTS "playlists_fts_idx"
  ON "Playlist" USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
\`\`\`

After migration: update DiscoveryService.search() to use \`prisma.\$queryRaw\` for FTS where possible.
Verify with \`EXPLAIN ANALYZE\` that indexes are used.`,
            },
            {
              name: 'M11: Scaffold admin reports module + Prisma models',
              description:
`Create or extend \`src/admin/\`:
- reports.controller.ts (@Controller('reports') — user-facing)
- admin-reports.controller.ts (@Controller('admin/reports') @UseGuards(JwtAuthGuard, RolesGuard))
- moderation.service.ts (inject PrismaService + EventEmitter2)

DTOs: CreateReportDto, UpdateReportStatusDto, BulkReportDto, AssignReportDto, AppealDto

Prisma — verify/create:
\`\`\`prisma
model ModerationReport {
  id             String    @id @default(uuid())
  reporterId     String
  category       String    // COPYRIGHT | INAPPROPRIATE | SPAM | HARASSMENT | APPEAL | OTHER
  description    String
  trackId        String?
  commentId      String?
  playlistId     String?
  reportedUserId String?
  status         String    @default("PENDING") // PENDING | IN_REVIEW | RESOLVED | REJECTED
  assignedTo     String?
  resolvedAt     DateTime?
  createdAt      DateTime  @default(now())
}
model ModerationAction {
  // IMMUTABLE — no UPDATE or DELETE endpoints on this table
  id              String   @id @default(uuid())
  actionType      String
  adminId         String
  targetUserId    String?
  targetTrackId   String?
  targetCommentId String?
  targetPlaylistId String?
  linkedReportId  String?
  notes           String?
  createdAt       DateTime @default(now())
}
\`\`\``,
            },
            {
              name: 'M11: POST /reports — Submit Report + POST /reports/appeal',
              description:
`**POST /api/v1/reports** — Auth: JWT | Rate limit: 10/hour per user
Body: CreateReportDto — category (required), description (10–1000 chars), ONE target field (trackId OR commentId OR playlistId OR reportedUserId)

Validation:
- Custom validator: exactly 1 target field must be non-null → 400 EXACTLY\_ONE\_TARGET\_REQUIRED
- Cannot report self (reportedUserId === userId) → 400 CANNOT\_REPORT\_SELF
- Verify target exists → 404 TARGET\_NOT\_FOUND
- Duplicate: existing PENDING report by same user on same target → 409 DUPLICATE\_REPORT
- Emit: \`this.eventEmitter.emit('report.created', { reportId, category })\`

**201:** \`{ id, reporter_id, category, description, target: { type, id }, status: "PENDING", created_at }\`

---

**POST /api/v1/reports/appeal** — Auth: JWT (SUSPENDED users allowed)
Body: { action\_id (UUID), reason (20–2000 chars) }
- Find ModerationAction by action\_id → verify it targets currentUser or their content → 403 if not
- Duplicate check → 409 APPEAL\_ALREADY\_EXISTS
- Insert ModerationReport with category = APPEAL
- **201:** \`{ appeal_id, action_id, status: "PENDING", created_at }\``,
            },
            {
              name: 'M11: GET/PATCH /admin/reports — List, Get, Update Status, Bulk, Assign',
              description:
`**GET /admin/reports** — filters: status, category, target\_type, sort\_by, sort\_order, page, limit
→ dynamic Prisma where + paginated response

**GET /admin/reports/:id** — full detail: reporter profile + target entity + related\_reports count + previous\_actions\_on\_target (last 10)

**PATCH /admin/reports/:id** — body: { status, resolution\_notes? }
Valid transitions:
- PENDING → IN\_REVIEW | RESOLVED | REJECTED ✓
- IN\_REVIEW → RESOLVED | REJECTED ✓
- RESOLVED or REJECTED → anything → **400 INVALID\_TRANSITION**
On RESOLVED: emit notification to reporter

**PATCH /admin/reports/bulk** [!] declare BEFORE \`/:id\`
body: { report\_ids (max 50), status, resolution\_notes? }
→ filter to only PENDING/IN\_REVIEW → updateMany → return { updated: N, failed: M }

**PATCH /admin/reports/:id/assign**
body: { assignee\_id: UUID | null }
→ verify assignee is ADMIN/MOD → update + auto-transition PENDING → IN\_REVIEW`,
            },
          ],
        },

        // ── YAHIA ─────────────────────────────────────────────────────────────
        {
          assignee: 'yahia', priority: 2, dueDate: due.s8,
          name: '[M9] Yahia — Messaging WebSocket + Advanced Endpoints',
          description:
`## Overview
Implement the WebSocket real-time gateway for messaging and complete the remaining M9 REST endpoints. M9 is your sole focus this sprint — complete it cleanly.

## M9 — Remaining Endpoints

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 5 | POST | /api/v1/messages/share/track | JWT |
| 6 | POST | /api/v1/messages/share/playlist | JWT |
| 7 | PATCH | /api/v1/messages/conversations/:id/read | JWT |
| 8 | DELETE | /api/v1/messages/:id | JWT (sender) |

## Definition of Done
- [ ] WebSocket: JWT validated on connection (disconnect immediately if invalid)
- [ ] share/playlist requires Farah's M7 Playlist model — coordinate by Day 3
- [ ] Block check applied on share/track and share/playlist
- [ ] Delete message: only sender can delete (403 for non-sender)`,
          subtasks: [
            {
              name: 'M9: WebSocket Gateway — Real-Time Messaging',
              description:
`\`src/messages/messages.gateway.ts\`:
\`\`\`typescript
@WebSocketGateway({ namespace: '/messages', cors: { origin: process.env.FRONTEND_URL } })
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private userSocketMap = new Map<string, Set<string>>();

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    try {
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      if (!this.userSocketMap.has(payload.sub)) this.userSocketMap.set(payload.sub, new Set());
      this.userSocketMap.get(payload.sub).add(client.id);
    } catch {
      client.disconnect();
    }
  }
  handleDisconnect(client: Socket) { /* remove client.id from map */ }

  emitToUser(userId: string, event: string, data: any) {
    this.userSocketMap.get(userId)?.forEach((sid) => this.server.to(sid).emit(event, data));
  }
  @SubscribeMessage('join_conversation')
  handleJoin(client: Socket, { conversationId }: { conversationId: string }) {
    // verify client.data.userId is a participant, then client.join(conversationId)
  }
}
\`\`\`
In MessagesService.sendMessage(): call \`this.gateway.server.to(conversationId).emit('new_message', message)\``,
            },
            {
              name: 'M9: POST /messages/share/track + /share/playlist + PATCH /conversations/:id/read + DELETE /:id',
              description:
`**POST /messages/share/track** — Body: ShareTrackDto
- Block check → 403 BLOCKED\_USER
- Verify track exists + is PUBLIC OR senderId = uploaderId → 403 if inaccessible
- Create Message type=TRACK\_SHARE + update conversation
- **201:** \`{ messageId, conversationId, type: "TRACK\_SHARE", sharedTrack: { id, title, artist }, createdAt }\`

**POST /messages/share/playlist** (requires Farah's M7)
- Verify playlist is PUBLIC OR senderId = ownerId → 403
- Create Message type=PLAYLIST\_SHARE
- **201:** \`{ messageId, conversationId, type: "PLAYLIST\_SHARE", sharedPlaylist: { id, title, tracksCount }, createdAt }\`

**PATCH /conversations/:id/read**
- Verify participant (403) → updateMany isRead = true WHERE receiverId = userId AND conversationId = id
- Emit: \`gateway.emitToUser(userId, 'unread_count_updated', { count })\`

**DELETE /messages/:messageId**
- Verify message.senderId === currentUser.userId → **403** (only sender can delete)
- Soft-delete: set deletedAt = new Date()`,
            },
          ],
        },

        // ── HEIKAL ────────────────────────────────────────────────────────────
        {
          assignee: 'heikal', priority: 2, dueDate: due.s8,
          name: '[M10 + M11] Heikal — Notifications WebSocket + Content Moderation',
          description:
`## Overview
Implement the Notifications WebSocket gateway (real-time delivery) and M11 content moderation endpoints (track/comment/playlist).

## M10 — WebSocket Gateway (Sprint 8)
Real-time notification push to connected devices.

## M11 Endpoints

| # | Method | Endpoint | Auth |
|---|--------|----------|------|
| 1 | PATCH | /api/v1/admin/tracks/:id/moderation | ADMIN/MOD |
| 2 | PATCH | /api/v1/admin/comments/:id/moderation | ADMIN/MOD |
| 3 | PATCH | /api/v1/admin/playlists/:id/moderation | ADMIN/MOD |

## Note — Admin User Management
GET /admin/users, GET /admin/users/:userId, and GET /admin/audit-log are owned by Mohannad (Security Lead) because they are tightly coupled to User Enforcement: viewing the user profile before warn/suspend/ban, and reading the audit log of enforcement actions.

## Definition of Done
- [ ] WebSocket: invalid JWT disconnected immediately on connection
- [ ] After markAsRead/markAllRead: emit \`unread_count_updated\` via WebSocket to all user sockets
- [ ] PATCH /admin/tracks/:id/moderation: same state → 400 NO\_STATE\_CHANGE
- [ ] PATCH /admin/comments/:id/moderation: emits notification to comment author
- [ ] PATCH /admin/playlists/:id/moderation: emits notification to playlist owner`,
          subtasks: [
            {
              name: 'M10: WebSocket Gateway — Real-Time Notification Push',
              description:
`\`src/notifications/notifications.gateway.ts\`:
\`\`\`typescript
@WebSocketGateway({ namespace: '/notifications', cors: { origin: process.env.FRONTEND_URL } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private userSocketMap = new Map<string, Set<string>>();

  async handleConnection(client: Socket) {
    try {
      const payload = this.jwtService.verify(client.handshake.auth?.token);
      client.data.userId = payload.sub;
      if (!this.userSocketMap.has(payload.sub)) this.userSocketMap.set(payload.sub, new Set());
      this.userSocketMap.get(payload.sub).add(client.id);
    } catch { client.disconnect(); }
  }
  handleDisconnect(client: Socket) { /* remove from map */ }

  emitToUser(userId: string, event: string, data: any) {
    this.userSocketMap.get(userId)?.forEach((sid) => this.server.to(sid).emit(event, data));
  }
}
\`\`\`

In NotificationsService.create(): \`this.gateway.emitToUser(userId, 'new_notification', { ...notif })\`
In NotificationsService.markAsRead/markAllRead(): \`this.gateway.emitToUser(userId, 'unread_count_updated', { count })\`

**Debounce (bonus):** if same type+entityId gets 5+ events in 60s → collapse to 1 batched notification`,
            },
            {
              name: 'M11: PATCH /admin/tracks/:id/moderation — Moderate Track',
              description:
`**Auth:** ADMIN | MODERATOR
Body: { moderation\_state (VISIBLE|HIDDEN|REMOVED, required), reason (10–2000), report\_id? (UUID), current\_password? }

Action mapping: HIDDEN → HIDE\_TRACK | REMOVED → REMOVE\_TRACK | VISIBLE → RESTORE\_CONTENT
REMOVED requires current\_password → argon2.verify

Logic:
1. Verify track exists → 404
2. If moderation\_state === current track state → **400 NO\_STATE\_CHANGE**
3. For REMOVED: argon2 re-auth
4. Update Track.moderationState (add field to schema if missing)
5. INSERT ModerationAction (immutable record)
6. Emit notification to track uploader
7. If report\_id provided: auto-set linked report to RESOLVED

**200:** \`{ action_id, action_type, track: { id, title, previous_state, new_state }, admin_id, notes, created_at }\``,
            },
            {
              name: 'M11: PATCH /admin/comments/:id/moderation + /admin/playlists/:id/moderation',
              description:
`**PATCH /admin/comments/:commentId/moderation** — Auth: ADMIN | MODERATOR
Body: { is\_hidden (boolean, required), reason (10–2000), report\_id? }
- Verify comment exists → 404
- is\_hidden === current Comment.isHidden → 400 NO\_STATE\_CHANGE
- Update Comment.isHidden
- INSERT ModerationAction (HIDE\_COMMENT or RESTORE\_CONTENT)
- Notify comment author

**200:** \`{ action_id, action_type, comment: { id, track_id, is_hidden }, admin_id, notes, created_at }\`

---

**PATCH /admin/playlists/:playlistId/moderation** — same pattern
Body: { moderation\_state (VISIBLE|HIDDEN|REMOVED), reason, report\_id? }
- Update Playlist.moderationState
- INSERT ModerationAction
- Notify playlist owner`,
            },
          ],
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════════
    //  SPRINT 9 — Unit Testing & Bug Fixes                           Day 5
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name:    `Sprint 9 — Unit Testing & Bug Fixes  [Day 5 · Due ${shortDate(due.s9)}]`,
      dueDate: due.s9,
      tasks: [
        {
          assignee: 'mohannad', priority: 2, dueDate: due.s9,
          name: '[M12 + M11 Enforcement + Security Tests] Mohannad — Unit Tests + RBAC Security Test Suite',
          description:
`## Overview
Write unit tests for SubscriptionsService and UserEnforcementService, and build a reusable RBAC/auth-bypass security test suite that covers the entire application.

## Test Files to Create
1. \`src/subscriptions/subscriptions.service.spec.ts\`
2. \`src/admin/user-enforcement.service.spec.ts\`
3. \`src/admin/admin-users.service.spec.ts\`
4. \`test/security-rbac.e2e-spec.ts\` (shared security tests)

## Key Test Cases
**SubscriptionsService:**
- GET /me creates FREE defaults when no record exists
- Upload guard throws 403 at quota (count >= limit)
- PRO tier returns adFree = true
- Offline download throws 403 for FREE user

**UserEnforcementService:**
- warnUser() throws 401 for wrong current\_password
- warnUser() throws 403 if target is ADMIN
- warnUser() re-queries DB for admin role (not just JWT claim)
- banUser() throws 403 CANNOT\_BAN\_ADMIN
- banUser() hides all PUBLIC tracks on ban
- restoreUser() throws 409 USER\_ALREADY\_ACTIVE for ACTIVE status
- restoreUser() restores tracks when restore\_content = true

**Security RBAC test suite:**
- USER role → GET /admin/reports → 403
- USER role → POST /admin/users/:id/warn → 403
- No token → any /admin/* → 401
- Expired JWT → any protected route → 401
- Wrong password in re-auth → warn/suspend/ban → 401 INCORRECT\_PASSWORD

**AdminUsersService:**
- getAdminUsers() — returns paginated list with status/role filters applied
- getAdminUsers() — search by handle partial match
- getAdminUserById() — throws 404 for unknown userId
- getAdminUserById() — includes last 20 ModerationActions for target user
- getAuditLog() — ordered by created\_at DESC
- getAuditLog() — applies action\_type + admin\_id filters correctly

## Definition of Done
- [ ] \`npx jest subscriptions.service.spec.ts user-enforcement.service.spec.ts admin-users.service.spec.ts --coverage\` passes
- [ ] Security RBAC test suite runs against the running app (E2E style)
- [ ] Document any failures in AUTHENTICATION-AUDIT-REPORT.json`,
          subtasks: [
            {
              name: 'Tests: SubscriptionsService unit tests',
              description:
`\`subscriptions.service.spec.ts\` (mock PrismaService):
✓ getMySubscription() — upserts FREE when no record exists
✓ getMySubscription() — remainingUploads = uploadLimit − uploadedTracks
✓ getMySubscription() — adFree = false for FREE, true for PRO
✓ subscribe() — sets uploadLimit 100 for PRO, 1000 for GO\_PLUS
✓ subscribe() — sets currentPeriodEnd 30 days from now
✓ getOfflineTrack() — throws 403 for FREE user
✓ getOfflineTrack() — returns downloadUrl for PRO user
✓ Upload guard — throws 403 UPLOAD\_LIMIT\_REACHED when count >= limit
✓ Upload guard — allows upload when count < limit

Run: \`npx jest subscriptions.service.spec.ts --coverage\``,
            },
            {
              name: 'Tests: UserEnforcementService unit tests',
              description:
`\`user-enforcement.service.spec.ts\` (mock PrismaService + argon2):
✓ warnUser() — throws 401 INCORRECT\_PASSWORD for wrong current\_password
✓ warnUser() — throws 403 if target is ADMIN (DB re-verification, not JWT claim)
✓ warnUser() — re-queries DB for admin role, ignores JWT role claim
✓ warnUser() — throws 409 if target is already BANNED
✓ warnUser() — inserts ModerationAction on success
✓ suspendUser() — sets accountStatus=SUSPENDED + suspendedUntil
✓ suspendUser() — revokes all active sessions
✓ banUser() — throws 403 CANNOT\_BAN\_ADMIN
✓ banUser() — throws 409 USER\_ALREADY\_BANNED if already banned
✓ banUser() — hides all PUBLIC tracks (updateMany to PRIVATE)
✓ banUser() — hides all PUBLIC playlists
✓ restoreUser() — throws 409 USER\_ALREADY\_ACTIVE for ACTIVE status
✓ restoreUser() — restores tracks to PUBLIC when restore\_content = true
✓ restoreUser() — does NOT restore tracks when restore\_content = false

Run: \`npx jest user-enforcement.service.spec.ts --coverage\``,
            },
            {
              name: 'Tests: RBAC + Auth-Bypass Security Test Suite',
              description:
`\`test/security-rbac.e2e-spec.ts\` (supertest against running app):

**Access control:**
✓ GET /admin/reports with USER token → 403
✓ GET /admin/users with MODERATOR token → 403 (ADMIN only)
✓ POST /admin/users/:id/ban with MODERATOR token → 403
✓ Any /admin/* without Authorization header → 401

**Re-auth tests:**
✓ POST /admin/users/:id/warn with correct password → 201
✓ POST /admin/users/:id/warn with wrong current\_password → 401 INCORRECT\_PASSWORD

**JWT edge cases:**
✓ Expired JWT (mock exp: past) → 401
✓ Tampered JWT signature → 401

**IDOR tests:**
✓ User A tries to mark User B's notification as read → 403
✓ User A tries to get User B + User C's conversation → 403

Run: \`npx jest test/security-rbac.e2e-spec.ts\``,
            },
          ],
        },
        {
          assignee: 'farah', priority: 2, dueDate: due.s9,
          name: '[M7] Farah — Unit Tests: PlaylistsService (Full Coverage)',
          description:
`Write full Jest unit tests for PlaylistsService. Mock PrismaService. Target ≥ 80% coverage.

## Key Test Cases
✓ createPlaylist() — generates secretToken for SECRET visibility
✓ createPlaylist() — secretToken = null for PUBLIC
✓ getPlaylistById() — throws 404 for PRIVATE playlist by non-owner
✓ getPlaylistById() — throws 404 for unknown id
✓ updatePlaylist() — throws 403 for non-owner
✓ updatePlaylist() — generates secretToken when switching TO SECRET
✓ updatePlaylist() — clears secretToken when switching FROM SECRET
✓ deletePlaylist() — throws 403 for non-owner
✓ addTrackToPlaylist() — throws 409 for duplicate track
✓ removeTrackFromPlaylist() — throws 404 when track not in playlist
✓ reorderPlaylistTracks() — calls prisma.\$transaction with correct positions
✓ getPlaylistBySecretToken() — throws 404 for invalid/expired token
✓ getMyPlaylists() — returns only current user's playlists

Run: \`npx jest playlists.service.spec.ts --coverage\``,
          subtasks: [],
        },
        {
          assignee: 'mohammed', priority: 2, dueDate: due.s9,
          name: '[M8 + M11] Mohammed — Unit Tests: FeedService, DiscoveryService, ModerationService',
          description:
`Write unit tests for all three service files. Target ≥ 80% coverage each.

## Feed + Discovery Tests
✓ getFeed() — returns [] (not 404) for user with no follows
✓ getFeed() — excludes PRIVATE tracks of non-owner followed users
✓ search() — Promise.all runs parallel queries
✓ search() — type="track" only runs Track query
✓ trending() — sorted by score DESC
✓ resolve() — handles /handle/slug and /handle formats
✓ resolve() — throws 404 for unknown handle

## Moderation Tests
✓ submitReport() — throws 400 for missing/multiple target fields
✓ submitReport() — throws 409 DUPLICATE\_REPORT
✓ submitReport() — emits report.created event on success
✓ updateReportStatus() — PENDING → RESOLVED valid
✓ updateReportStatus() — RESOLVED → IN\_REVIEW throws 400 INVALID\_TRANSITION
✓ bulkResolve() — updates N, returns failed count for terminal reports
✓ submitAppeal() — throws 409 APPEAL\_ALREADY\_EXISTS

Run: \`npx jest feed.service.spec.ts discovery.service.spec.ts moderation.service.spec.ts --coverage\``,
          subtasks: [],
        },
        {
          assignee: 'yahia', priority: 2, dueDate: due.s9,
          name: '[M9] Yahia — Unit Tests: MessagesService',
          description:
`Write unit tests for MessagesService. Target ≥ 80% coverage.

## Messages Tests
✓ sendMessage() — throws 403 if block relationship exists (either direction)
✓ sendMessage() — creates new Conversation if none exists
✓ sendMessage() — reuses existing Conversation
✓ getConversationMessages() — throws 403 for non-participant
✓ getConversationMessages() — excludes soft-deleted messages
✓ shareTrack() — throws 404 for non-existent track
✓ shareTrack() — throws 403 for inaccessible PRIVATE track
✓ sharePlaylist() — throws 403 for private playlist not owned by sender
✓ deleteMessage() — throws 403 when non-sender tries to delete
✓ getUnreadCount() — returns accurate count after send + mark-read

Run: \`npx jest messages.service.spec.ts --coverage\``,
          subtasks: [],
        },
        {
          assignee: 'heikal', priority: 2, dueDate: due.s9,
          name: '[M10 + M11] Heikal — Unit Tests: NotificationsService, Listener, Content Moderation',
          description:
`Write unit tests for all M10 + M11 content moderation services. Target ≥ 80% coverage.

## Notifications Tests
✓ getNotifications() — applies type filter
✓ getNotifications() — applies isRead filter (string "true" → boolean)
✓ markAsRead() — throws 403 for wrong userId
✓ markAllRead() — calls updateMany + emits WebSocket event
✓ Listener: handleTrackLiked() — skips when pref.likes = false
✓ Listener: handleReportCreated() — notifies all ADMIN/MODERATOR users
✓ Listener debounce — 5 same-type events in 60s → 1 batched notification

## Content Moderation Tests
✓ moderateTrack() — throws 404 for missing track
✓ moderateTrack() — throws 400 NO\_STATE\_CHANGE when state unchanged
✓ moderateTrack() — inserts immutable ModerationAction
✓ moderateTrack() — emits notification to track uploader

Run: \`npx jest notifications.service.spec.ts notifications.listener.spec.ts content-moderation.service.spec.ts --coverage\``,
          subtasks: [],
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════════
    //  SPRINT 10 — Integration, QA & Production Readiness          Days 6–7
    // ═══════════════════════════════════════════════════════════════════════════
    {
      name:    `Sprint 10 — Integration, QA & Production Readiness  [Days 6–7 · Due ${shortDate(due.s10)}]`,
      dueDate: due.s10,
      tasks: [

        // ── MOHANNAD — User Enforcement QA + Security Config ─────────────────
        {
          assignee: 'mohannad', priority: 1, dueDate: due.s10,
          name: '[M11 Enforcement + Security] Mohannad — User Enforcement Integration QA + Final Security Config',
          description:
`## Overview
Full integration QA of the User Enforcement endpoints (warn/suspend/ban/restore) and produce the final security configuration review for production deployment.

## Part A — User Enforcement Integration QA
Run every enforcement scenario end-to-end in Postman:

| Scenario | Steps | Expected |
|----------|-------|----------|
| Warn user | POST /warn with correct password | 201 + notification sent |
| Wrong password | POST /warn with wrong password | 401 INCORRECT_PASSWORD |
| Warn admin | POST /warn targeting admin user | 403 CANNOT_WARN_ADMIN |
| Suspend user | POST /suspend duration_days=3 | accountStatus=SUSPENDED, sessions revoked |
| Suspended login | Suspended user tries POST /auth/login | 403 ACCOUNT_SUSPENDED |
| Ban user | POST /ban | accountStatus=BANNED, all PUBLIC tracks hidden |
| Banned login | Banned user tries POST /auth/login | 403 ACCOUNT_BANNED |
| Restore user | POST /restore restore_content=true | ACTIVE, tracks restored to PUBLIC |
| Restore active | POST /restore on already-ACTIVE user | 409 USER_ALREADY_ACTIVE |
| Appeal ban | Banned user POST /reports/appeal | 201 (suspended users allowed) |

## Part B — Final Security Configuration Review
Verify all security controls are production-ready:
- Helmet headers active (no X-Powered-By)
- CORS locked to FRONTEND\_URL only
- JWT\_SECRET ≥ 64 random chars in .env
- DATABASE\_URL uses ?sslmode=require
- Run: \`npm audit --audit-level=high\` → 0 High/Critical
- ThrottlerStorageRedisService active (not in-memory)
- .env NOT committed to git

## Definition of Done
- [ ] All 10 enforcement scenarios pass
- [ ] npm audit — zero High or Critical vulnerabilities
- [ ] AUTHENTICATION-AUDIT-REPORT.json updated with final security sign-off
- [ ] Audit log (ModerationAction) confirmed immutable in codebase`,
          subtasks: [
            {
              name: 'M11 QA: warn + suspend + ban + restore — end-to-end scenarios',
              description:
`Run all scenarios in Postman or automated test script:

1. POST /admin/users/:id/warn — correct password → 201
2. POST /admin/users/:id/warn — wrong password → 401 INCORRECT\_PASSWORD
3. POST /admin/users/:id/warn — target is ADMIN → 403 CANNOT\_WARN\_ADMIN
4. POST /admin/users/:id/suspend — duration\_days=3 → accountStatus=SUSPENDED, suspendedUntil set
5. Suspended user tries any protected route → 403 (sessions revoked)
6. POST /admin/users/:id/ban → accountStatus=BANNED, verify track visibility changed to PRIVATE
7. Banned user tries POST /auth/login → expect 403 ACCOUNT\_BANNED
8. POST /admin/users/:id/restore restore\_content=true → ACTIVE, tracks back to PUBLIC
9. POST /admin/users/:id/restore on ACTIVE user → 409 USER\_ALREADY\_ACTIVE
10. Banned user submits POST /reports/appeal → 201 (special case — suspended users allowed)

Document any failures immediately.`,
            },
            {
              name: 'SEC: Final Security Config + npm audit + AUTHENTICATION-AUDIT-REPORT sign-off',
              description:
`**Environment hardening checklist:**
- [ ] JWT\_SECRET is ≥ 64 random chars (not "secret" or "jwt-secret")
- [ ] DATABASE\_URL uses SSL: \`?sslmode=require\` (for AWS RDS)
- [ ] FRONTEND\_URL is exact production URL (no wildcards)
- [ ] .env in .gitignore: \`git ls-files --error-unmatch .env\` must fail
- [ ] .env.example updated with all new vars from M7–M12

**Headers check (Helmet):**
\`\`\`bash
curl -I http://localhost:3000/api/v1/discovery/trending
# Must NOT contain: X-Powered-By
# Must contain: X-Content-Type-Options, X-Frame-Options
\`\`\`

**Dependency scan:**
\`\`\`bash
npm audit --audit-level=high
\`\`\`
Fix all High/Critical. Document accepted Medium risks.

**Rate limiting production:**
- [ ] /auth/login: ≤ 10/min
- [ ] POST /reports: ≤ 10/hr
- [ ] /admin/*: ≤ 30/min
- [ ] ThrottlerStorageRedisService active (not in-memory)

**Final sign-off:**
Update AUTHENTICATION-AUDIT-REPORT.json:
- Security review dates for each sprint
- Issues found + fixed
- Accepted risks with justification`,
            },
          ],
        },

        // ── FARAH ─────────────────────────────────────────────────────────────
        {
          assignee: 'farah', priority: 2, dueDate: due.s10,
          name: '[M7] Farah — Frontend + Cross/Flutter Integration & Final QA',
          description:
`## Overview
End-to-end integration of M7 (Playlists) with the Frontend (Next.js) and Cross (Flutter) teams. Fix all discovered integration issues. Complete Swagger documentation.

## Integration Test Scenarios
1. Create playlist (PUBLIC) → add tracks → search for it → embed it
2. Create playlist (PRIVATE) → verify non-owner gets 404 (not shown in search)
3. Create playlist (SECRET) → get secretToken → access via /secret/:token → share link
4. Reorder tracks → verify position changes persist
5. Upgrade to PRO → upload 4th track (should work now) → add to playlist

## Definition of Done
- [ ] All response field names match Frontend TypeScript types (camelCase)
- [ ] Secret link end-to-end works from Flutter deep link
- [ ] Embed code renders in browser
- [ ] Swagger at /api/docs shows complete M7 section with examples
- [ ] Updated postman-collection.json shared with Frontend + Cross teams`,
          subtasks: [
            {
              name: 'M7: Frontend integration — full playlist flow',
              description:
`Work with Frontend (Next.js) team:
1. Test create → add tracks → reorder → change visibility → generate secret link
2. Verify response field names match TS types (playlistId, tracksCount, coverArtUrl, etc.)
3. Test secret link: create SECRET playlist → copy secretToken → open /secret/:token in browser
4. Test embed code: verify iframe URL resolves correctly with FRONTEND\_URL env var
5. Test privacy: logged-in USER A tries to view USER B's PRIVATE playlist → should get 404 in browser

**Fix any issues found immediately.**`,
            },
            {
              name: 'M7: Cross/Flutter integration + Swagger + Postman',
              description:
`**Flutter integration:**
- Test playlist visibility filter in search (Arabic playlist titles work?)
- Test secret link via Flutter deep link handler
- Test track ordering in playlist response (position ASC must be consistent)

**Swagger documentation:**
- Add @ApiResponse(201), @ApiResponse(400), @ApiResponse(403), @ApiResponse(404) to all endpoints
- Add @ApiBody with example for CreatePlaylistDto, AddTrackToPlaylistDto, ReorderTracksDto
- Test Swagger UI at http://localhost:3000/api/docs

**Postman collection:**
- Add all 10 M7 endpoints with pre-filled example bodies
- Include environment variable {{playlistId}}, {{trackId}}, {{secretToken}}
- Share updated postman-collection.json in repo`,
            },
          ],
        },

        // ── MOHAMMED ─────────────────────────────────────────────────────────
        {
          assignee: 'mohammed', priority: 2, dueDate: due.s10,
          name: '[M8 + M11] Mohammed — Search Performance + E2E Moderation Workflow',
          description:
`## Overview
Load test search and trending endpoints. Run the complete end-to-end moderation workflow. Ensure all M11 admin endpoints are production-ready.

## E2E Moderation Workflow (run in Postman or test script)
1. User submits report on a track → POST /reports → 201
2. Moderator lists reports → GET /admin/reports → appears with PENDING status
3. Moderator assigns to self → PATCH /admin/reports/:id/assign → auto → IN\_REVIEW
4. Moderator resolves → PATCH /admin/reports/:id → status RESOLVED
5. Admin views dashboard → GET /admin/stats/overview → counters updated
6. Appeal: affected user submits POST /reports/appeal → 201

## Definition of Done
- [ ] Search response time < 500ms with 10,000+ track records
- [ ] GIN indexes confirmed active via EXPLAIN ANALYZE
- [ ] Full moderation workflow completes without errors
- [ ] Bulk resolve: test with 50 reports → all processed
- [ ] npm test → all tests green`,
          subtasks: [
            {
              name: 'M8: Search + Trending performance test',
              description:
`**Search performance:**
- Seed 10,000 track records (or use existing data)
- Run: GET /discovery/search?q=test (measure with curl -w "%{time_total}")
- Target: < 500ms
- If slow: run \`EXPLAIN ANALYZE SELECT ... FROM "Track" WHERE to_tsvector...\` in psql
- Confirm "Index Scan using tracks\_fts\_idx" appears in plan

**Trending performance:**
- Verify index on PlayEvent.startedAt exists (needed for WHERE startedAt > 7 days ago)
- Add if missing: \`CREATE INDEX IF NOT EXISTS "play_event_started_at_idx" ON "PlayEvent"("startedAt");\`

**Cache verification:**
- GET /admin/stats/overview twice in 30s → second call returns same data (cache hit)
- Verify DB query is NOT called second time (spy in unit test or log query count)`,
            },
            {
              name: 'M11: E2E Moderation + Admin production checklist',
              description:
`**E2E test (manual or automated):**
1. POST /reports → verify 201 + report.created event fires → Heikal's listener creates admin notification
2. GET /admin/reports → verify report appears
3. PATCH /admin/reports/:id/assign → verify status moves to IN\_REVIEW
4. PATCH /admin/reports/bulk → resolve 5 reports at once → verify { updated: 5, failed: 0 }
5. POST /reports/appeal → 201 (submit appeal on a ModerationAction)
6. GET /admin/stats/overview → moderation.pending decreases after resolution

**Production checklist:**
- [ ] All 20+ M11 endpoints in Swagger with correct @ApiResponse decorators
- [ ] Audit log confirmed immutable (grep for ModerationAction PATCH/DELETE → must return none)
- [ ] Rate limiting on POST /reports: @Throttle(10, 3600000)
- [ ] npm test → all green | npm run test:cov → M11 ≥ 80%`,
            },
          ],
        },

        // ── YAHIA ─────────────────────────────────────────────────────────────
        {
          assignee: 'yahia', priority: 2, dueDate: due.s10,
          name: '[M9] Yahia — Messaging QA + WebSocket Stress + Full System E2E',
          description:
`## Overview
Full QA of the messaging system, WebSocket stress test, and run the complete 12-module end-to-end integration test covering all modules from registration to subscriptions.

## WebSocket Stress Test
- 10 clients simultaneously with valid JWTs
- 5 pairs each send 20 messages → verify all new\_message events fire
- Disconnect 2 clients → verify userSocketMap cleanup (no memory leak)
- Reconnect → verify join\_conversation room membership restored

## Full 12-Module E2E Test
Run a complete user journey hitting all modules in sequence (see subtask for detailed steps).

## Definition of Done
- [ ] All messaging edge cases pass (blocked user, non-participant, sender-only delete)
- [ ] WebSocket stress test: all 100 messages delivered
- [ ] 12-module E2E completes without errors
- [ ] npm test → all tests green`,
          subtasks: [
            {
              name: 'M9: Messaging QA — Edge Cases + Security',
              description:
`Test all edge cases:
1. Blocked user sends message → 403 BLOCKED\_USER
2. Block relationship in reverse direction → also 403
3. Non-participant tries GET /conversations/:id → 403 ACCESS\_DENIED
4. Non-sender tries DELETE /messages/:id → 403
5. Share PRIVATE playlist not owned by sender → 403
6. Message text exactly 2001 chars → 400 VALIDATION\_FAILED
7. Send 5 messages → GET /unread-count = 5 → GET /conversations/:id → PATCH /conversations/:id/read → count = 0
8. Delete message → not visible in subsequent GET /conversations/:id
9. User A cannot view User B + User C's conversation`,
            },
            {
              name: 'M9+ALL: Full 12-Module End-to-End Integration Test',
              description:
`Run in Postman (or automated test) hitting ALL 12 modules:

1. **[M1]** POST /auth/register → verify email → POST /auth/login
2. **[M2]** PATCH /users/me/profile → POST /users/me/avatar (upload image)
3. **[M3]** User A follows User B → User B follows User A
4. **[M4]** User B uploads track (MP3) → poll GET /tracks/:id until status=FINISHED
5. **[M5]** User A: POST /player/tracks/:id/source → POST /player/progress → POST /player/played
6. **[M6]** User A: POST /tracks/:id/like → POST /tracks/:id/comments
7. **[M7]** User A: POST /playlists → POST /playlists/:id/tracks → PATCH /:id/reorder
8. **[M8]** GET /discovery/search?q=... → GET /discovery/trending → GET /feed
9. **[M9]** User A messages User B → User A shares track in message
10. **[M10]** User B: GET /notifications → verify like + comment + follow notifications appear
11. **[M11]** User A reports track → ADMIN resolves → User A checks notification
12. **[M12]** User B: GET /subscriptions/me → POST /subscribe (PRO) → upload 4th track → GET /offline/:id

Document any failures → create hotfix task assigned to the responsible dev.`,
            },
          ],
        },

        // ── HEIKAL ────────────────────────────────────────────────────────────
        {
          assignee: 'heikal', priority: 1, dueDate: due.s10,
          name: '[M10] Heikal — Notifications QA + Production Deployment',
          description:
`## Overview
Full QA of the notification system (all scenarios + WebSocket events), then lead production deployment preparation for the entire backend.

## Notification Scenarios to Test
1. Like track → owner gets notification (type=like)
2. Owner has likes pref = false → like → NO notification created
3. Follow user → they get follow notification
4. Comment on track → owner notified
5. WebSocket: connect → like track → receive new\_notification event immediately
6. Mark single read → unread count −1
7. Mark all read → count = 0
8. Register push device → PushDevice record created
9. Two sockets for same user: mark read on one → BOTH get unread\_count\_updated event
10. Debounce: 6 likes on same track in 30s → only 1 batched "6 new likes" notification

## Definition of Done
- [ ] All 10 notification scenarios pass
- [ ] npm run build — zero errors in dist/
- [ ] Docker build passes
- [ ] All tests green with ≥ 80% coverage across all modules`,
          subtasks: [
            {
              name: 'M10: Notifications QA — All Scenarios',
              description:
`Run all notification scenarios manually or via test script:

**REST:**
✓ GET /notifications/unread-count = 0 fresh user
✓ Trigger like → count becomes 1
✓ PATCH /:id/read → count = 0
✓ PATCH /read-all → all isRead = true
✓ Preferences: set likes = false → trigger like → no notification created

**WebSocket:**
Connect via WebSocket client (Postman WS or wscat):
\`\`\`bash
wscat -c "ws://localhost:3000/notifications" -H "Authorization: Bearer <token>"
\`\`\`
✓ On connection: authenticated successfully (no error)
✓ On invalid token: connection refused immediately
✓ Like a track (via REST) → receive \`new_notification\` event over WS within 1 second
✓ Mark all read (via REST) → receive \`unread_count_updated\` with count=0 over WS
✓ Two WS connections (same user) → both receive events`,
            },
            {
              name: 'Production Deployment Preparation (All M7–M12)',
              description:
`**1. Build verification:**
\`\`\`bash
npm run build
# Expect: 0 errors, dist/ populated
\`\`\`

**2. Database migrations:**
\`\`\`bash
npx prisma migrate deploy
# Apply all new migrations for M7–M12 to production DB
\`\`\`

**3. Docker build:**
\`\`\`bash
docker-compose -f dev/docker-compose.yaml build
docker-compose -f dev/docker-compose.yaml up -d
# Smoke test: curl http://localhost:3000/api/v1/discovery/trending
\`\`\`

**4. Environment variables checklist (.env.example update):**
- [ ] FRONTEND\_URL (for CORS + embed code)
- [ ] Any new AWS S3 vars for subscriptions offline download
- [ ] REDIS\_URL (throttler + optional cache)

**5. Coverage gate:**
\`\`\`bash
npm run test:cov
# Flag any module below 70% → assign immediate hotfix
\`\`\`

**6. Swagger final check:**
- Open http://localhost:3000/api/docs
- Verify all 12 modules are visible with complete endpoint documentation

**7. Postman collection:**
- Merge all team members' additions into single postman-collection.json
- Share final version with Frontend + Cross teams`,
            },
          ],
        },
      ],
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Non-interactive mode: CLICKUP_ANSWERS="token|m1|m2|m3|m4|m5|folderId|startDate"
  if (process.env.CLICKUP_ANSWERS) {
    _autoQueue = process.env.CLICKUP_ANSWERS.split('|');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !_autoQueue });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   ClickUp Sprint Generator — IQA3 Backend (M7-M12)           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Step 1: API token ───────────────────────────────────────────────────────
  const token = await ask(rl, 'ClickUp API Token (starts with pk_): ');
  if (!token) { console.error('Token is required.'); process.exit(1); }

  console.log('\nValidating token...');
  let me;
  try {
    me = (await apiCall(token, 'GET', '/user', null)).user;
    console.log(`Authenticated as: ${me.username} (${me.email})\n`);
  } catch (err) {
    console.error(`\nERROR: Token validation failed: ${err.message}`);
    console.error('    Get your token at: https://app.clickup.com/settings/apps');
    process.exit(1);
  }

  // ── Step 2: Member selection ────────────────────────────────────────────────
  let TEAM;
  try {
    TEAM = await selectMembers(rl, token);
  } catch (err) {
    console.error(`\nERROR: Could not fetch members: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Folder ID ───────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('Folder ID: open your target folder in ClickUp.');
  console.log('The URL will look like: app.clickup.com/.../f/FOLDER_ID\n');
  const folderId = await ask(rl, 'Folder ID: ');
  if (!folderId) { console.error('Folder ID is required.'); process.exit(1); }

  // ── Step 4: Sprint start date ───────────────────────────────────────────────
  const today     = new Date().toISOString().split('T')[0];
  const dateInput = await ask(rl, `Sprint start date (YYYY-MM-DD) [default: ${today}]: `);
  let startMs;
  try {
    startMs = parseDate(dateInput || today);
  } catch {
    console.error('Invalid date format. Use YYYY-MM-DD.');
    process.exit(1);
  }

  rl.close();

  // ── Step 5: Confirmation summary ────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Configuration Summary                                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Folder ID   : ${folderId.padEnd(46)}║`);
  console.log(`║  Start Date  : ${new Date(startMs).toDateString().padEnd(46)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Team Assignments:                                            ║');
  for (const dev of DEVS) {
    const m = TEAM[dev.key];
    const val = m.userId ? `User ID ${m.userId}` : 'UNASSIGNED';
    console.log(`║  ${dev.label.padEnd(10)}: ${val.padEnd(48)}║`);
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Sprints to create:                                           ║');
  console.log(`║  Sprint 7 — Foundation         Due: ${shortDate(endOfDay(startMs, 2)).padEnd(27)}║`);
  console.log(`║  Sprint 8 — Advanced Features  Due: ${shortDate(endOfDay(startMs, 4)).padEnd(27)}║`);
  console.log(`║  Sprint 9 — Unit Testing       Due: ${shortDate(endOfDay(startMs, 5)).padEnd(27)}║`);
  console.log(`║  Sprint 10 — QA & Production   Due: ${shortDate(endOfDay(startMs, 7)).padEnd(27)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Step 6: Generate ────────────────────────────────────────────────────────
  const sprints = getSprints(TEAM, startMs);
  const results = [];

  for (const sprint of sprints) {
    console.log(`\n${'═'.repeat(64)}`);
    console.log(`  SPRINT: ${sprint.name}`);
    console.log('═'.repeat(64));

    let listId;
    try {
      listId = await createList(token, folderId, { name: sprint.name, dueDate: sprint.dueDate });
      await sleep(500);
    } catch (err) {
      console.error(`  ERROR: Failed to create list: ${err.message}`);
      results.push({ sprint: sprint.name, listId: null, error: err.message });
      continue;
    }

    results.push({ sprint: sprint.name, listId });

    for (const task of sprint.tasks) {
      const assignees = TEAM[task.assignee]?.userId ? [TEAM[task.assignee].userId] : [];
      const devName   = TEAM[task.assignee]?.label || task.assignee;

      process.stdout.write(`\n  [TASK] ${task.name.slice(0, 72)}\n`);
      process.stdout.write(`      Assigned: ${devName}${assignees.length ? '' : '  (unassigned)'}\n`);

      let taskId;
      try {
        taskId = await createTask(token, listId, {
          name:        task.name,
          description: task.description,
          priority:    task.priority || 2,
          assignees,
          dueDate:     task.dueDate,
        });
        await sleep(400);
      } catch (err) {
        console.error(`      ERROR: Task creation failed: ${err.message}`);
        continue;
      }

      for (const sub of task.subtasks || []) {
        process.stdout.write(`      └─  ${sub.name.slice(0, 65)}\n`);
        await sleep(300);
        try {
          await createSubtask(token, listId, taskId, {
            name:        sub.name,
            description: sub.description,
            priority:    sub.priority || 3,
            assignees,
          });
        } catch (err) {
          console.error(`          ERROR: Subtask failed: ${err.message}`);
        }
      }
    }

    console.log(`\n  List created — ID: ${listId}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sprint generation complete!                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const r of results) {
    const icon = r.listId ? 'OK' : 'FAIL';
    console.log(`  ${icon}  ${r.sprint}`);
    if (r.listId) console.log(`     List ID: ${r.listId}`);
    else          console.log(`     Error: ${r.error}`);
  }

  console.log('\n  Team Division:');
  console.log('  Mohannad  → M12 (Subscriptions) + M11 Admin Stats + M11 User Enforcement + M11 Admin User Management + Security Lead');
  console.log('  Farah     → M7 (Sets & Playlists — full module)');
  console.log('  Mohammed  → M8 (Feed, Search & Discovery) + M11 Reports & Analytics');
  console.log('  Yahia     → M9 (Messaging + WebSocket — full module)');
  console.log('  Heikal    → M10 (Notifications + WebSocket) + M11 Content Moderation\n');
  console.log('  Open ClickUp and navigate to your folder to see the new sprints.\n');
}

main().catch((err) => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
