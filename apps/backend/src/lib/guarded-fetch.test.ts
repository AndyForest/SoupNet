import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ClientRequest, RequestOptions } from "node:http";
import { checkFetchableUrl, guardedFetch, guardedLookup, isPublicAddress } from "./guarded-fetch";
import type { RequestFn } from "./guarded-fetch";

/** Rubric O5-2 (docs/planning/openai-plugin-build/oauth.md). */

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::FFFF:169.254.169.254", "64:ff9b::a00:1", "2001:db8::1",
    "2002:a00:1::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "not-an-ip", "",
    // F125: IPv4-compatible, IPv4-translated, site-local.
    "::7f00:1", "::808:808", "::ffff:0:7f00:1", "::ffff:0:a9fe:a9fe", "fec0::1", "feff::1",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "104.18.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe("checkFetchableUrl", () => {
  it.each([
    ["http://example.com/doc.json", "not https"],
    ["https://user:pw@example.com/doc.json", "credentials in URL"],
    ["https://example.com/doc.json#x", "fragment in URL"],
    ["https://example.com:8443/doc.json", "non-default port"],
    ["https://127.0.0.1/doc.json", "non-public address"],
    ["https://[::1]/doc.json", "non-public address"],
    ["https://169.254.169.254/latest/meta-data", "non-public address"],
    ["https://localhost/doc.json", "non-public address"],
    ["https://api.localhost/doc.json", "non-public address"],
    ["doc.json", "not an absolute URL"],
  ])("refuses %s (%s)", (raw, reason) => {
    expect(checkFetchableUrl(raw)).toEqual({ ok: false, reason });
  });

  it("accepts a public https URL", () => {
    expect(checkFetchableUrl("https://chatgpt.com/oauth/client.json").ok).toBe(true);
  });
});

describe("guardedLookup", () => {
  type Addr = { address: string; family: number };
  const resolver = (addresses: Addr[]) =>
    (_h: string, _o: { all: true }, cb: (err: NodeJS.ErrnoException | null, a: Addr[]) => void) => cb(null, addresses);

  function run(addresses: Addr[], all: boolean): Promise<{ err: NodeJS.ErrnoException | null; result: unknown; family: number | undefined }> {
    return new Promise((resolve) => {
      guardedLookup(resolver(addresses))("example.com", { all }, (err, result, family) => resolve({ err, result, family }));
    });
  }

  it("passes public addresses through, in both callback shapes", async () => {
    const pub = [{ address: "93.184.216.34", family: 4 }];
    expect((await run(pub, true)).result).toEqual(pub);
    const single = await run(pub, false);
    expect(single.result).toBe("93.184.216.34");
    expect(single.family).toBe(4);
  });

  it("refuses when any resolved address is not public (rebinding to a private address)", async () => {
    const mixed = [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    const { err } = await run(mixed, true);
    expect(err?.code).toBe("EADDRNOTPUBLIC");
    expect((await run([{ address: "::1", family: 6 }], false)).err?.code).toBe("EADDRNOTPUBLIC");
    expect((await run([], false)).err?.code).toBe("EADDRNOTPUBLIC");
  });
});

/** A fake https.request: records the options and answers with a scripted response. */
function fakeRequest(script: { status?: number; headers?: Record<string, string>; chunks?: string[]; hang?: boolean; error?: string }) {
  const seen: RequestOptions[] = [];
  const fn: RequestFn = (options, callback) => {
    seen.push(options);
    const req = new EventEmitter() as unknown as ClientRequest & { destroyed: boolean };
    (req as unknown as { destroy: () => void }).destroy = () => {
      req.destroyed = true;
    };
    (req as unknown as { end: () => void }).end = () => {
      if (script.error) {
        const err: NodeJS.ErrnoException = new Error(script.error);
        err.code = script.error;
        setImmediate(() => req.emit("error", err));
        return;
      }
      if (script.hang) return;
      const res = new PassThrough() as unknown as IncomingMessage;
      res.statusCode = script.status ?? 200;
      res.headers = script.headers ?? { "content-type": "application/json" };
      setImmediate(() => {
        callback(res);
        for (const c of script.chunks ?? ["{}"]) (res as unknown as PassThrough).write(c);
        (res as unknown as PassThrough).end();
      });
    };
    return req;
  };
  return { fn, seen };
}

const OPTS = { maxBytes: 64, timeoutMs: 200 };
const URL_OK = "https://client.example.com/oauth/client.json";

describe("guardedFetch", () => {
  it("returns the body of a 200 JSON response and sends the guarded lookup", async () => {
    const { fn, seen } = fakeRequest({ chunks: ['{"a":', "1}"] });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: true, body: '{"a":1}' });
    expect(seen[0]?.hostname).toBe("client.example.com");
    expect(seen[0]?.path).toBe("/oauth/client.json");
    expect(seen[0]?.port).toBe(443);
    expect(typeof seen[0]?.lookup).toBe("function");
  });

  it("accepts a +json content type", async () => {
    const { fn } = fakeRequest({ headers: { "content-type": "application/jwk-set+json; charset=utf-8" } });
    expect((await guardedFetch(URL_OK, OPTS, { request: fn })).ok).toBe(true);
  });

  it("refuses a redirect without following it", async () => {
    const { fn, seen } = fakeRequest({ status: 302, headers: { location: "https://169.254.169.254/" } });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: false, reason: "redirect refused" });
    expect(seen).toHaveLength(1);
  });

  it("refuses a non-200 status", async () => {
    const { fn } = fakeRequest({ status: 404 });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: false, reason: "status 404" });
  });

  it("refuses a non-JSON content type", async () => {
    const { fn } = fakeRequest({ headers: { "content-type": "text/html" } });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: false, reason: "not JSON" });
  });

  it("refuses a body over the cap, declared or streamed", async () => {
    const declared = fakeRequest({ headers: { "content-type": "application/json", "content-length": "65" } });
    expect(await guardedFetch(URL_OK, OPTS, { request: declared.fn })).toEqual({ ok: false, reason: "too large" });
    const streamed = fakeRequest({ chunks: ["x".repeat(40), "x".repeat(40)] });
    expect(await guardedFetch(URL_OK, OPTS, { request: streamed.fn })).toEqual({ ok: false, reason: "too large" });
  });

  it("refuses a response that does not arrive before the deadline", async () => {
    const { fn } = fakeRequest({ hang: true });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: false, reason: "timed out" });
  });

  it("reports a refused lookup as a non-public address", async () => {
    const { fn } = fakeRequest({ error: "EADDRNOTPUBLIC" });
    expect(await guardedFetch(URL_OK, OPTS, { request: fn })).toEqual({ ok: false, reason: "non-public address" });
  });

  it("never sends a request for a URL that fails the static checks", async () => {
    const { fn, seen } = fakeRequest({});
    expect((await guardedFetch("https://10.0.0.1/x.json", OPTS, { request: fn })).ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
