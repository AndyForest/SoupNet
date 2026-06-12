import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for /uploads route — requires running backend.
 * Skips if BACKEND_URL is not set. Run via `npx vitest run` against the
 * dev Docker stack, or via `npm run test:ci` against the isolated CI stack.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

// 1x1 transparent PNG — same fixture used by file-store.test.ts
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

interface RegisterResponse {
  data?: { token?: string; verificationToken?: string };
}
interface KeyResponse {
  data?: { key?: string };
}
interface UploadResponse {
  ok: boolean;
  error?: string;
  file_url?: string;
  content_hash?: string;
  mime_type?: string;
  size_bytes?: number;
}

async function registerVerifiedUserAndKey(suffix: string): Promise<string> {
  const email = `uploads-${uid}-${suffix}@test.local`;
  const password = "uploads-test-password-123";
  const regRes = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await regRes.json()) as RegisterResponse;
  const verificationToken = regBody.data?.verificationToken;
  if (!verificationToken) {
    throw new Error("Failed to register test user — ALLOW_AUTO_SETUP must be true in dev");
  }
  const verifyRes = await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verificationToken }),
  });
  if (!verifyRes.ok) throw new Error("Failed to verify test user");

  // F30: log in for the JWT (register no longer returns it).
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await loginRes.json()) as { data?: { token?: string } };
  const token = loginBody.data?.token;
  if (!token) throw new Error("Failed to log in test user");

  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const keyBody = (await keyRes.json()) as KeyResponse;
  const key = keyBody.data?.key;
  if (!key) throw new Error("Failed to generate test API key");
  return key;
}

function pngFormBody(filename: string, mime = "image/png"): FormData {
  const fd = new FormData();
  fd.set("file", new Blob([TINY_PNG], { type: mime }), filename);
  return fd;
}

let apiKey = "";
let otherKey = "";

describe.skipIf(!BASE)("/uploads route integration", () => {
  beforeAll(async () => {
    apiKey = await registerVerifiedUserAndKey("a");
    otherKey = await registerVerifiedUserAndKey("b");
  });

  it("rejects upload without Authorization header", async () => {
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      body: pngFormBody("x.png"),
    });
    expect(res.status).toBe(401);
  });

  it("rejects upload with invalid API key", async () => {
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-real-key" },
      body: pngFormBody("x.png"),
    });
    expect(res.status).toBe(401);
  });

  it("rejects upload with no file field", async () => {
    const fd = new FormData();
    fd.set("notfile", new Blob([TINY_PNG], { type: "image/png" }), "x.png");
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    expect(res.status).toBe(400);
  });

  it("rejects upload with unsupported MIME type", async () => {
    const fd = new FormData();
    fd.set("file", new Blob([TINY_PNG], { type: "image/gif" }), "x.gif");
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    expect(res.status).toBe(415);
  });

  it("happy path: returns file_url that points back to /uploads/<uuid>", async () => {
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: pngFormBody("happy.png"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadResponse;
    expect(body.ok).toBe(true);
    expect(body.file_url).toMatch(/\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(body.mime_type).toBe("image/png");
    expect(body.size_bytes).toBe(TINY_PNG.length);
  });

  it("GET /uploads/<id>.png returns 404 even with valid uploader key", async () => {
    const upRes = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: pngFormBody("get-blocked.png"),
    });
    const upBody = (await upRes.json()) as UploadResponse;
    expect(upBody.ok).toBe(true);
    const url = upBody.file_url ?? "";

    // Anonymous GET → 404
    const anon = await fetch(url);
    expect(anon.status).toBe(404);

    // Authenticated GET (uploader's own key) → still 404, by design
    const authed = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(authed.status).toBe(404);
  });

  // The end-to-end "check_recipe resolves an own-hostname file_url" path is
  // exercised manually (Layer 4) via the MCP transport. The /check web route
  // does not accept file_url, so we can't drive that path from a raw fetch.

  // Cross-key isolation is enforced inside resolveUpload() with a single
  // api_key_id equality check (apps/backend/src/services/upload.service.ts).
  // Exercising it through HTTP would require an MCP JSON-RPC client; we
  // verify the routing logic via unit tests on parseOwnHostnameUpload and
  // rely on code review for the equality check itself.

  it("duplicate bytes from different keys produce different file_urls but same content_hash", async () => {
    const r1 = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: pngFormBody("dup1.png"),
    });
    const b1 = (await r1.json()) as UploadResponse;

    const r2 = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherKey}` },
      body: pngFormBody("dup2.png"),
    });
    const b2 = (await r2.json()) as UploadResponse;

    expect(b1.ok).toBe(true);
    expect(b2.ok).toBe(true);
    expect(b1.content_hash).toBe(b2.content_hash);
    expect(b1.file_url).not.toBe(b2.file_url);
  });

  // F41: framework-level body cap, mirroring the F28 fix on /check. Must be
  // the LAST test in this describe — bodyLimit emits the 413 before draining
  // the request, which can break the next request on the same keep-alive
  // socket (see the F28 test in check.test.ts for the full rationale).
  it("F41: POST /uploads rejects bodies over 21 MiB at the framework layer", async () => {
    const oversize = "x".repeat(22 * 1024 * 1024);
    const fd = new FormData();
    fd.set("file", new Blob([oversize], { type: "image/png" }), "huge.png");
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    expect(res.status).toBe(413);
  }, 15_000);
});
