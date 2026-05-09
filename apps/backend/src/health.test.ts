import { describe, it, expect } from "vitest";

const BASE = process.env["BACKEND_URL"] ?? "";

describe.skipIf(!BASE)("health endpoints", () => {
  it("GET /health returns 200 without touching the DB", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /health/ready returns 200 when the DB is reachable", async () => {
    const res = await fetch(`${BASE}/health/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
