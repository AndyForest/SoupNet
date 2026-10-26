import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ClientRequest, RequestOptions } from "node:http";
import { checkFetchableUrl, checkFileUrl, guardedFetch, guardedFetchFile, guardedLookup, isPublicAddress } from "./guarded-fetch";
import type { RequestFn } from "./guarded-fetch";

/** Rubric O5-2 (docs/planning/openai-plugin-build/oauth.md). */

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::FFFF:169.254.169.254", "64:ff9b::a00:1", "2001:db8::1",
    "2002:a00:1::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "not-an-ip", "",
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

/** Rubric F1 to F8 (docs/planning/openai-plugin-build/file-url-guard.md). */

describe("checkFileUrl", () => {
  it.each([
    ["ftp://example.com/a.png", "not http or https"],
    ["file:///etc/passwd", "not http or https"],
    ["https://user:pw@example.com/a.png", "credentials in URL"],
    ["http://127.0.0.1/a.png", "non-public address"],
    ["http://2130706433/a.png", "non-public address"],
    ["http://0177.0.0.1/a.png", "non-public address"],
    ["http://0x7f000001/a.png", "non-public address"],
    ["http://127.1/a.png", "non-public address"],
    ["http://0/a.png", "non-public address"],
    ["http://[::1]/a.png", "non-public address"],
    ["http://[0:0:0:0:0:0:0:1]/a.png", "non-public address"],
    ["http://[::ffff:127.0.0.1]/a.png", "non-public address"],
    ["http://[::ffff:a9fe:a9fe]/latest/meta-data", "non-public address"],
    ["http://169.254.169.254/latest/meta-data", "non-public address"],
    ["http://10.0.0.5:3101/health", "non-public address"],
    ["http://localhost/a.png", "non-public address"],
    ["http://LOCALHOST./a.png", "non-public address"],
    ["http://api.localhost/a.png", "non-public address"],
    ["a.png", "not an absolute URL"],
  ])("refuses %s (%s)", (raw, reason) => {
    expect(checkFileUrl(raw)).toEqual({ ok: false, reason });
  });

  it.each(["http://example.com/a.png", "https://cdn.example.com:8443/a.png", "https://example.com/a.png#frag", "http://93.184.216.34/a.png"])(
    "accepts %s",
    (raw) => {
      expect(checkFileUrl(raw).ok).toBe(true);
    },
  );
});

/** Scripted responses, one per request in order. */
function fakeChain(scripts: Parameters<typeof fakeRequest>[0][]) {
  const seen: RequestOptions[] = [];
  const fn: RequestFn = (options, callback) => {
    const hop = fakeRequest(scripts[seen.length] ?? { status: 500 });
    seen.push(options);
    return hop.fn(options, callback);
  };
  return { fn, seen };
}

const FILE_OPTS = { maxBytes: 64, timeoutMs: 200, maxRedirects: 3 };
const FILE_URL = "https://img.example.com/a.png";
const PNG = { "content-type": "image/png" };

