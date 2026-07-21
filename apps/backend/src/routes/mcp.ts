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
import type { Recipe } from "@soupnet/contracts";
import { composeBriefing, composeCorpusContext } from "../services/briefing";
import { rateLimit, perKeyRateLimit, extractMcpBearerKey, getClientIp, hashApiKey } from "../middleware/rate-limit";
import type { SubmitAndSearchResult, ImageAttachment } from "../services/trace.service";
import { submitAndSearch } from "../services/trace.service";
import type { RegionMeta } from "../lib/image-roi";
import type { EnrichedResult } from "../services/result-enricher";
import { enrichResults, clusterEvidenceInResults } from "../services/result-enricher";
import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import { maybeSynthesize, SYNTHESIS_INELIGIBLE_NOTICE } from "../services/synthesis.service";
import type { SynthesisResult } from "../services/synthesis.service";
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
import { ingestFeedback, summarizeFeedbackResults, withCheckDefaults } from "../services/feedback.service";

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
    // Log the rejection — this branch short-circuits the chain, so the
    // request-level [mcp-req] logger below never sees it. Without this line a
    // client failing Origin validation is invisible in CloudWatch (2026-07-06
    // claude.ai tool-discovery investigation).
    console.log(`[mcp-req] ${c.req.method} status=403 forbidden_origin=${origin}`);
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
  session_id: z.string().optional(),
});

