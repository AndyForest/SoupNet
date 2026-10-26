/**
 * The server's identity as an OAuth protected resource and authorization
 * server (OpenAI plugin directory round, stream O; recipe 0cfb2ec7).
 *
 * One string serves as the RFC 8414 `issuer`, the RFC 9728 protected-resource
 * `resource` and its `authorization_servers` entry, the RFC 9207 `iss` on
 * every authorization response, and the audience every OAuth access token is
 * bound to. It is the server's origin (`BACKEND_URL`), with no `/mcp` path:
 * ChatGPT sends the metadata's `resource` value back byte for byte, and
 * MCP SDK clients accept a metadata resource that prefixes the endpoint URL.
 * A client that sends the MCP endpoint URL itself (the MCP specification's
 * canonical URI) is accepted as an alias; any other value is refused.
 */

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/** The canonical resource identifier, which is also the issuer. */
export function canonicalResource(): string {
  return stripTrailingSlashes(process.env["BACKEND_URL"] ?? "http://localhost:3101");
}

/** The path the MCP endpoint is mounted at, relative to the origin. */
const MCP_PATH = "/mcp";

export type ResourceResult = { ok: true; resource: string } | { ok: false };

/**
 * Normalize a requested RFC 8707 `resource` to the canonical identifier.
 * Absent or empty means the canonical one (clients that predate RFC 8707,
 * claude.ai's today). Accepted spellings: the canonical value, and the MCP
 * endpoint under it, each with or without a trailing slash. Refused: another
 * origin or path, a query, a fragment, userinfo, or a value that is not an
 * absolute URL. The caller answers a refusal with `invalid_target`.
 */
export function normalizeResource(raw: string | null | undefined): ResourceResult {
  const canonical = canonicalResource();
  if (raw === undefined || raw === null || raw === "") return { ok: true, resource: canonical };
  let requested: URL;
  let base: URL;
  try {
    requested = new URL(raw);
    base = new URL(canonical);
  } catch {
    return { ok: false };
  }
  if (requested.hash !== "" || raw.includes("#")) return { ok: false };
  if (requested.search !== "" || raw.includes("?")) return { ok: false };
  if (requested.username !== "" || requested.password !== "") return { ok: false };
  if (requested.origin !== base.origin) return { ok: false };
  const basePath = stripTrailingSlashes(base.pathname);
  const path = stripTrailingSlashes(requested.pathname);
  if (path !== basePath && path !== `${basePath}${MCP_PATH}`) return { ok: false };
  return { ok: true, resource: canonical };
}

/** The URL of the protected-resource metadata, for WWW-Authenticate. */
export function resourceMetadataUrl(): string {
  return `${canonicalResource()}/.well-known/oauth-protected-resource`;
}
