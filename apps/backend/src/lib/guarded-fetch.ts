/**
 * A GET for documents a third party names, such as an OAuth client's metadata
 * document and its keys (client ID metadata documents, the OpenAI plugin
 * directory round, recipe c1c4bbd1). The URL comes from an unauthenticated
 * request, so this is a server-side request forgery surface, and the fetch is
 * built to reach only the public internet:
 *
 *   - https only, the default port only, no credentials or fragment in the URL;
 *   - the address the socket connects to must be public: the check sits in
 *     the connection's own DNS lookup (and on an IP literal, which skips the
 *     lookup), so a name cannot resolve to a public address for a check and a
 *     private one for the connection (DNS rebinding); if any address a name
 *     resolves to is not public, the fetch is refused;
 *   - no redirects (a 3xx is a refusal, never followed);
 *   - a status of 200, a JSON content type, a byte cap and a deadline.
 *
 * It doesn't throw: every refusal is `{ ok: false, reason }`, and callers map
 * them to a client error. The transport is a parameter so tests can exercise
 * the response handling without a network.
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { IncomingMessage, ClientRequest, RequestOptions } from "node:http";

export type GuardedFetchResult = { ok: true; body: string } | { ok: false; reason: string };

export interface GuardedFetchOptions {
  maxBytes: number;
  timeoutMs: number;
}

/** What the fetch needs from node:https, injectable for tests. */
export type RequestFn = (options: RequestOptions, callback: (res: IncomingMessage) => void) => ClientRequest;

// Every range that is not ordinary public unicast. IANA special-purpose
// registries (RFC 6890 and successors) for both families. One list per
// family: a BlockList checks an IPv4 address against its IPv6 rules in
// IPv4-mapped form, so the ::ffff:0:0/96 rule in a shared list would refuse
// every IPv4 address.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (carrier NAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata endpoints
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const) {
  BLOCKED_V4.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated), which embeds an IPv4 address (F125)
  // IPv4-mapped. Only the dotted form dns.lookup returns is judged by the
  // IPv4 rules (isPublicAddress); the hex form the URL parser produces is
  // refused here outright, mapped public addresses included.
  ["::ffff:0:0", 96],
  ["::ffff:0:0:0", 96], // IPv4-translated (SIIT), which embeds an IPv4 address (F125)
  ["64:ff9b::", 96], // NAT64, which can reach private IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo included)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated, still routed internally by some networks) (F125)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED_V6.addSubnet(prefix, bits, "ipv6");
}

/** True only for an ordinary public unicast address. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !BLOCKED_V6.check(address, "ipv6");
  }
  return false;
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type DnsLookupAll = (hostname: string, options: { all: true }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * A `lookup` for the socket that resolves every address and refuses unless
 * all of them are public. Honors both callback shapes Node uses (`all` for
 * happy-eyeballs connection attempts, a single address otherwise).
 */
export function guardedLookup(resolve: DnsLookupAll = dns.lookup as unknown as DnsLookupAll) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, "");
      if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
        const refusal: NodeJS.ErrnoException = new Error(`refused: ${hostname} resolves to a non-public address`);
        refusal.code = "EADDRNOTPUBLIC";
        return callback(refusal, "");
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0]!;
      return callback(null, first.address, first.family);
    });
  };
}

type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** The host checks every URL gets: a non-public IP literal (in any spelling
 *  the URL parser normalizes) or a localhost name is refused before any
 *  request, since a literal skips the lookup guard. */
function checkHost(url: URL): UrlCheck {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) return { ok: false, reason: "non-public address" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "non-public address" };
  return { ok: true, url };
}

/** The URL checks that need no network. Returns the parsed URL or a reason. */
export function checkFetchableUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not an absolute URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials in URL" };
  if (url.hash !== "" || raw.includes("#")) return { ok: false, reason: "fragment in URL" };
  if (url.port !== "") return { ok: false, reason: "non-default port" };
  return checkHost(url);
}

type Hop =
  | { kind: "body"; body: Buffer; contentType: string }
  | { kind: "redirect"; location: string | undefined }
  | { kind: "refused"; reason: string };

interface HopOptions {
  maxBytes: number;
  /** Epoch milliseconds by which the whole fetch must be done. */
  deadlineAt: number;
  accept: string;
  userAgent: string;
  /** Refuses the response before its body is read when it returns a reason. */
  checkType?: (contentType: string) => string | undefined;
}

type FetchDeps = { request?: RequestFn; lookup?: ReturnType<typeof guardedLookup> };

/** One GET through the public-address lookup. A 3xx comes back as a redirect
 *  for the caller to judge; it is never followed here. */
function getOnce(url: URL, opts: HopOptions, deps: FetchDeps): Promise<Hop> {
  const secure = url.protocol === "https:";
  const request = deps.request ?? ((secure ? https.request : http.request) as unknown as RequestFn);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (hop: Hop): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(hop);
    };

    let req: ClientRequest;
    const deadline = setTimeout(() => {
      finish({ kind: "refused", reason: "timed out" });
      req?.destroy();
    }, Math.max(0, opts.deadlineAt - Date.now()));

    try {
      req = request(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port !== "" ? Number(url.port) : secure ? 443 : 80,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { accept: opts.accept, "user-agent": opts.userAgent },
          lookup: (deps.lookup ?? guardedLookup()) as unknown as RequestOptions["lookup"],
          agent: false,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            const location = res.headers.location;
            finish({ kind: "redirect", location: typeof location === "string" ? location : undefined });
            req.destroy();
            return;
          }
          if (status !== 200) {
            res.resume();
            finish({ kind: "refused", reason: `status ${status}` });
            req.destroy();
            return;
          }
          const type = String(res.headers["content-type"] ?? "").toLowerCase();
          const typeRefusal = opts.checkType?.(type);
          if (typeRefusal) {
            res.resume();
            finish({ kind: "refused", reason: typeRefusal });
            req.destroy();
            return;
          }
          const declared = Number(res.headers["content-length"] ?? "0");
          if (declared > opts.maxBytes) {
            finish({ kind: "refused", reason: "too large" });
            req.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer | string) => {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            size += bytes.length;
            if (size > opts.maxBytes) {
              finish({ kind: "refused", reason: "too large" });
              req.destroy();
              return;
            }
            chunks.push(bytes);
          });
          res.on("end", () => finish({ kind: "body", body: Buffer.concat(chunks), contentType: type }));
          res.on("error", () => finish({ kind: "refused", reason: "read failed" }));
        },
      );
    } catch {
      finish({ kind: "refused", reason: "request failed" });
      return;
    }
    req.on("error", (err: NodeJS.ErrnoException) => {
      finish({ kind: "refused", reason: err.code === "EADDRNOTPUBLIC" ? "non-public address" : "request failed" });
    });
    req.end();
  });
}

export async function guardedFetch(raw: string, opts: GuardedFetchOptions, deps: FetchDeps = {}): Promise<GuardedFetchResult> {
  const checked = checkFetchableUrl(raw);
  if (!checked.ok) return checked;
  const hop = await getOnce(
    checked.url,
    {
      maxBytes: opts.maxBytes,
      deadlineAt: Date.now() + opts.timeoutMs,
      accept: "application/json",
      userAgent: "Soup.net OAuth metadata fetcher",
      checkType: (type) => (/^application\/([a-z0-9.+-]*\+)?json\b/.test(type) ? undefined : "not JSON"),
    },
    deps,
  );
  if (hop.kind === "redirect") return { ok: false, reason: "redirect refused" };
  if (hop.kind === "refused") return { ok: false, reason: hop.reason };
  return { ok: true, body: hop.body.toString("utf8") };
}
