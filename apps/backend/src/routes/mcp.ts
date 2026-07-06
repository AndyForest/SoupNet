/**
 * Remote MCP endpoint — Streamable HTTP transport for AI agents.
 *
 * Exposes the same check_recipe and get_briefing tools as the
 * local stdio MCP server, but over HTTP with Bearer token (API key) auth.
 *
 * Used by Google Antigravity and other remote MCP clients.
 * See: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 *
 * Auth: Bearer token in Authorization header. The token is a Soup.net API key
 * (daily or scoped). Same keys used for the /check endpoint.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  ALLOWED_MIME_TYPES,
  EXT_TO_MIME,
  MAX_UPLOAD_BYTES,
  MCP_PARAM_DESCRIPTIONS,
  MCP_TOOL_DESCRIPTIONS,
  buildCheckRecipeToolDescription,
  renderCheckResponseMarkdown,
} from "@soupnet/domain";
import type { CheckResponseJson } from "@soupnet/domain";
import { composeBriefing, composeCorpusContext } from "../services/briefing";
import { rateLimit, perKeyRateLimit, extractMcpBearerKey, getClientIp, hashApiKey } from "../middleware/rate-limit";
import type { SubmitAndSearchResult, ImageAttachment } from "../services/trace.service";
import { submitAndSearch } from "../services/trace.service";
import type { RegionMeta } from "../lib/image-roi";
import type { EnrichedResult } from "../services/result-enricher";
import { enrichResults, clusterEvidenceInResults } from "../services/result-enricher";
import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import {
  RECIPE_LOOKUP_MAX_IDS,
  lookupRecipes,
  parseRecipeIds,
  renderRecipeEntries,
} from "../services/recipe-lookup.service";
import {
  parseOwnHostnameUpload,
  getOwnHostname,
  resolveUpload,
  UploadResolutionError,
} from "../services/upload.service";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { writeAudit } from "../services/audit-log.service";
import { ClientSafeError, publicErrorMessage } from "../lib/client-safe-error";
import { invalidKeyMessage } from "../lib/key-remediation";
import type { RawFeedbackRow } from "../services/feedback.service";
import { ingestFeedback, summarizeFeedbackResults } from "../services/feedback.service";

// F47 (security-audit-2026-06-11): tool catch-alls surface only deliberate
// ClientSafeError messages (validation, size caps, MIME — written for the
// agent). Anything else is internal by default: generic body, raw error to
// the server log. Mirrors the auth.ts registration pattern.
function toolErrorText(err: unknown, tool: string): string {
  return `Error: ${publicErrorMessage(err, {
    logPrefix: `[mcp] ${tool} error`,
    generic:
      "An internal error occurred. It has been logged server-side — please retry, and contact the operator if it persists.",
  })}`;
}

// Rate limit MCP:
//   - per-IP: 1000 per hour (defense-in-depth)
//   - per-key: 200/hour, 1000/day (queried from audit_log; F29).
const mcpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });
const mcpPerKeyRateLimit = perKeyRateLimit({ keyExtractor: extractMcpBearerKey });

// F43 (security-audit-2026-06-11): the audit-log-backed limiter above counts
// only recipe.checked, so get_briefing / list_my_recipe_books / the write
// tool update_recipe_book_description were bounded per-IP only. This
// in-memory per-bearer backstop bounds a single key across ALL MCP methods
// regardless of IP; 600/h sits well above the 200/h durable check cap, so
// legitimate use never hits it first. Keyed by credential hash (raw keys
// must not sit in memory as map keys).
const mcpPerBearerBackstop = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const token = extractMcpBearerKey(c);
    return token ? `key:${hashApiKey(token)}` : `ip:${getClientIp(c)}`;
  },
});

// F41 (security-audit-2026-06-11): cap the JSON body before it is buffered,
// same rationale as the F28 fix on /check. The cap is sized for file_base64:
// MAX_UPLOAD_BYTES (20 MiB) of decoded bytes inflates 4/3 in base64, plus
// slack for the JSON-RPC envelope → 28 MiB.
const MCP_BODY_LIMIT_BYTES = 28 * 1024 * 1024;
const mcpBodyLimit = bodyLimit({
  maxSize: MCP_BODY_LIMIT_BYTES,
  onError: (c) =>
    c.json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Request body too large" } },
      413,
    ),
});

const mcpRouter = new Hono<AppEnv>();

// ── CORS for browser-based MCP clients ──────────────────────────────────────

mcpRouter.use(
  "/*",
  cors({
    origin: "*",
    credentials: false, // MCP uses Bearer tokens, not cookies — credentials not needed
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "Last-Event-ID",
      "mcp-protocol-version",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  }),
);

// ── Origin validation ───────────────────────────────────────────────────────
//
// The MCP transport spec (Streamable HTTP, 2025-03-26) says: "Servers SHOULD
// validate the Origin header on all incoming connections to prevent DNS
// rebinding attacks." Distinct from CORS, which is a browser concern — Origin
// validation is the server enforcing a whitelist regardless of who's calling.
//
// Browser-side MCP clients send an Origin header tied to their page origin.
// Server-to-server callers (claude.ai's cloud → mcp.soup.net) typically don't
// send Origin at all, so the absence-passes rule below preserves that path.
//
// Allowlist:
//   - Anthropic's web origins (claude.ai, claude.com) for the connector flow
//   - The frontend origin for any browser-based MCP testing from the SPA
//   - localhost variants for development
//
// Override with MCP_ALLOWED_ORIGINS (comma-separated) for self-hosted
// deployments that need to whitelist additional origins.

function getAllowedOrigins(): Set<string> {
  const fixed = [
    "https://claude.ai",
    "https://claude.com",
    process.env["FRONTEND_URL"] ?? "http://localhost:5273",
    process.env["BACKEND_URL"] ?? "http://localhost:3101",
  ];
  const extra = (process.env["MCP_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...fixed, ...extra]);
}

function isAllowedOrigin(origin: string, allowlist: Set<string>): boolean {
  if (allowlist.has(origin)) return true;
  // localhost on any port is acceptable for development — match scheme +
  // host without port-locking. Production deployments rely on the fixed list.
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")) {
      return true;
    }
  } catch {
    /* malformed origin — let it fall through to reject */
  }
  return false;
}

