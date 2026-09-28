import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const okFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("verifyTurnstile", () => {
  it("is off without a secret: every registration passes, and Cloudflare is never called", async () => {
    const fetchImpl = okFetch({ success: true });
    expect(await verifyTurnstile({ secret: undefined, token: undefined, fetchImpl })).toEqual({ ok: true, checked: false });
    expect(await verifyTurnstile({ secret: "", token: "anything", fetchImpl })).toEqual({ ok: true, checked: false });
    expect(fetchImpl, "self-hosters without Turnstile must not reach Cloudflare").not.toHaveBeenCalled();
  });

  it("rejects a missing token without calling Cloudflare", async () => {
    const fetchImpl = okFetch({ success: true });
    const r = await verifyTurnstile({ secret: "s", token: undefined, fetchImpl });
    expect(r).toEqual({ ok: false, checked: true, reason: "missing-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts secret and token to siteverify and passes when Cloudflare says success", async () => {
    const fetchImpl = okFetch({ success: true, hostname: "soup.net" });
    const r = await verifyTurnstile({ secret: "s3cret", token: "tok", fetchImpl });
    expect(r).toEqual({ ok: true, checked: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("secret")).toBe("s3cret");
    expect(form.get("response")).toBe("tok");
  });

  it("rejects when Cloudflare says the token is invalid, keeping its error codes", async () => {
    const r = await verifyTurnstile({ secret: "s", token: "bad", fetchImpl: okFetch({ success: false, "error-codes": ["invalid-input-response"] }) });
    expect(r).toEqual({ ok: false, checked: true, reason: "invalid-input-response" });
  });

  it("fails closed when Cloudflare can't be reached, so bots can't slip through an outage", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); });
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: down })).toEqual({ ok: false, checked: true, reason: "unreachable" });
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: okFetch({}, 502) })).toEqual({ ok: false, checked: true, reason: "unreachable" });
  });
});
