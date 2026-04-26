/**
 * Auth flow integration test
 *
 * Tests: register → (auto-verify) → login (cookie) → /me → refresh → logout
 *        login (Bearer) → /me with Bearer → refresh with Bearer → logout
 *
 * Usage:
 *   node test-auth-flow.js              # uses default port 3006
 *   node test-auth-flow.js 3000
 *
 * The server must be running. Email verification is bypassed by directly
 * updating the DB via `node verify-user.js <email>` OR by running with a
 * DB-accessible account that's already verified.
 *
 * The script creates a fresh timestamped user each run so it never conflicts.
 */

const http = require("http");

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3006);
const BASE = `http://localhost:${PORT}/api/v1`;

const EMAIL = `authtest_${Date.now()}@example.com`;
const PASSWORD = "AuthTest123!";

// ─── ANSI colours ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

let passed = 0;
let failed = 0;

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(method, path, { body, bearerToken, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
    if (cookies) headers["Cookie"] = cookies;

    const options = {
      hostname: "localhost",
      port: PORT,
      path: `/api/v1${path}`,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        // Collect Set-Cookie header
        const setCookie = res.headers["set-cookie"] ?? [];
        resolve({ status: res.statusCode, body: json, rawHeaders: res.headers, setCookie });
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Extract a named cookie value from Set-Cookie array
function extractCookie(setCookieArr, name) {
  for (const header of setCookieArr) {
    const pair = header.split(";")[0];
    const [k, v] = pair.split("=");
    if (k.trim() === name) return v?.trim() ?? "";
  }
  return null;
}

// Build Cookie: header string from multiple Set-Cookie headers
function buildCookieHeader(setCookieArr) {
  return setCookieArr
    .map((h) => h.split(";")[0].trim())
    .join("; ");
}

// ─── Assertion helpers ───────────────────────────────────────────────────────
function assert(label, condition, details = "") {
  if (condition) {
    console.log(`  ${c.green}✓${c.reset} ${label}`);
    passed++;
  } else {
    console.log(`  ${c.red}✗${c.reset} ${label}${details ? ` — ${c.red}${details}${c.reset}` : ""}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${c.bold}${c.cyan}── ${title}${c.reset}`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
async function run() {
  console.log(`${c.bold}Auth Flow Test${c.reset} — server: ${c.cyan}${BASE}${c.reset}`);
  console.log(`${c.dim}Test account: ${EMAIL}${c.reset}\n`);

  // ── 1. Register ────────────────────────────────────────────────────────────
  section("1. Register");
  let registerRes;
  try {
    registerRes = await request("POST", "/auth/register", {
      body: {
        email: EMAIL,
        password: PASSWORD,
        password_confirm: PASSWORD,
        display_name: "Auth Tester",
        date_of_birth: "1998-06-15",
        gender: "MALE",
      },
    });
    assert("201 Created", registerRes.status === 201, `got ${registerRes.status}`);
    assert("message field present", typeof registerRes.body?.message === "string");
    console.log(`  ${c.dim}→ ${registerRes.body?.message}${c.reset}`);
  } catch (e) {
    console.log(`  ${c.red}✗ Request failed: ${e.message}${c.reset}`);
    failed++;
    console.log(`\n${c.red}Cannot continue — is the server running on port ${PORT}?${c.reset}`);
    printSummary();
    return;
  }

  // ── 2. Verify email via DB (required before login) ─────────────────────────
  section("2. Auto-verify email via DB");
  try {
    require("dotenv").config();
    const { PrismaClient } = require("@prisma/client");
    const { PrismaPg } = require("@prisma/adapter-pg");
    const rawUrl = process.env.DATABASE_URL ?? "";
    const dbUrl = new URL(rawUrl);
    dbUrl.searchParams.delete("sslmode");
    const adapter = new PrismaPg({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false } });
    const prisma = new PrismaClient({ adapter });
    await prisma.user.update({
      where: { email: EMAIL.toLowerCase() },
      data: { isVerified: true },
    });
    await prisma.emailVerificationToken.updateMany({
      where: { user: { email: EMAIL.toLowerCase() }, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await prisma.$disconnect();
    console.log(`  ${c.green}✓${c.reset} User marked as verified in DB`);
    passed++;
  } catch (e) {
    console.log(`  ${c.yellow}⚠${c.reset}  Prisma not available — skipping DB verify: ${e.message}`);
    console.log(`  ${c.dim}   Run: node verify-user.js ${EMAIL}${c.reset}`);
  }

  // ── 3. Login (cookie path) ─────────────────────────────────────────────────
  section("3. Login → cookie auth");
  const loginRes = await request("POST", "/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  assert("200 OK", loginRes.status === 200, `got ${loginRes.status}`);
  assert("access_token in body", typeof loginRes.body?.access_token === "string");
  assert("refresh_token in body", typeof loginRes.body?.refresh_token === "string");
  assert("user.email in body", loginRes.body?.user?.email === EMAIL);
  const accessCookie = extractCookie(loginRes.setCookie, "access_token");
  const refreshCookie = extractCookie(loginRes.setCookie, "refresh_token");
  assert("access_token cookie set", accessCookie !== null);
  assert("refresh_token cookie set", refreshCookie !== null);

  const cookieHeader = buildCookieHeader(loginRes.setCookie);
  const bodyAccessToken = loginRes.body?.access_token;
  const bodyRefreshToken = loginRes.body?.refresh_token;

  // ── 4. GET /auth/me (cookie) ───────────────────────────────────────────────
  section("4. GET /auth/me — cookie auth");
  const meRes = await request("GET", "/auth/me", { cookies: cookieHeader });
  assert("200 OK", meRes.status === 200, `got ${meRes.status}: ${JSON.stringify(meRes.body)}`);
  assert("id present", typeof meRes.body?.id === "string");
  assert("email matches", meRes.body?.email === EMAIL);
  assert("display_name present", typeof meRes.body?.display_name === "string");
  assert("system_role present", typeof meRes.body?.system_role === "string");

  // ── 5. GET /auth/me without token → 401 ───────────────────────────────────
  section("5. GET /auth/me — no credentials → 401");
  const meUnauth = await request("GET", "/auth/me");
  assert("401 Unauthorized", meUnauth.status === 401, `got ${meUnauth.status}`);

  // ── 6. POST /auth/refresh (cookie) ────────────────────────────────────────
  section("6. POST /auth/refresh — cookie");
  const refreshRes = await request("POST", "/auth/refresh", { cookies: cookieHeader });
  assert("200 OK", refreshRes.status === 200, `got ${refreshRes.status}: ${JSON.stringify(refreshRes.body)}`);
  assert("new access_token in body", typeof refreshRes.body?.access_token === "string");
  assert("new refresh_token in body", typeof refreshRes.body?.refresh_token === "string");
  assert("tokens rotated", refreshRes.body?.access_token !== bodyAccessToken);
  const newCookieHeader = buildCookieHeader(refreshRes.setCookie);
  const newBodyAccessToken = refreshRes.body?.access_token;
  const newBodyRefreshToken = refreshRes.body?.refresh_token;

  // ── 7. Old refresh token is now invalid (rotation) ─────────────────────────
  section("7. Old refresh_token rejected after rotation");
  const oldRefreshRes = await request("POST", "/auth/refresh", { cookies: cookieHeader });
  assert("401 on reused token", oldRefreshRes.status === 401, `got ${oldRefreshRes.status}`);

  // ── 8. Login (Bearer path) ─────────────────────────────────────────────────
  section("8. Login again → Bearer auth");
  const loginRes2 = await request("POST", "/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  assert("200 OK", loginRes2.status === 200, `got ${loginRes2.status}`);
  const bearerToken = loginRes2.body?.access_token;
  const bearerRefreshToken = loginRes2.body?.refresh_token;
  assert("access_token in body", typeof bearerToken === "string");

  // ── 9. GET /auth/me (Bearer) ───────────────────────────────────────────────
  section("9. GET /auth/me — Bearer auth");
  const meBearerRes = await request("GET", "/auth/me", { bearerToken });
  assert("200 OK", meBearerRes.status === 200, `got ${meBearerRes.status}: ${JSON.stringify(meBearerRes.body)}`);
  assert("email matches", meBearerRes.body?.email === EMAIL);

  // ── 10. POST /auth/refresh using refresh_token cookie built from body ───────
  section("10. POST /auth/refresh — refresh_token from body as cookie");
  const refreshCookieFromBody = `access_token=${bearerToken}; refresh_token=${bearerRefreshToken}`;
  const bearerRefreshRes = await request("POST", "/auth/refresh", {
    cookies: refreshCookieFromBody,
  });
  assert("200 OK", bearerRefreshRes.status === 200, `got ${bearerRefreshRes.status}: ${JSON.stringify(bearerRefreshRes.body)}`);
  assert("new access_token", typeof bearerRefreshRes.body?.access_token === "string");
  const postRefreshBearer = bearerRefreshRes.body?.access_token;

  // ── 11. GET /auth/me with new token after Bearer-refresh ──────────────────
  section("11. GET /auth/me — Bearer after refresh");
  const meAfterRefresh = await request("GET", "/auth/me", { bearerToken: postRefreshBearer });
  assert("200 OK", meAfterRefresh.status === 200, `got ${meAfterRefresh.status}`);
  assert("email matches", meAfterRefresh.body?.email === EMAIL);

  // ── 12. Wrong password → 401 ──────────────────────────────────────────────
  section("12. Login with wrong password → 401");
  const badLogin = await request("POST", "/auth/login", {
    body: { email: EMAIL, password: "WrongPass999!" },
  });
  assert("401 Unauthorized", badLogin.status === 401, `got ${badLogin.status}`);
  assert("INVALID_CREDENTIALS error", badLogin.body?.error === "INVALID_CREDENTIALS");

  // ── 13. Logout ────────────────────────────────────────────────────────────
  section("13. POST /auth/logout");
  const logoutCookies = buildCookieHeader(bearerRefreshRes.setCookie);
  const logoutRes = await request("POST", "/auth/logout", { cookies: logoutCookies });
  assert("200 OK", logoutRes.status === 200, `got ${logoutRes.status}`);
  assert("message field", typeof logoutRes.body?.message === "string");

  // After logout, refresh token should be dead
  const postLogoutRefresh = await request("POST", "/auth/refresh", { cookies: logoutCookies });
  assert("401 after logout", postLogoutRefresh.status === 401, `got ${postLogoutRefresh.status}`);

  // ── 14. GET /auth/sessions ────────────────────────────────────────────────
  section("14. GET /auth/sessions — list active sessions");
  // Login fresh to get a valid token
  const loginForSessions = await request("POST", "/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  const sessionsCookies = buildCookieHeader(loginForSessions.setCookie);
  const sessionsRes = await request("GET", "/auth/sessions", { cookies: sessionsCookies });
  assert("200 OK", sessionsRes.status === 200, `got ${sessionsRes.status}`);
  assert("returns array", Array.isArray(sessionsRes.body?.sessions ?? sessionsRes.body), `got ${typeof sessionsRes.body}`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  printSummary();
}

function printSummary() {
  const total = passed + failed;
  console.log(`\n${"─".repeat(50)}`);
  if (failed === 0) {
    console.log(`${c.bold}${c.green}All ${total} assertions passed${c.reset}`);
  } else {
    console.log(`${c.bold}${c.green}${passed} passed${c.reset}  ${c.bold}${c.red}${failed} failed${c.reset}  (${total} total)`);
  }
}

run().catch((e) => {
  console.error(`${c.red}Unexpected error:${c.reset}`, e.message);
  process.exit(1);
});