mcpRouter.use("/*", async (c, next) => {
  const origin = c.req.header("origin");
  // No Origin header → server-to-server call → pass through. The Bearer-token
  // check downstream is the security boundary in that case.
  if (!origin) return next();
  const allowlist = getAllowedOrigins();
  if (!isAllowedOrigin(origin, allowlist)) {
    return c.json({ error: "forbidden_origin", origin }, 403);
  }
  return next();
});

// Stateless mode (2026-04-18): no session map, no cleanup sweep.
// Each request gets a fresh transport+server per the SDK's stateless contract.
// The MCP TypeScript SDK's StreamableHTTP transport with `sessionIdGenerator:
// undefined` handles this — validateSession returns immediately, no -32001 404
// possible. This sidesteps the industry-wide broken-client recovery problem
// (Claude Code #27142, VSCode #253854, Cursor, LibreChat, Antigravity) by
// removing the session abstraction entirely.
//
// Trade-off: server→client elicitation/create is not usable (it needs the
// long-lived SSE channel that sessions provide). elicit_divergent_check was
// removed; the divergent-check pattern lives on as natural-language
// conversation in the briefings.
//
// If horizontal-scaling later requires session resumption, the canonical
// pattern is sticky LB + Redis state per modelcontextprotocol/example-remote-server.

// ── File input helpers (check_recipe multimodal support) ───────────────────
//
// The HTTP MCP server accepts reference-evidence files via two mutually
// exclusive inputs: `file_base64` (bytes inline) or `file_url` (public URL the
// server fetches on the agent's behalf). Both produce an ImageAttachment the
// existing submitAndSearch pipeline already understands.
//
// SSRF risk model: file_url asks the server to fetch an arbitrary URL. We
// mitigate with (a) http/https scheme check, (b) string-based private/
// loopback/link-local hostname rejection, (c) 10s timeout, (d) size cap at
// MAX_UPLOAD_BYTES, (e) MIME allowlist. This is best-effort at the
// application layer; DNS-resolution-aware filtering requires network-layer
// rules (documented in docs/security/).

const URL_FETCH_TIMEOUT_MS = 10_000;

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd00:/i,
  /\.internal$/i,
  /\.local$/i,
];

async function imageFromUrl(url: string): Promise<ImageAttachment> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ClientSafeError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ClientSafeError(`Unsupported URL scheme: ${parsed.protocol} (http/https only)`);
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new ClientSafeError(`Private/internal URLs not permitted: ${host}`);
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new ClientSafeError(`Failed to fetch ${url}: HTTP ${res.status}`);

  const rawContentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      throw new ClientSafeError(`File too large per Content-Length: ${declared} bytes (max ${MAX_UPLOAD_BYTES})`);
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ClientSafeError(`File too large: ${buffer.byteLength} bytes (max ${MAX_UPLOAD_BYTES})`);
  }

  // Determine MIME: Content-Type header if allowed, else extension fallback.
  let mimeType = rawContentType;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const pathExt = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
    const extMime = EXT_TO_MIME[pathExt];
    if (extMime) mimeType = extMime;
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ClientSafeError(`Unsupported or undetectable MIME type (got '${rawContentType || "none"}'). Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`);
  }

  const filename = parsed.pathname.split("/").pop() || "attachment";
  return { buffer, mimeType, filename };
}