function createMcpServer(backendUrl: string): McpServer {
  const server = new McpServer({
    name: "soupnet",
    version: "0.4.0",
    description:
      "Soup.net: check recipes — taste and judgment traces with evidence. " +
      "Call get_briefing before your first check to learn the format and get a sample of the user's corpus.",
  });

  // MCP_TOOL_PROFILE=lean — diagnostic bisect instrument (2026-07-06,
  // claude.ai conversation-runtime tool-registry investigation, see
  // claimNet docs/briefings/mcp-connector-forensics-2026-07-06.md): the
  // platform ingests our full 18KB tools/list at connect time but never
  // surfaces the tools to conversations. Lean mode registers only the three
  // read-only tools with one-line descriptions and minimal schemas, cutting
  // list size ~80% and dropping the nested feedback array schema — if lean
  // surfaces where full doesn't, the failure is content-dependent and we
  // bisect. Unset (default) is byte-identical to the pre-flag server.
  const lean = process.env["MCP_TOOL_PROFILE"] === "lean";

  // ── check_recipe tool ───────────────────────────────────────────────────
  if (!lean)

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
      session_id: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.sessionId),
      agent_id: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.agentId),
      synthesize: z.boolean().optional().describe(MCP_PARAM_DESCRIPTIONS.synthesize),
      feedback: z.array(feedbackRowSchema).optional().describe(MCP_PARAM_DESCRIPTIONS.feedbackParam),
      axes: z.string().optional().describe(
        "Two comma-separated concept terms; each result gets x/y similarity positions (0-1) against them (semantic projection)."
      ),
      recipe_book: z.string().optional().describe(
        "Recipe book slug or id to write to. Must be in your key's write scope; defaults to your key's default book. " +
        "list_my_recipe_books shows what's available."
      ),
      read_recipe_books: z.string().optional().describe(
        "Comma-separated recipe-book slugs to restrict result scope. Default: all readable books."
      ),
      file_url: z.string().optional().describe(
        "Public URL the server fetches as reference evidence (image, PDF, audio, video); http(s) only, " +
        "private hostnames rejected. For local files, POST to /uploads with your Bearer token first and " +
        "pass the returned URL. Mutually exclusive with file_base64."
      ),
      file_base64: z.string().optional().describe(
        "Base64 file bytes (raw or data-URL form). Requires file_name or file_mime_type. Mutually exclusive with file_url."
      ),
      file_name: z.string().optional().describe(
        "Filename hint for base64 uploads; the extension infers the MIME type."
      ),
      file_mime_type: z.string().optional().describe(
        "Explicit MIME type, one of: image/png, image/jpeg, image/webp, video/mp4, video/quicktime, " +
        "audio/mpeg, audio/wav, audio/flac, audio/ogg, application/pdf."
      ),
      region: z.object({
        image_box: z.object({
          x0: z.number().min(0).max(1),
          y0: z.number().min(0).max(1),
          x1: z.number().min(0).max(1),
          y1: z.number().min(0).max(1),
        }).optional().describe(
          // Depth (padding/blur mechanics, re-embedding, ADR-0019) lives in the
          // briefing's multimodal section — this is the affordance + constraints.
          "Region-of-interest box on the attached image: fractions in [0,1], top-left origin, x0<x1 and " +
          "y0<y1. The embedding weights the marked region heavily; the original image is stored unmodified. Images only."
        ),
        // Future: time_range for video/audio; page_range for PDF.
      }).optional().describe(
        "Region-of-interest metadata for the attached file (image_box for images)."
      ),
    },
    {
      title: "Recipe check",
      // Writes as a side effect — not read-only — but non-destructive (no
      // overwrite, no delete; destructiveHint:false is the "safe to call" signal).
      // idempotentHint:true is content-scoped: the trace is deduped by
      // sha256(claim_text) under a unique (api_key_id, group_id, claim_text_hash)
      // constraint with ON CONFLICT DO NOTHING, so re-firing an identical recipe
      // (same key + group) returns the SAME trace id and mutates nothing — no new
      // row, no bumped timestamp. This documents double-fire/preview/retry safety.
      // The one thing that still appends per call is the recipe.checked audit row
      // (rate-budget accounting), which is bookkeeping about the call, not domain
      // state. Open-world: results pull from a corpus other agents write to between
      // calls, and idempotentHint concerns only identical-argument re-fires, so it
      // never suppresses distinct checks (stigmergy is unaffected).
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async ({ recipe, supporting_evidence, clusters, max_chars, decided_at, axes, recipe_book, read_recipe_books, file_url, file_base64, file_name, file_mime_type, region, response_format, known_recipes, session_id, agent_id, synthesize, feedback }, extra) => {
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

      // Known-set ids the agent declared (known_recipes). Parsed before the
      // service call — the array joins the session's own deposits inside the
      // service; the set drives route-side stub rendering below.
      const knownRecipeIds = new Set(
        (known_recipes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      );

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
          sessionId: session_id ?? undefined,
          knownRecipeIds: knownRecipeIds.size > 0 ? [...knownRecipeIds] : undefined,
        });

        if (result.error) {
          console.warn(`[mcp] check_recipe: service error — ${result.error}`);
          return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
        }

        // Enrich results with evidence/references (same pipeline as /check JSON)
        const db = getDb();
        let enriched = await enrichResults(db, result.results);
        enriched = await clusterEvidenceInResults(db, enriched);

        // Premium synthesis (opt-in). Resolve the user via a dedicated
        // validateKey lookup only on this branch, mirroring the web /check
        // path — non-synthesize calls never pay for it and the audited
        // api-key seam stays untouched (recipe 5c33168b).
        let synthesis: SynthesisResult | undefined;
        if (synthesize) {
          const keyResult = await validateKey(db, apiKey);
          synthesis = keyResult
            ? await maybeSynthesize({
                db,
                userId: keyResult.userId,
                requested: true,
                checkedRecipe: result.traceText ?? recipe,
                results: enriched,
                relatedEvidence: result.relatedEvidence,
              })
            : { synthesisNotice: SYNTHESIS_INELIGIBLE_NOTICE };
        }

        const jsonResponse = buildMcpJsonResponse(result, enriched, 1, knownRecipeIds, synthesis);
        console.warn(`[mcp] check_recipe: success — ${result.results.length} results (${response_format ?? "markdown"})`);

        // Ride-along feedback about PRIOR checks. Processed only after the
        // check itself succeeded; per-row markers, never a request-killing
        // error. The check-level agent_id and session_id become each row's
        // defaults (the rows ride the same session as the check they ride
        // on); a row-level value wins via spread order.
        let feedbackSummary = "";
        let feedbackResults: unknown;
        if (feedback && feedback.length > 0) {
          const keyResult = await validateKey(db, apiKey);
          if (keyResult) {
            const rows: RawFeedbackRow[] = feedback.map((row) =>
              withCheckDefaults(row, { agentId: agent_id, sessionId: session_id }),
            );
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
          const checkedFill = data["checked"] as { recipeId?: string } | undefined;
          const stub = `Recipe checked as #${String(checkedFill?.recipeId)}. ${String(data["totalResults"])} similar recipe(s) — see structuredContent.`;
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
  // Returns the same unified briefing produced by POST /keys/briefing — the
  // recipe-check format, the user's recipe books, and a clustered sample
  // of recipes from their corpus. Replaces the old get_recipe_guide tool;
  // the static guide content lives inside the briefing.

  server.tool(
    "get_briefing",
    lean ? "Get the Soup.net briefing: recipe format, this user's recipe books, and sample recipes." : MCP_TOOL_DESCRIPTIONS.getBriefing,
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
    lean ? "Fetch specific Soup.net recipes by id (comma-separated UUIDs, up to 20)." : MCP_TOOL_DESCRIPTIONS.getRecipes,
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
    lean ? "List this user's Soup.net recipe books with a sample of recipes." : MCP_TOOL_DESCRIPTIONS.listMyRecipeBooks,
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

  if (!lean)
  server.tool(
    "update_recipe_book_description",
    "Update a recipe book's description. It shapes how every future agent reads and writes there, " +
    "so recipe-check the proposed text before committing. Requires the key's user to be an owner or " +
    "admin AND the book to be in the key's write scope.",
    {
      recipe_book_id_or_slug: z.string().describe(
        "The recipe book's UUID or slug (list_my_recipe_books shows both)."
      ),
      description: z.string().min(1).max(2000).describe(
        "The new description text (max 2000 chars)."
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

  if (!lean)
  server.tool(
    "log_feedback",
    MCP_TOOL_DESCRIPTIONS.logFeedback,
    {
      trace_id: z.string().describe(
        "Recipe id of the prior check — the full UUID from the check response, or an unambiguous short-id prefix (8+ chars, e.g. '18912fbd'). Ambiguous prefixes are rejected naming the candidates."
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
        "Lineage links — recipe UUIDs in the same arc (e.g. the recipe that changed the action and the trace that logged the new decision). Full UUIDs only — short-id prefixes are not resolved here."
      ),
      session_id: z.string().optional().describe(
        "The session token from your check responses — joins your feedback to that session's check lineage. Capture only."
      ),
    },
    {
      title: "Log feedback",
      // Appends a feedback row — not read-only, not destructive.
      // idempotentHint:true (2026-07-21) mirrors check_recipe's: the row is
      // deduped by sha256 over the validated+resolved fields under a unique
      // (api_key_id, trace_id, content_hash) constraint with ON CONFLICT DO
      // NOTHING, so re-firing an identical row (retry, prefetching
      // link-preview bot) returns the SAME feedback id and inserts nothing new.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
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
          const text = r.dup
            ? `Feedback already recorded for check ${r.traceId} (feedback id ${r.feedbackId}) — identical resubmission.`
            : `Feedback recorded for check ${r.traceId} (feedback id ${r.feedbackId}).`;
          return { content: [{ type: "text" as const, text }] };
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
  synthesis?: SynthesisResult,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    // The caller's own deposit as a Recipe fill (canonical schema, recipe
    // 7945fd8a): {recipeId, recipe}.
    ...(result.traceId
      ? { checked: { recipeId: result.traceId, recipe: result.traceText } satisfies Recipe }
      : {}),
    searchMode: result.searchMode ?? "lexical",
    clustered: result.clustered ?? false,
    results: enriched.map((r) => {
      // Known-set stub (rendering only): the caller already holds this recipe
      // — declared via known_recipes or flagged by the pipeline's session
      // known-set. Id-only shape (no recipe gist — operator ruling: the gist
      // is an ossification risk; use get_recipes for the body). No drillDown
      // hint — there's no claim text to include. clusterSize stays so the
      // cluster slot remains visible.
      if (knownRecipeIds?.has(r.id) || r.known) {
        // Trimmed stub row (operator ruling 2026-07-18): no createdAt; ONE
        // similarity vocabulary (recipe ef245b63) — the raw cosine only.
        const stub: Recipe = {
          recipeId: r.id,
          known: true,
          similarity: r.semanticScore ?? undefined,
          ...(r.clusterSize ? { clusterSize: r.clusterSize } : {}),
        };
        return stub;
      }
      const fill: Recipe = {
        recipeId: r.id,
        recipe: r.claimText,
        createdAt: r.createdAt,
        // Recipe-book id + name only — the description lives in the briefing
        // (operator ruling 2026-07-18).
        ...(r.recipeBook
          ? { recipeBook: { recipeBookId: r.recipeBook.recipeBookId, name: r.recipeBook.name } }
          : {}),
        similarity: r.semanticScore ?? undefined,
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
        ...(r.clusterSize ? { clusterSize: r.clusterSize } : {}),
        // Known cluster-mates (seam 2, "stub, stub, full recipe"): minimal
        // Recipe fills {recipeId, similarity} beside the full exemplar.
        ...(r.knownClusterMembers && r.knownClusterMembers.length > 0
          ? {
            knownMembers: r.knownClusterMembers.map(
              (m): Recipe => ({ recipeId: m.id, similarity: m.similarity }),
            ),
          }
          : {}),
      };
      if (!r.clusterSize) return fill;
      // Drill-down hint: agent can re-check with the exemplar text to explore
      // this cluster. MCP-only extra beside the canonical Recipe fill (the
      // published schema strips unknown keys on parse; consumers may ignore).
      return {
        ...fill,
        drillDown: {
          hint: `This exemplar represents ${r.clusterSize} similar recipes. To explore them, re-check with this recipe text and a higher clusters value.`,
          exemplarText: r.claimText,
        },
      };
    }),
    totalResults: result.totalResults,
    page,
    totalPages: result.totalPages,
    // The session token in effect for this check — freshly minted when none
    // was presented (self-healing). Callers pass it back as session_id so
    // recipes this session already deposited render as id-only stubs.
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    // Which ranking served this response (mirrors check.ts) — structured
    // metadata only; the default markdown format stays token-lean.
    ...(result.ranking ? { ranking: result.ranking } : {}),
  };

  // Format warning
  if (result.formatWarning) {
    data["formatWarning"] = result.formatWarning;
  }

  // Premium synthesis: exactly one of the profile or the one-line notice.
  // Carried in structuredContent so structured-mode callers get it too; the
  // shared markdown renderer picks it up for the default format.
  if (synthesis?.synthesis) {
    data["synthesis"] = synthesis.synthesis;
  } else if (synthesis?.synthesisNotice) {
    data["synthesisNotice"] = synthesis.synthesisNotice;
  }

  // Related evidence. recipeId per entry (2026-07-05): without it agents
  // burned full re-checks recovering recipes they'd already half-seen —
  // get_recipes turns that into a cheap lookup. Entry shape trimmed
  // 2026-07-18 (operator ruling): no evidenceId, no constant strategy field.
  if (result.relatedEvidence && result.relatedEvidence.length > 0) {
    // Each related-evidence entry is a Recipe fill (canonical schema): the
    // parent recipe with the matching evidence entry attached.
    data["relatedEvidence"] = result.relatedEvidence.map((e): Recipe => ({
      recipeId: e.parentTraceId,
      recipe: e.parentTraceText,
      similarity: e.semanticScore,
      evidence: [{ interpretation: e.evidenceContent }],
    }));
    data["relatedEvidenceHint"] =
      "Each entry carries the source recipe's UUID as recipeId — fetch the full recipe with the get_recipes tool instead of re-checking.";
  }
  // Known evidence parents (seam 2): minimal Recipe fills — id + best
  // evidence similarity per parent (ONE similarity vocabulary, ef245b63).
  if (result.relatedEvidenceKnown && result.relatedEvidenceKnown.length > 0) {
    data["relatedEvidenceKnown"] = result.relatedEvidenceKnown.map(
      (p): Recipe => ({ recipeId: p.recipeId, similarity: p.similarity }),
    );
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

// Request-level observability (2026-07-06, claude.ai tool-discovery
// investigation): one structured line per /mcp request so CloudWatch can
// distinguish the settings-time path from the conversation-runtime path
// (method, status, whether an Origin was sent, client UA family). The 403
// forbidden_origin branch above this router returns without logging, so this
// middleware is deliberately mounted on the route (post-Origin-check requests)
// and the Origin middleware gets its own log line below.
mcpRouter.use("/*", async (c, next) => {
  await next();
  const ua = (c.req.header("user-agent") ?? "").slice(0, 60);
  console.log(
    `[mcp-req] ${c.req.method} status=${c.res.status} origin=${c.req.header("origin") ?? "-"} ua="${ua}"`,
  );
});

mcpRouter.all("/", mcpBodyLimit, mcpRateLimit, mcpPerBearerBackstop, mcpPerKeyRateLimit, async (c) => {
  // Streamable HTTP spec: a server that does not offer server-initiated
  // messages at this endpoint MUST return 405 for GET. In stateless mode
  // (ADR-0021) every request gets a fresh transport, so a standalone GET SSE
  // stream can never carry anything — but the SDK still opens one and holds
  // it silently forever, which stalls clients (observed 2026-07-06: claude.ai
  // settings could list tools via POST while conversation-time discovery hung;
  // a bare GET probe confirmed 200 + empty stream with no bytes). DELETE
  // (session teardown) is equally meaningless without sessions.
  if (c.req.method === "GET" || c.req.method === "DELETE") {
    c.header("Allow", "POST, OPTIONS");
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "This server runs in stateless mode: no server-initiated messages (GET) or sessions (DELETE). Use POST.",
        },
      },
      405,
    );
  }

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
