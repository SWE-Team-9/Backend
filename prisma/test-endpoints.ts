// Run: node node_modules/ts-node/dist/bin.js prisma/test-endpoints.ts
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { sign } from "jsonwebtoken";

const PORT = 3006;
const JWT_SECRET = "super_secure_jwt_secret_key_minimum_32_characters_long";
const TEST_USER_ID = "9ce7a710-7abb-4eef-93b0-1b7dac768220";
const TEST_HANDLE = "test_user_01";

const token = sign({ sub: TEST_USER_ID, role: "USER" }, JWT_SECRET, {
  issuer: "spotly-api",
  audience: "spotly-client",
  expiresIn: "15m",
});

// Log token
console.log("Use this JWT for authenticated requests (expires in 15 minutes):");
console.log(token);

const ASSETS = path.join(__dirname, "test-assets");

function multipart(
  fieldName: string,
  filename: string,
  mime: string,
  buf: Buffer,
) {
  const boundary = "boundary" + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, buf, tail]), boundary };
}

function req(
  method: string,
  urlPath: string,
  opts: {
    body?: Buffer | string;
    headers?: Record<string, string>;
    auth?: boolean;
  } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.auth) headers["Cookie"] = `access_token=${token}`;
    if (typeof opts.body === "string") {
      headers["Content-Type"] ??= "application/json";
      headers["Content-Length"] = Buffer.byteLength(opts.body).toString();
    } else if (opts.body instanceof Buffer) {
      headers["Content-Length"] = opts.body.length.toString();
    }
    const r = http.request(
      { hostname: "localhost", port: PORT, path: urlPath, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

const get = (p: string, auth = false) => req("GET", p, { auth });
const patch = (p: string, body: object) =>
  req("PATCH", p, { body: JSON.stringify(body), auth: true });
const put = (p: string, body: object) =>
  req("PUT", p, { body: JSON.stringify(body), auth: true });
const post = (p: string, buf: Buffer, boundary: string) =>
  req("POST", p, {
    body: buf,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    auth: true,
  });

interface Result {
  label: string;
  section: string;
  status: number;
  ok: boolean;
  response: unknown;
}
const results: Result[] = [];

function record(
  label: string,
  section: string,
  res: { status: number; body: string },
  expected: number,
) {
  let response: unknown;
  try {
    response = JSON.parse(res.body);
  } catch {
    response = res.body;
  }
  const ok = res.status === expected;
  results.push({ label, section, status: res.status, ok, response });
  console.log(`${ok ? "✅" : "❌"}  [${res.status}] ${label}`);
}

async function run() {
  console.log(`\nJWT user: ${TEST_USER_ID}  handle: ${TEST_HANDLE}\n`);

  record("GET /health", "Infrastructure", await get("/api/v1/health"), 200);

  record(
    "GET /profiles/me  (auth)",
    "M2 §2.1 - own profile, full shape",
    await get("/api/v1/profiles/me", true),
    200,
  );

  record(
    "GET /profiles/me  (no auth)",
    "M2 §2.1 - auth guard",
    await get("/api/v1/profiles/me"),
    401,
  );

  record(
    `GET /profiles/${TEST_HANDLE}`,
    "M2 §2.2 - public profile by handle",
    await get(`/api/v1/profiles/${TEST_HANDLE}`),
    200,
  );

  record(
    "GET /profiles/no_such_user_xyz",
    "M2 §2.2 - 404 for unknown handle",
    await get("/api/v1/profiles/no_such_user_xyz"),
    404,
  );

  record(
    "GET /check-handle  (available)",
    "M2 §2.3 - handle free",
    await get("/api/v1/profiles/check-handle?handle=available_handle"),
    200,
  );

  record(
    `GET /check-handle  (taken: ${TEST_HANDLE})`,
    "M2 §2.3 - handle taken",
    await get(`/api/v1/profiles/check-handle?handle=${TEST_HANDLE}`),
    200,
  );

  record(
    'GET /check-handle  (invalid: "A")',
    "M2 §2.3 - regex validation → 400",
    await get("/api/v1/profiles/check-handle?handle=A"),
    400,
  );

  record(
    "PATCH /profiles/me  (bio, location, display_name)",
    "M2 §2.4 - partial profile edit",
    await patch("/api/v1/profiles/me", {
      display_name: "Ammar magnus",
      bio: "Bio wkda test test yahia heikal 123",
      location: "Alexandria, Egypt",
      is_private: false,
      account_type: "ARTIST",
    }),
    200,
  );

  record(
    "PATCH /profiles/me  (website URL)",
    "M2 §2.4 - website field",
    await patch("/api/v1/profiles/me", {
      website: "https://testuser.example.com",
    }),
    200,
  );

  record(
    "PATCH /profiles/me  (bio > 500 chars → 400)",
    "M2 §2.4 - bio length validation",
    await patch("/api/v1/profiles/me", { bio: "x".repeat(501) }),
    400,
  );

  record(
    "PATCH /profiles/me  (no auth → 401)",
    "M2 §2.4 - auth guard on update",
    await req("PATCH", "/api/v1/profiles/me", {
      body: JSON.stringify({ bio: "x" }),
    }),
    401,
  );

  record(
    "PATCH /profiles/me  (favorite_genres)",
    "M2 §2.5 - update genre set",
    await patch("/api/v1/profiles/me", {
      favorite_genres: ["electronic", "hip-hop", "lo-fi"],
    }),
    200,
  );

  record(
    "PUT /profiles/me/links  (add 2 links)",
    "M2 §2.6 - full-replace with GitHub + Twitter",
    await put("/api/v1/profiles/me/links", {
      links: [
        { platform: "github", url: "https://github.com/testuser" },
        { platform: "twitter", url: "https://twitter.com/testuser" },
      ],
    }),
    200,
  );

  record(
    "PUT /profiles/me/links  (links: [] → clear)",
    "M2 §2.6 - clear all links",
    await put("/api/v1/profiles/me/links", { links: [] }),
    200,
  );

  record(
    "PUT /profiles/me/links  (private IP → 400)",
    "M2 §2.6 - SSRF guard",
    await put("/api/v1/profiles/me/links", {
      links: [{ platform: "website", url: "http://192.168.1.1/admin" }],
    }),
    400,
  );

  const avatarBuf = fs.readFileSync(path.join(ASSETS, "avatar.png"));
  const av = multipart("file", "avatar.png", "image/png", avatarBuf);
  const avatarRes = await post(
    "/api/v1/profiles/me/avatar",
    av.body,
    av.boundary,
  );
  record(
    "POST /profiles/me/avatar  (test-assets/avatar.png)",
    "M2 §2.7 - avatar upload",
    avatarRes,
    201,
  );

  const coverBuf = fs.readFileSync(path.join(ASSETS, "cover.png"));
  const cv = multipart("file", "cover.png", "image/png", coverBuf);
  const coverRes = await post(
    "/api/v1/profiles/me/cover",
    cv.body,
    cv.boundary,
  );
  record(
    "POST /profiles/me/cover  (test-assets/cover.png)",
    "M2 §2.7 - cover upload",
    coverRes,
    201,
  );

  record(
    "POST /profiles/me/banner  (invalid type → 400)",
    "M2 §2.7 - :type param validation",
    await post("/api/v1/profiles/me/banner", av.body, av.boundary),
    400,
  );

  // Verify uploaded URLs are actually reachable
  const avatarUrl = (JSON.parse(avatarRes.body) as { url: string }).url;
  const coverUrl = (JSON.parse(coverRes.body) as { url: string }).url;
  const checkUrl = (label: string, url: string) =>
    req("GET", new URL(url).pathname).then((r) => {
      const ok = r.status === 200;
      results.push({
        label,
        section: "M2 §2.7 - static file served",
        status: r.status,
        ok,
        response: url,
      });
      console.log(`${ok ? "✅" : "❌"}  [${r.status}] ${label}  →  ${url}`);
    });

  await checkUrl("GET avatar URL in browser", avatarUrl);
  await checkUrl("GET cover URL in browser", coverUrl);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(68));
  for (const r of results) {
    const preview = JSON.stringify(r.response, null, 2);
    console.log(`\n${r.ok ? "✅" : "❌"}  ${r.label}`);
    console.log(`   section  : ${r.section}`);
    console.log(`   status   : ${r.status}`);
    console.log(
      `   response : ${preview.length > 300 ? preview.slice(0, 300) + "…" : preview}`,
    );
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(68)}`);
  console.log(
    `TOTAL ${results.length}  |  PASS ${pass}  |  FAIL ${results.length - pass}`,
  );
  console.log("─".repeat(68) + "\n");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