function imageFromBase64(base64: string, filename: string, mimeTypeHint?: string): ImageAttachment {
  // Accept either raw base64 or a data-URL form (data:image/png;base64,...).
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleaned, "base64");
  } catch {
    throw new ClientSafeError("file_base64 is not valid base64");
  }
  if (buffer.byteLength === 0) {
    throw new ClientSafeError("file_base64 decoded to zero bytes");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ClientSafeError(`File too large: ${buffer.byteLength} bytes (max ${MAX_UPLOAD_BYTES})`);
  }

  // Resolve MIME: explicit hint wins, else infer from filename extension.
  let mimeType = mimeTypeHint;
  if (!mimeType) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    mimeType = EXT_TO_MIME[ext];
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ClientSafeError(
      `Unknown or unsupported MIME type. Pass file_mime_type explicitly, or use file_name with a recognized extension. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
    );
  }

  return { buffer, mimeType, filename };
}

// ── MCP server factory ──────────────────────────────────────────────────────

// Loose zod shape for feedback rows — presence-level only. Strict enum/uuid
// validation happens per-row in the feedback service so one bad row gets a
// marker instead of a zod error killing the whole call (the ride-along
// surface must never take down the check it rides on).
const feedbackRowSchema = z.object({
  trace_id: z.string().optional(),
  kind: z.string().optional(),
  impact: z.string().optional(),
  disposition: z.string().optional(),
  story_fulfilled: z.string().optional(),
  story: z.string().optional(),
  note: z.string().optional(),
  agent_id: z.string().optional(),
  top_similarity: z.number().optional(),
  model: z.string().optional(),
  harness: z.string().optional(),
  harness_version: z.string().optional(),
  related_trace_ids: z.array(z.string()).optional(),
});

function createMcpServer(backendUrl: string): McpServer {
  const server = new McpServer({
    name: "soupnet",
    version: "0.4.0",
    description:
      "Soup.net: check recipes — taste and judgment traces with evidence. " +
      "Call get_briefing before your first check to learn the format and get a sample of the user's corpus.",
  });

  // ── check_recipe tool ───────────────────────────────────────────────────

  server.tool(
    "check_recipe",
    buildCheckRecipeToolDescription({ includeFileAttachment: true }),
    {
      recipe: z.string().describe(MCP_PARAM_DESCRIPTIONS.recipe),
      supporting_evidence: z.string().describe(MCP_PARAM_DESCRIPTIONS.supportingEvidence),
      clusters: z.number().optional().describe(MCP_PARAM_DESCRIPTIONS.clusters),
      max_chars: z.number().optional().describe(MCP_PARAM_DESCRIPTIONS.maxChars),
      decided_at: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.decidedAt),
      // No SDK-level outputSchema is declared for this tool: the SDK (1.29.0)
      // requires structuredContent on EVERY non-error response once an
      // outputSchema exists, which would force prose+JSON into one payload —
      // exactly what the one-format-per-response rule (operator review
      // 2026-07-05) rejects. structuredContent without outputSchema is
      // spec-legal; the shape is documented in the param description.
      response_format: z.enum(["markdown", "structured"]).optional().describe(MCP_PARAM_DESCRIPTIONS.responseFormat),
      known_recipes: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.knownRecipes),
      agent_id: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.agentId),
      feedback: z.array(feedbackRowSchema).optional().describe(MCP_PARAM_DESCRIPTIONS.feedbackParam),
      axes: z.string().optional().describe(
        "Two concept terms for semantic projection (comma-separated, e.g., 'accessibility, dark mode'). " +
        "Each result gets x/y positions showing its similarity to each concept (0-1). " +
        "Based on Semantic Projection (Grand et al., 2022)."
      ),
      recipe_book: z.string().optional().describe(
        "Recipe book slug or ID to write this recipe to. Must be in your key's write recipe books. " +
        "Defaults to your key's default recipe book (most private). Use list_my_recipe_books to see what's available."
      ),
      read_recipe_books: z.string().optional().describe(
        "Comma-separated recipe-book slugs to restrict search scope. " +
        "Default: all readable recipe books. Use to focus search on a specific project context."
      ),
      file_url: z.string().optional().describe(
        "Optional: public URL to fetch as reference evidence (image, PDF, audio, or video). " +
        "The server fetches the URL on your behalf. http/https only; private/internal hostnames are rejected. " +
        "MIME type inferred from Content-Type (or URL extension as fallback). " +
        "For private local files (screenshots, generated artifacts) that have no public URL, " +
        "POST the file to the /uploads endpoint first using your same Bearer token, then pass the returned file_url here. " +
        "Mutually exclusive with file_base64."
      ),
      file_base64: z.string().optional().describe(
        "Optional: base64-encoded file bytes (image, PDF, audio, or video). Accepts raw base64 or 'data:...;base64,' data-URL form. " +
        "Requires file_name (for extension-based MIME inference) or file_mime_type (explicit). " +
        "Mutually exclusive with file_url."
      ),
      file_name: z.string().optional().describe(
        "Optional filename hint for base64 uploads. Extension is used to infer MIME type when file_mime_type isn't given."
      ),
      file_mime_type: z.string().optional().describe(
        "Optional explicit MIME type (e.g., 'image/png'). Must be one of the supported media types: " +
        "image/png, image/jpeg, image/webp, video/mp4, video/quicktime, audio/mpeg, audio/wav, audio/flac, audio/ogg, application/pdf."
      ),
      region: z.object({
        image_box: z.object({
          x0: z.number().min(0).max(1),
          y0: z.number().min(0).max(1),
          x1: z.number().min(0).max(1),
          y1: z.number().min(0).max(1),
        }).optional().describe(
          "Normalized region of interest box on the attached image. All values are fractions in [0, 1] with top-left origin (y grows downward). " +
          "Must satisfy x0 < x1 and y0 < y1. When set, the embedding pipeline crops to ROI+padding, blurs the padding, and appends a text hint describing the ROI — so the resulting embedding weights the marked region heavily. " +
          "The original image is stored unmodified; ROI processing is applied at embed time and can be re-done later with a different visual-cue technique (see ADR-0019). " +
          "Image MIME types only; ignored (with a warning logged) for video/audio/PDF."
        ),
        // Future: time_range for video/audio; page_range for PDF.
      }).optional().describe(
        "Optional region-of-interest metadata for the attached file. Currently supports image_box; video and PDF region types planned."
      ),
    },
    {
      title: "Recipe check",
      // Logs a trace as a side effect — not read-only — but the trace is append-only
      // and non-destructive (no overwrite, no delete). Corpus is open-world: results
      // pull from a corpus that other agents may have written to between calls.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ recipe, supporting_evidence, clusters, max_chars, decided_at, axes, recipe_book, read_recipe_books, file_url, file_base64, file_name, file_mime_type, region, response_format, known_recipes, agent_id, feedback }, extra) => {
      // Get API key from auth info (passed by the transport middleware)
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      const MCP_DEFAULT_CLUSTERS = 3;

      // Resolve optional file attachment. Agent picks ONE of file_url or
      // file_base64; both together is an error.
      let image: ImageAttachment | undefined;
      if (file_url && file_base64) {
        return { content: [{ type: "text" as const, text: "Error: provide either file_url or file_base64, not both." }] };
      }
      try {
        if (file_url) {
          // Detect own-hostname URLs (POST /uploads pattern) and resolve via
          // the uploads table instead of HTTP-fetching ourselves. This is
          // how agents attach private local files without blowing context
          // on inline base64. See docs/planning/uploads-endpoint.md.
          const ownUpload = parseOwnHostnameUpload(file_url, getOwnHostname());
          if (ownUpload) {
            // Validate the api key first so we know which key owns the upload.
            const keyResult = await validateKey(getDb(), apiKey);
            if (!keyResult) {
              return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
            }
            try {
              const resolved = await resolveUpload(getDb(), keyResult.keyId, file_url);
              image = {
                buffer: resolved.buffer,
                mimeType: resolved.mimeType,
                filename: resolved.filename,
              };
            } catch (err) {
              if (err instanceof UploadResolutionError) {
                // Uniform "unreachable URL" error shape — don't leak whether
                // the upload exists or merely belongs to a different key.
                return { content: [{ type: "text" as const, text: `File input error: Could not fetch ${file_url}` }] };
              }
              throw err;
            }
          } else {
            image = await imageFromUrl(file_url);
          }
        } else if (file_base64) {
          if (!file_name && !file_mime_type) {
            return { content: [{ type: "text" as const, text: "Error: file_base64 requires either file_name (for extension-based MIME inference) or file_mime_type (explicit)." }] };
          }
          image = imageFromBase64(file_base64, file_name ?? "attachment", file_mime_type);
        }
      } catch (err) {
        // F47: ClientSafeError messages (validation) pass through; internal
        // errors (network failures, fs, db) are logged and genericized.
        if (err instanceof ClientSafeError) {
          return { content: [{ type: "text" as const, text: `File input error: ${err.message}` }] };
        }
        console.error(`[mcp] check_recipe file input error:`, err);
        return { content: [{ type: "text" as const, text: "File input error: could not retrieve or decode the file. The details have been logged server-side." }] };
      }

      // ROI metadata: only meaningful when an image is attached. Ignored
      // with a warning if attached to a non-image file.
      let regionMeta: RegionMeta | undefined;
      if (region?.image_box) {
        if (!image) {
          return { content: [{ type: "text" as const, text: "Error: region.image_box requires a file attachment (file_url or file_base64)." }] };
        }
        if (!image.mimeType.startsWith("image/")) {
          console.warn(`[mcp] check_recipe: region.image_box ignored for non-image MIME ${image.mimeType}`);
        } else {
          regionMeta = { image_box: region.image_box };
        }
      }

      try {
        // Call the service directly — no HTTP roundtrip needed since we're in the same process
        console.warn(`[mcp] check_recipe: calling submitAndSearch directly${image ? ` (with ${image.mimeType} attachment${regionMeta ? " + ROI" : ""})` : ""}`);
        const result = await submitAndSearch({
          key: apiKey,
          traceText: recipe,
          evidenceFor: supporting_evidence,
          clusters: clusters ?? MCP_DEFAULT_CLUSTERS,
          maxChars: max_chars ?? undefined,
          axes: axes ?? undefined,
          targetGroup: recipe_book ?? undefined,
          readGroups: read_recipe_books ?? undefined,
          decidedAt: decided_at ?? undefined,
          image,
          region: regionMeta,
          agentId: agent_id ?? undefined,
          surface: "mcp-http",
        });

        if (result.error) {
          console.warn(`[mcp] check_recipe: service error — ${result.error}`);
          return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
        }

        // Enrich results with evidence/references (same pipeline as /check JSON)
        const db = getDb();
        let enriched = await enrichResults(db, result.results);
        enriched = await clusterEvidenceInResults(db, enriched);

        // known_recipes dedup, phase 1 (rendering only): ids the agent
        // declared it already holds render as one-line stubs. Trace logging,
        // idempotency, and cluster math upstream are untouched — stubs still
        // occupy their cluster slots.
        const knownRecipeIds = new Set(
          (known_recipes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        );

        const jsonResponse = buildMcpJsonResponse(result, enriched, 1, knownRecipeIds);
        console.warn(`[mcp] check_recipe: success — ${result.results.length} results (${response_format ?? "markdown"})`);

        // Ride-along feedback about PRIOR checks. Processed only after the
        // check itself succeeded; per-row markers, never a request-killing
        // error. The check-level agent_id becomes each row's default.
        let feedbackSummary = "";
        let feedbackResults: unknown;
        if (feedback && feedback.length > 0) {
          const keyResult = await validateKey(db, apiKey);
          if (keyResult) {
            const rows: RawFeedbackRow[] = feedback.map((row) => ({
              ...(agent_id ? { agent_id } : {}),
              ...row,
            }));
            const results = await ingestFeedback({
              db,
              apiKeyId: keyResult.keyId,
              readGroupIds: keyResult.readGroupIds,
              rows,
            });
            feedbackSummary = summarizeFeedbackResults(results);
            feedbackResults = results;
          }
        }

        // One format per response (operator review 2026-07-05): markdown is
        // the default readable report (ids + similarities inline); structured
        // returns the JSON as structuredContent with a one-line text stub.
        // Never both.
        if (response_format === "structured") {
          const data = jsonResponse["data"] as Record<string, unknown>;
          if (feedbackResults !== undefined) data["feedbackResults"] = feedbackResults;
          const stub = `Recipe checked as #${String(data["recipeId"])}. ${String(data["totalResults"])} similar recipe(s) — see structuredContent.`;
          return {
            content: [{ type: "text" as const, text: stub }],
            structuredContent: data,
          };
        }

        let text = renderCheckResponseMarkdown(jsonResponse as unknown as CheckResponseJson, {
          knownRecipeIds: [...knownRecipeIds],
        });
        if (feedbackSummary) text += `\n\n${feedbackSummary}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "check_recipe") }] };
      }
    },
  );

  // ── get_briefing tool ─────────────────────────────────────────────────────
  //
  // Returns the same unified briefing produced by GET /keys/briefing — the
  // recipe-check format, the user's recipe books, and a clustered sample
  // of recipes from their corpus. Replaces the old get_recipe_guide tool;
  // the static guide content lives inside the briefing.

  server.tool(
    "get_briefing",
    MCP_TOOL_DESCRIPTIONS.getBriefing,
    {
      purpose: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.briefingPurpose),
      recipe_ids: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.briefingRecipeIds),
    },
    {
      title: "Get briefing",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ purpose, recipe_ids }, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5273";
        const recipeIds = recipe_ids ? parseRecipeIds(recipe_ids) : [];
        const result = await composeBriefing({
          db: getDb(),
          rawKey: apiKey,
          backendUrl,
          frontendUrl,
          surface: "mcp-http",
          options: {
            purpose: purpose ?? undefined,
            ...(recipeIds.length > 0 ? { recipeIds } : {}),
          },
        });

        if (!result.ok) {
          if (result.code === "key_not_found") {
            return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
          }
          return { content: [{ type: "text" as const, text: "Error: Briefing unavailable." }] };
        }

        return { content: [{ type: "text" as const, text: result.text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "get_briefing") }] };
      }
    },
  );

  // ── get_recipes tool ──────────────────────────────────────────────────────
  //
  // Recipe lookup by id (WT-3) — the tool twin of GET /recipes. Same service,
  // same ACL (the key's read_group_ids), same uniform not_found_or_unreadable
  // marker for ids that don't resolve (anti-enumeration; see
  // services/recipe-lookup.service.ts header).
  //
  // Rate limiting: rides the /mcp per-bearer backstop (600/h across all MCP
  // methods, F43) plus the per-IP limiter — no embedding calls, so no
  // dedicated durable budget needed (same WT-3 decision as GET /recipes).

  server.tool(
    "get_recipes",
    MCP_TOOL_DESCRIPTIONS.getRecipes,
    {
      recipe_ids: z.string().describe(MCP_PARAM_DESCRIPTIONS.recipeIds),
    },
    {
      title: "Get recipes by id",
      readOnlyHint: true,
      idempotentHint: true,
      // openWorldHint: true — a previously unreadable id can become readable
      // (book shared, key rescoped) between calls.
      openWorldHint: true,
    },
    async ({ recipe_ids }, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const db = getDb();
        const keyResult = await validateKey(db, apiKey);
        if (!keyResult) {
          return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
        }

        const ids = parseRecipeIds(recipe_ids);
        if (ids.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: recipe_ids is required — pass one or more recipe UUIDs, comma- or whitespace-separated." }] };
        }
        if (ids.length > RECIPE_LOOKUP_MAX_IDS) {
          return { content: [{ type: "text" as const, text: `Error: too many ids (${ids.length}; max ${RECIPE_LOOKUP_MAX_IDS} per call). Split into multiple calls.` }] };
        }

        const entries = await lookupRecipes(db, ids, keyResult.readGroupIds);
        const found = entries.filter((e) => e.status === "ok").length;
        const text = `Requested recipes — ${found} of ${entries.length} resolved. Entries marked not_found_or_unreadable either don't exist or aren't readable by this API key (deliberately indistinguishable).\n\n${renderRecipeEntries(entries)}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "get_recipes") }] };
      }
    },
  );

  // ── list_my_recipe_books tool ──────────────────────────────────────────────
  //
  // Returns the corpus-context subset of the unified briefing — identity,
  // recipe books with members, cross-pollination framing, and clustered
  // exemplar recipes from the corpus. No boilerplate (no principles, no
  // setup, no how-to-check). Lets an agent refresh corpus context
  // mid-session without re-pasting the full briefing — useful when the
  // conversation drifts into a new area of the user's work, or when a
  // shared book gains new members or new recipes during a long session.
  //
  // Same composer as composeBriefing — single source of truth, no drift.

  server.tool(
    "list_my_recipe_books",
    MCP_TOOL_DESCRIPTIONS.listMyRecipeBooks,
    {},
    {
      title: "List my recipe books",
      readOnlyHint: true,
      idempotentHint: true,
      // openWorldHint: true because shared books may gain new recipes between calls.
      openWorldHint: true,
    },
    async (_params, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5273";
        const result = await composeCorpusContext({
          db: getDb(),
          rawKey: apiKey,
          backendUrl,
          frontendUrl,
        });

        if (!result.ok) {
          if (result.code === "key_not_found") {
            return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
          }
          return { content: [{ type: "text" as const, text: "Error: Corpus context unavailable." }] };
        }

        return { content: [{ type: "text" as const, text: result.text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "list_my_recipe_books") }] };
      }
    },
  );

  // ── update_recipe_book_description tool ───────────────────────────────
  //
  // Recipe-book descriptions are critical context — agents reading or
  // writing to a recipe book see the description and can leave out anything
  // it already implies. Stale descriptions degrade clustering and recipe
  // voice. This tool lets agents propose updates, dogfooding-style, guided
  // by the user's accumulated taste.
  //
  // Authorization: api_key.user_id must be a recipe-book owner or admin AND
  // the recipe book must be in the api_key's writeGroupIds. The owner/admin
  // requirement matches the JWT PUT /recipe-books/:id route. The write-scope
  // requirement makes API-key delegation honest — a read-only key can't
  // mutate recipe-book metadata even if the underlying user is an owner.

  server.tool(
    "update_recipe_book_description",
    "Update the description of a recipe book your API key has write access to. " +
    "Agents should recipe-check the proposed description first (e.g., 'As a " +
    "[role] working on [project], I want [recipe book] to be described as " +
    "[proposed description] so that agents writing here understand [context]'). " +
    "The description shapes how every future agent reads and writes to this " +
    "recipe book, so a small change can have outsized effect — check before " +
    "committing. Authorization: your api key's user must be an owner or admin " +
    "of the recipe book, AND the recipe book must be in your key's write " +
    "recipe books (a read-only key cannot mutate recipe-book metadata).",
    {
      recipe_book_id_or_slug: z.string().describe(
        "The recipe book's UUID or slug. Use list_my_recipe_books to find the slug or ID."
      ),
      description: z.string().min(1).max(2000).describe(
        "The new description text. Max 2000 chars. Pass an empty string only " +
        "if you genuinely intend to clear the description."
      ),
    },
    {
      title: "Update recipe book description",
      // Mutates a single field; idempotent under the same input. Not
      // destructive — the description is metadata, not user content.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ recipe_book_id_or_slug, description }, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const db = getDb();
        const keyResult = await validateKey(db, apiKey);
        if (!keyResult) {
          return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
        }

        const { userId, writeGroupIds } = keyResult;

        // Resolve slug or UUID to a group_id within the key's write scope.
        // No write access → no mutation, even if the user is an owner.
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let groupId: string | null = null;
        if (uuidRe.test(recipe_book_id_or_slug)) {
          if (writeGroupIds.includes(recipe_book_id_or_slug)) groupId = recipe_book_id_or_slug;
        } else {
          const slugRows = await db.execute(sql`
            SELECT id FROM claimnet.groups
            WHERE slug = ${recipe_book_id_or_slug}
              AND id IN (${sql.join(writeGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
            LIMIT 1
          `);
          groupId = (slugRows as unknown as Array<{ id: string }>)[0]?.id ?? null;
        }

        if (!groupId) {
          return {
            content: [{ type: "text" as const, text: `Error: Recipe book "${recipe_book_id_or_slug}" not found in your key's write recipe books. Use list_my_recipe_books to see what's reachable.` }],
          };
        }

        // Owner/admin gate — same as the JWT PUT /recipe-books/:id route,
        // scoped to the API key's underlying user.
        const roleRows = await db.execute(sql`
          SELECT role FROM claimnet.group_members
          WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid
        `);
        const role = (roleRows as unknown as Array<{ role: string }>)[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return {
            content: [{ type: "text" as const, text: "Error: This API key's user is not an owner or admin of the target recipe book. Description edits require owner/admin role." }],
          };
        }

        const beforeRows = await db.execute(sql`
          SELECT name, slug, description FROM claimnet.groups WHERE id = ${groupId}::uuid
        `);
        const before = (beforeRows as unknown as Array<{ name: string; slug: string; description: string | null }>)[0];
        if (!before) {
          return { content: [{ type: "text" as const, text: "Error: Recipe book not found." }] };
        }
        const previousDescription = before.description ?? "";
        if (previousDescription === description) {
          return {
            content: [{ type: "text" as const, text: `No change — description was already:\n${description}` }],
          };
        }

        await db.execute(sql`
          UPDATE claimnet.groups
          SET description = ${description}, updated_at = NOW()
          WHERE id = ${groupId}::uuid
        `);

        await writeAudit(db, {
          actorUserId: userId,
          action: "group.description_updated",
          targetType: "group",
          targetId: groupId,
          metadata: {
            apiKeyId: keyResult.keyId,
            actor: "mcp:update_recipe_book_description",
            previousDescription,
            newDescription: description,
            groupName: before.name,
            groupSlug: before.slug,
          },
        });

        return {
          content: [{
            type: "text" as const,
            text: `Updated [${before.slug}] ${before.name}.\n\nPrevious description:\n${previousDescription || "(empty)"}\n\nNew description:\n${description}\n\nThe change is logged in the audit log. Members will see the new description on their next read.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "update_recipe_book_description") }] };
      }
    },
  );

  // ── log_feedback tool ──────────────────────────────────────────────────
  //
  // Standalone surface for feedback rows (end-of-session, outcome/operational
  // kinds with no next check to ride on). Flat single-row params — tool-
  // calling LLMs fill named fields more reliably than nested arrays; batching
  // lives on check_recipe's feedback param. Same service, same validation and
  // ACL path as the ride-along and REST POST /feedback.

  server.tool(
    "log_feedback",
    MCP_TOOL_DESCRIPTIONS.logFeedback,
    {
      trace_id: z.string().describe(
        "Full recipe UUID of the prior check this feedback is about — every check response carries it inline."
      ),
      kind: z.string().describe("check-feedback | operational | outcome"),
      impact: z.string().describe("none | new | subtle | big | operational"),
      disposition: z.string().describe("proceeded | corrected | asked-human | charted-new | deferred"),
      story_fulfilled: z.string().describe("yes | partial | no | unknown"),
      story: z.string().describe(
        "The user story behind the check — why it was made (e.g. 'As an AI sub-agent working on X, I wanted Y so that Z')."
      ),
      note: z.string().optional().describe("What you did with the result — how it changed (or confirmed) your approach."),
      agent_id: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.agentId),
      top_similarity: z.number().optional().describe("Top similarity the check returned (0-1), as you saw it."),
      model: z.string().optional().describe("Your model id (e.g. 'claude-fable-5')."),
      harness: z.string().optional().describe("Your harness (e.g. 'claude-code', 'codex')."),
      harness_version: z.string().optional().describe("Harness version, if known."),
      related_trace_ids: z.array(z.string()).optional().describe(
        "Lineage links — recipe UUIDs in the same arc (e.g. the recipe that changed the action and the trace that logged the new decision)."
      ),
    },
    {
      title: "Log feedback",
      // Appends a feedback row — not read-only, not destructive, not
      // idempotent (each call logs a new row).
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (args, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }
      try {
        const db = getDb();
        const keyResult = await validateKey(db, apiKey);
        if (!keyResult) {
          return { content: [{ type: "text" as const, text: `Error: ${invalidKeyMessage()}` }] };
        }
        const results = await ingestFeedback({
          db,
          apiKeyId: keyResult.keyId,
          readGroupIds: keyResult.readGroupIds,
          rows: [args as RawFeedbackRow],
        });
        const r = results[0];
        if (r?.ok) {
          return { content: [{ type: "text" as const, text: `Feedback recorded for check ${r.traceId} (feedback id ${r.feedbackId}).` }] };
        }
        return { content: [{ type: "text" as const, text: `Feedback rejected: ${r?.error ?? "unknown error"}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: toolErrorText(err, "log_feedback") }] };
      }
    },
  );

  // elicit_divergent_check was removed 2026-04-18: in stateless mode the
  // SSE server→client channel needed for elicitation/create isn't available,
  // and even when sessions existed the only major MCP client that surfaced
  // the picker (Claude Code) rendered it as an unusable wall of text.
  // Antigravity never surfaced it at all. The divergent-check pattern lives
  // on as natural-language conversation: present 2-4 framings to the user,
  // then call check_recipe with the chosen one. Briefings document this.

  return server;
}

