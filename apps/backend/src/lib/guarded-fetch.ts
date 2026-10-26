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
 * It never throws: every refusal is `{ ok: false, reason }`, and callers map
 * them all to one uniform client error. The transport is a parameter so tests
 * can exercise the response handling without a network.
 */
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
  ["::ffff:0:0", 96], // IPv4-mapped (judged by the IPv4 rules below)
  ["64:ff9b::", 96], // NAT64, which can reach private IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo included)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
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

/** The URL checks that need no network. Returns the parsed URL or a reason. */
export function checkFetchableUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
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
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) return { ok: false, reason: "non-public address" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "non-public address" };
  return { ok: true, url };
}

export function guardedFetch(
  raw: string,
  opts: GuardedFetchOptions,
  deps: { request?: RequestFn; lookup?: ReturnType<typeof guardedLookup> } = {},
): Promise<GuardedFetchResult> {
  const checked = checkFetchableUrl(raw);
  if (!checked.ok) return Promise.resolve(checked);
  const url = checked.url;
  const request = deps.request ?? (https.request as unknown as RequestFn);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: GuardedFetchResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };

    let req: ClientRequest;
    const deadline = setTimeout(() => {
      finish({ ok: false, reason: "timed out" });
      req?.destroy();
    }, opts.timeoutMs);

    try {
      req = request(
        {
          protocol: "https:",
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { accept: "application/json", "user-agent": "Soup.net OAuth metadata fetcher" },
          lookup: (deps.lookup ?? guardedLookup()) as unknown as RequestOptions["lookup"],
          agent: false,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            res.resume();
            finish({ ok: false, reason: status >= 300 && status < 400 ? "redirect refused" : `status ${status}` });
            req.destroy();
            return;
          }
          const type = String(res.headers["content-type"] ?? "").toLowerCase();
          if (!/^application\/([a-z0-9.+-]*\+)?json\b/.test(type)) {
            res.resume();
            finish({ ok: false, reason: "not JSON" });
            req.destroy();
            return;
          }
          const declared = Number(res.headers["content-length"] ?? "0");
          if (declared > opts.maxBytes) {
            finish({ ok: false, reason: "too large" });
            req.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > opts.maxBytes) {
              finish({ ok: false, reason: "too large" });
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => finish({ ok: true, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", () => finish({ ok: false, reason: "read failed" }));
        },
      );
    } catch {
      finish({ ok: false, reason: "request failed" });
      return;
    }
    req.on("error", (err: NodeJS.ErrnoException) => {
      finish({ ok: false, reason: err.code === "EADDRNOTPUBLIC" ? "non-public address" : "request failed" });
    });
    req.end();
  });
}