describe("guardedFetchFile", () => {
  it("returns the bytes, type and final URL of a 200, through the guarded lookup", async () => {
    const { fn, seen } = fakeChain([{ headers: PNG, chunks: ["head", "rest"] }]);
    const result = await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.toString("utf8")).toBe("headrest");
    expect(result.contentType).toBe("image/png");
    expect(result.finalUrl.href).toBe(FILE_URL);
    expect(seen[0]?.port).toBe(443);
    expect(seen[0]?.headers).toMatchObject({ accept: "*/*" });
    expect(typeof seen[0]?.lookup).toBe("function");
  });

  it("uses plain http and the URL's port when it names them", async () => {
    const { fn, seen } = fakeChain([{ headers: PNG }]);
    expect((await guardedFetchFile("http://img.example.com:8080/a.png", FILE_OPTS, { request: fn })).ok).toBe(true);
    expect(seen[0]?.protocol).toBe("http:");
    expect(seen[0]?.port).toBe(8080);
  });

  it("follows up to three redirects, resolving relative locations, with every hop guarded", async () => {
    const { fn, seen } = fakeChain([
      { status: 301, headers: { location: "https://cdn.example.com/x" } },
      { status: 302, headers: { location: "/y.png?v=1" } },
      { status: 307, headers: { location: "https://cdn.example.com:8443/z.png" } },
      { headers: PNG },
    ]);
    const result = await guardedFetchFile("http://img.example.com/a.png", FILE_OPTS, { request: fn });
    expect(result.ok).toBe(true);
    expect(seen.map((o) => `${o.protocol}//${o.hostname}:${o.port}${o.path}`)).toEqual([
      "http://img.example.com:80/a.png",
      "https://cdn.example.com:443/x",
      "https://cdn.example.com:443/y.png?v=1",
      "https://cdn.example.com:8443/z.png",
    ]);
    expect(seen.every((o) => typeof o.lookup === "function")).toBe(true);
    if (result.ok) expect(result.finalUrl.href).toBe("https://cdn.example.com:8443/z.png");
  });

  it("refuses a fourth redirect", async () => {
    const hop = { status: 302, headers: { location: "https://cdn.example.com/next" } };
    const { fn, seen } = fakeChain([hop, hop, hop, hop, { headers: PNG }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason: "too many redirects" });
    expect(seen).toHaveLength(4);
  });

  it.each([
    ["https://169.254.169.254/latest/meta-data/", "redirect refused: non-public address"],
    ["https://127.0.0.1:3101/health", "redirect refused: non-public address"],
    ["https://[::ffff:7f00:1]/", "redirect refused: non-public address"],
    ["https://2130706433/", "redirect refused: non-public address"],
    ["https://localhost/", "redirect refused: non-public address"],
    ["file:///etc/passwd", "redirect refused: not http or https"],
    ["http://169.254.169.254/latest/meta-data/", "redirect from https to http refused"],
    ["http://img.example.com/a.png", "redirect from https to http refused"],
  ])("refuses a redirect to %s and never requests it", async (location, reason) => {
    const { fn, seen } = fakeChain([{ status: 302, headers: { location } }, { headers: PNG }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason });
    expect(seen).toHaveLength(1);
  });

  it("refuses a redirect from http to a non-public address", async () => {
    const { fn, seen } = fakeChain([{ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }, { headers: PNG }]);
    expect(await guardedFetchFile("http://img.example.com/a.png", FILE_OPTS, { request: fn })).toEqual({
      ok: false,
      reason: "redirect refused: non-public address",
    });
    expect(seen).toHaveLength(1);
  });

  it("refuses a redirect with no location", async () => {
    const { fn } = fakeChain([{ status: 302, headers: {} }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason: "redirect without a location" });
  });

  it("refuses a non-200 final status", async () => {
    const { fn } = fakeChain([{ status: 403, headers: PNG }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason: "status 403" });
  });

  it("refuses a body over the cap, declared or chunked without a length", async () => {
    const declared = fakeChain([{ headers: { ...PNG, "content-length": "65" } }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: declared.fn })).toEqual({ ok: false, reason: "too large" });
    const chunked = fakeChain([{ headers: PNG, chunks: ["x".repeat(40), "x".repeat(40), "x".repeat(40)] }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: chunked.fn })).toEqual({ ok: false, reason: "too large" });
  });

  it("holds one deadline across the whole chain", async () => {
    const { fn } = fakeChain([{ status: 302, headers: { location: "https://cdn.example.com/x" } }, { hang: true }]);
    const started = Date.now();
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason: "timed out" });
    expect(Date.now() - started).toBeLessThan(FILE_OPTS.timeoutMs + 150);
  });

  it("reports a refused lookup as a non-public address", async () => {
    const { fn } = fakeChain([{ error: "EADDRNOTPUBLIC" }]);
    expect(await guardedFetchFile(FILE_URL, FILE_OPTS, { request: fn })).toEqual({ ok: false, reason: "non-public address" });
  });

  it("never sends a request for a URL that fails the static checks", async () => {
    const { fn, seen } = fakeChain([{ headers: PNG }]);
    expect((await guardedFetchFile("http://0x7f000001/a.png", FILE_OPTS, { request: fn })).ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