// ── Build JSON response from service results (mirrors check.ts buildJsonResponse) ──
// Exported for unit tests (actions hints, structured-mode payload shape).

export function buildMcpJsonResponse(
  result: SubmitAndSearchResult,
  enriched: EnrichedResult[],
  page: number,
  knownRecipeIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const KNOWN_GIST_CHARS = 80;
  const data: Record<string, unknown> = {
    recipeId: result.traceId,
    checkedRecipe: result.traceText,
    searchMode: result.searchMode ?? "lexical",
    clustered: result.clustered ?? false,
    results: enriched.map((r) => {
      // known_recipes stub (rendering only): id + gist + similarity, no
      // evidence body. clusterSize stays so the cluster slot remains visible.
      if (knownRecipeIds?.has(r.id)) {
        return {
          id: r.id,
          known: true,
          recipe: r.claimText.slice(0, KNOWN_GIST_CHARS) + (r.claimText.length > KNOWN_GIST_CHARS ? "…" : ""),
          createdAt: r.createdAt,
          score: { combined: r.combinedScore, semantic: r.semanticScore },
          ...(r.clusterSize ? { clusterSize: r.clusterSize } : {}),
        };
      }
      const item: Record<string, unknown> = {
        id: r.id,
        recipe: r.claimText,
        createdAt: r.createdAt,
        ...(r.group ? { group: { id: r.group.id, name: r.group.name, description: r.group.description } } : {}),
        score: {
          combined: r.combinedScore,
          semantic: r.semanticScore,
        },
        evidence: r.evidence.map((e) => ({
          interpretation: e.content,
          ...(e.clusterSize ? { clusterSize: e.clusterSize } : {}),
          references: e.references.map((ref) => ({
            quote: ref.quote,
            source: ref.source,
            ...(ref.fileUrl ? {
              fileUrl: ref.fileUrl,
              fileMimeType: ref.fileMimeType,
              ...(ref.originalFilename ? { originalFilename: ref.originalFilename } : {}),
              ...(ref.fileHash ? { fileHash: ref.fileHash } : {}),
              ...(ref.regionMeta ? { regionMeta: ref.regionMeta } : {}),
            } : {}),
          })),
        })),
      };
      if (r.clusterSize) {
        item["clusterSize"] = r.clusterSize;
        // Drill-down hint: agent can re-check with the exemplar text to
        // explore this cluster. Phrased around params the tool actually
        // accepts (clusters) — the old expand=true wording advertised a web
        // /check param this tool doesn't have.
        item["drillDown"] = {
          hint: `This exemplar represents ${r.clusterSize} similar recipes. To explore them, re-check with this recipe text and a higher clusters value.`,
          exemplarText: r.claimText,
        };
      }
      return item;
    }),
    totalResults: result.totalResults,
    page,
    totalPages: result.totalPages,
  };

  // Format warning
  if (result.formatWarning) {
    data["formatWarning"] = result.formatWarning;
  }

  // Related evidence (full fields). recipeId per entry (2026-07-05):
  // without it agents burned full re-checks recovering recipes they'd
  // already half-seen — get_recipes turns that into a cheap lookup.
  if (result.relatedEvidence && result.relatedEvidence.length > 0) {
    data["relatedEvidence"] = result.relatedEvidence.map((e) => ({
      evidenceId: e.evidenceId,
      recipeId: e.parentTraceId,
      parentRecipe: e.parentTraceText,
      evidence: e.evidenceContent,
      similarity: e.semanticScore,
      strategy: "contextual_evidence",
    }));
    data["relatedEvidenceHint"] =
      "Each entry carries the source recipe's UUID as recipeId — fetch the full recipe with the get_recipes tool instead of re-checking.";
  }

  // Concept axes (semantic projection)
  if (result.conceptAxes) {
    data["conceptAxes"] = result.conceptAxes;
  }

  // Available actions — what the agent can do next. Only params this tool
  // actually accepts (pagination cleanup, 2026-07-05: the old nextPage hint
  // advertised a page param the tool doesn't take, and the expand/sort/filter
  // hints advertised web-/check params with no MCP equivalent — field data
  // showed zero agents paging anyway).
  const actions: Record<string, unknown> = {};
  if (result.clustered && enriched.some((r) => r.clusterSize && r.clusterSize > 1)) {
    actions["moreClusters"] = "Re-check with a higher clusters value (e.g., clusters=10) for finer granularity.";
  }
  if (result.totalPages > page) {
    actions["narrow"] = "More recipes exist beyond these exemplars. Narrow with read_recipe_books=<slugs>, project with axes=\"concept A, concept B\", or raise clusters.";
  }
  data["actions"] = actions;

  return { ok: true, data };
}

// The flattened-text formatter that used to live here (formatCheckResponse)
// moved to @soupnet/domain renderCheckResponseMarkdown — one renderer shared
// by the HTTP MCP default response, the stdio mirror, and the web /check
// copy-back block. The move also fixed a latent bug: the old formatter read
// r["evidenceFor"] while buildMcpJsonResponse emits r["evidence"], so HTTP
// MCP text responses silently omitted all evidence.

// ── Route handler ───────────────────────────────────────────────────────────

mcpRouter.all("/", mcpBodyLimit, mcpRateLimit, mcpPerBearerBackstop, mcpPerKeyRateLimit, async (c) => {
  // Extract and validate API key from Bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    // MCP auth spec (2025-06-18): a 401 MUST carry WWW-Authenticate pointing
    // at the protected-resource metadata so OAuth-capable clients (claude.ai,
    // MCP Inspector) can discover the authorization server. Clients that
    // probe /.well-known directly still work; this is the spec'd path.
    const base = process.env["BACKEND_URL"] ?? `http://localhost:${process.env["PORT"] ?? "3101"}`;
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    );
    return c.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid Authorization header. Use: Bearer <api-key>" } },
      401,
    );
  }
  const apiKey = authHeader.slice(7);

  // Build auth info for the MCP transport
  const authInfo = {
    token: apiKey,
    clientId: "remote",
    scopes: ["mcp:tools"],
  };

  const backendUrl = process.env["BACKEND_URL"] ?? `http://localhost:${process.env["PORT"] ?? "3101"}`;

  // Stateless mode: each request gets a fresh transport+server pair. The SDK
  // requires this — reusing a stateless transport across requests causes
  // message-ID collisions ("Stateless transport cannot be reused across
  // requests" — webStandardStreamableHttp.js:140).
  // Empty options object → SDK treats as stateless (sessionIdGenerator absent).
  // Avoids TS exactOptionalPropertyTypes issue with explicitly setting undefined.
  const transport = new WebStandardStreamableHTTPServerTransport({});
  const server = createMcpServer(backendUrl);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, { authInfo });
});

export { mcpRouter as mcpRoutes };
