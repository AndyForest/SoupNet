/**
 * Remote MCP endpoint — Streamable HTTP transport for AI agents.
 *
 * Exposes the same check_recipe and get_recipe_guide tools as the
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  HOW_THIS_WORKS,
  FOR_AI_AGENTS,
  WHEN_TO_CHECK,
  TASTE_VS_JUDGMENT,
  RECIPE_FORMAT,
  EVIDENCE_FORMAT,
  RECIPE_EXAMPLES,
  RELATED_EVIDENCE_IS_NEUTRAL,
  RESPONSE_SIZE_CONTROL,
  CONCEPT_AXES,
  GROUPS_GUIDE,
  CONNECTION_TIERS,
  TIPS,
  BOOTSTRAP_BLURB,
  ALLOWED_MIME_TYPES,
  EXT_TO_MIME,
  MAX_UPLOAD_BYTES,
} from "@soupnet/domain";
import { rateLimit } from "../middleware/rate-limit";
import type { SubmitAndSearchResult, ImageAttachment } from "../services/trace.service";
import { submitAndSearch } from "../services/trace.service";
import type { RegionMeta } from "../lib/image-roi";
import type { EnrichedResult } from "../services/result-enricher";
import { enrichResults, clusterEvidenceInResults } from "../services/result-enricher";
import { getDb } from "../db";
import { validateKey } from "../services/api-key.service";
import {
  parseOwnHostnameUpload,
  getOwnHostname,
  resolveUpload,
  UploadResolutionError,
} from "../services/upload.service";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { writeAudit } from "../services/audit-log.service";

// Rate limit MCP: 1000 per hour per IP
const mcpRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

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
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol} (http/https only)`);
  }
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) {
    throw new Error(`Private/internal URLs not permitted: ${host}`);
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);

  const rawContentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large per Content-Length: ${declared} bytes (max ${MAX_UPLOAD_BYTES})`);
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${buffer.byteLength} bytes (max ${MAX_UPLOAD_BYTES})`);
  }

  // Determine MIME: Content-Type header if allowed, else extension fallback.
  let mimeType = rawContentType;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const pathExt = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
    const extMime = EXT_TO_MIME[pathExt];
    if (extMime) mimeType = extMime;
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported or undetectable MIME type (got '${rawContentType || "none"}'). Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`);
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
    throw new Error("file_base64 is not valid base64");
  }
  if (buffer.byteLength === 0) {
    throw new Error("file_base64 decoded to zero bytes");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${buffer.byteLength} bytes (max ${MAX_UPLOAD_BYTES})`);
  }

  // Resolve MIME: explicit hint wins, else infer from filename extension.
  let mimeType = mimeTypeHint;
  if (!mimeType) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    mimeType = EXT_TO_MIME[ext];
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Unknown or unsupported MIME type. Pass file_mime_type explicitly, or use file_name with a recognized extension. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
    );
  }

  return { buffer, mimeType, filename };
}

// ── MCP server factory ──────────────────────────────────────────────────────

function createMcpServer(backendUrl: string): McpServer {
  const server = new McpServer({
    name: "soupnet",
    version: "0.4.0",
    description:
      "Soup.net: check recipes — taste and judgment traces with evidence. " +
      "Call get_recipe_guide before your first check to learn the format.",
  });

  // ── check_recipe tool ───────────────────────────────────────────────────

  server.tool(
    "check_recipe",
    "Check a recipe against Soup.net — returns similar recipes with evidence. " +
    "As a side effect, your recipe is logged so future checks get smarter (stigmergy). " +
    "Check freely and often: before starting tasks (broad discovery), when facing judgment " +
    "calls, and after completing meaningful work. " +
    "Write from the HUMAN USER's perspective: 'As a [role] working on [goal], I [prefer/chose] so that [reason]'. " +
    "Only check genuine hypotheses with evidence — not questions or fabricated queries. " +
    "Results are clustered to 3 exemplars by default. Use clusters=5+ for discovery checks, " +
    "or max_chars to auto-cluster to a character budget (e.g., 2000 for tight context). " +
    "Attach a reference file (image, PDF, audio, video) via file_url (server fetches the URL) " +
    "or file_base64 (inline bytes) for multimodal evidence. " +
    "Call get_recipe_guide first if unsure about the format.",
    {
      recipe: z.string().describe(
        "Recipe (trace) — the human user's voice in a transferable role, not yours. " +
        "Format: 'As a [role] working on [goal], I [prefer/chose] so that [reason]'. " +
        "Pick a role that transfers across users and projects (e.g., 'front-end React developer'), " +
        "not the user's name and not the project name when the group description already implies it. " +
        "Common voice mistakes: 'As an AI agent…' (your voice instead of the user's), " +
        "'As Andy…' (collapses role into a specific person), " +
        "'As a Soup.net developer…' when written to the soup-net-development group (duplicates context the group description already provides). " +
        "Every recipe needs context — role and goal scope the judgment."
      ),
      supporting_evidence: z.string().describe(
        "Supporting evidence for your recipe. Each entry: interpretation text, then '> direct quote', " +
        "then '-- source citation'. Separate entries with blank lines."
      ),
      clusters: z.number().optional().describe(
        "Number of result clusters (reduces results to k representative exemplars). " +
        "Defaults to 3. Use 5+ for discovery checks to surface more diverse viewpoints. " +
        "Each exemplar includes cluster size. Overridden by max_chars if specified."
      ),
      max_chars: z.number().optional().describe(
        "Target response size in characters -- auto-clusters to fit. " +
        "Recommended: 2000 for tight context, 5000 for detailed responses."
      ),
      axes: z.string().optional().describe(
        "Two concept terms for semantic projection (comma-separated, e.g., 'accessibility, dark mode'). " +
        "Each result gets x/y positions showing its similarity to each concept (0-1). " +
        "Based on Semantic Projection (Grand et al., 2022)."
      ),
      group: z.string().optional().describe(
        "Group slug or ID to write this recipe to. Must be in your key's write groups. " +
        "Defaults to your key's default group (most private). Use list_my_groups to see available groups."
      ),
      read_groups: z.string().optional().describe(
        "Comma-separated group slugs to restrict search scope. " +
        "Default: all readable groups. Use to focus search on a specific project context."
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
    async ({ recipe, supporting_evidence, clusters, max_chars, axes, group, read_groups, file_url, file_base64, file_name, file_mime_type, region }, extra) => {
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
              return { content: [{ type: "text" as const, text: "Error: Invalid or expired API key." }] };
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
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `File input error: ${message}` }] };
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
          targetGroup: group ?? undefined,
          readGroups: read_groups ?? undefined,
          image,
          region: regionMeta,
        });

        if (result.error) {
          console.warn(`[mcp] check_recipe: service error — ${result.error}`);
          return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
        }

        // Enrich results with evidence/references (same pipeline as /check JSON)
        const db = getDb();
        let enriched = await enrichResults(db, result.results);
        enriched = await clusterEvidenceInResults(db, enriched);

        // Build the JSON shape that formatCheckResponse expects
        const jsonResponse = buildMcpJsonResponse(result, enriched, 1);
        const text = formatCheckResponse(jsonResponse);
        console.warn(`[mcp] check_recipe: success — ${result.results.length} results`);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const cause = err instanceof Error && err.cause ? ` (cause: ${String(err.cause)})` : "";
        console.error(`[mcp] check_recipe error: ${message}${cause}`);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
      }
    },
  );

  // ── get_recipe_guide tool ─────────────────────────────────────────────────

  server.tool(
    "get_recipe_guide",
    "Get the full guide for how to check recipes on Soup.net. Call this before your first recipe check to understand the expected format.",
    {},
    async () => {
      const examples = RECIPE_EXAMPLES.map((r, i) =>
        `${i + 1}. ${r.label}:\n   Recipe: ${r.recipe}\n   Supporting evidence: ${r.evidenceFor}${r.quote ? `\n   > "${r.quote}"` : ""}${r.source ? `\n   -- ${r.source}` : ""}${r.explanation ? `\n   (${r.explanation})` : ""}`
      ).join("\n\n");

      const triggers = WHEN_TO_CHECK.triggers.map((t, i) =>
        `${i + 1}. ${t.label.toUpperCase()} — ${t.detail}`
      ).join("\n");

      const tips = TIPS.map((t) => `- ${t}`).join("\n");

      const guide = `Soup.net Recipe Check Guide

${HOW_THIS_WORKS.title.toUpperCase()}
${HOW_THIS_WORKS.text}

${FOR_AI_AGENTS.title.toUpperCase()}
${FOR_AI_AGENTS.text}

${WHEN_TO_CHECK.title.toUpperCase()}
Three common triggers:
${triggers}

${WHEN_TO_CHECK.framing}

${TASTE_VS_JUDGMENT.title.toUpperCase()}
${TASTE_VS_JUDGMENT.taste}
${TASTE_VS_JUDGMENT.judgment}
${TASTE_VS_JUDGMENT.summary}

${RECIPE_FORMAT.title.toUpperCase()}
Format: "${RECIPE_FORMAT.preferred}"
${RECIPE_FORMAT.key}

${EVIDENCE_FORMAT.title.toUpperCase()}
${EVIDENCE_FORMAT.template}

EXAMPLES
${examples}

${RELATED_EVIDENCE_IS_NEUTRAL.title.toUpperCase()}
${RELATED_EVIDENCE_IS_NEUTRAL.text}

${RESPONSE_SIZE_CONTROL.title.toUpperCase()}
${RESPONSE_SIZE_CONTROL.text}

${CONCEPT_AXES.title.toUpperCase()}
${CONCEPT_AXES.text}

${GROUPS_GUIDE.title.toUpperCase()}
${GROUPS_GUIDE.text}

${CONNECTION_TIERS.title.toUpperCase()}
${CONNECTION_TIERS.text}

TIPS
${tips}

${BOOTSTRAP_BLURB.title.toUpperCase()}
${BOOTSTRAP_BLURB.text}

For annotated scenarios showing common mistakes and detailed analysis, visit:
${backendUrl}/docs/recipe-scenarios`;

      return { content: [{ type: "text" as const, text: guide }] };
    },
  );

  // ── list_my_groups tool ────────────────────────────────────────────────────

  server.tool(
    "list_my_groups",
    "List the groups your API key has access to, with descriptions, member counts, and your access level. Use this to decide which group to write recipes to.",
    {},
    async (_params, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const db = getDb();
        const keyResult = await validateKey(db, apiKey);
        if (!keyResult) {
          return { content: [{ type: "text" as const, text: "Error: Invalid or expired API key." }] };
        }

        const { readGroupIds, writeGroupIds, defaultWriteGroupId } = keyResult;
        const allGroupIds = [...new Set([...readGroupIds, ...writeGroupIds])];

        if (allGroupIds.length === 0) {
          return { content: [{ type: "text" as const, text: "No groups associated with this key." }] };
        }

        // Fetch group details + member counts
        const rows = await db.execute(sql`
          SELECT g.id, g.slug, g.name, g.description,
            (SELECT COUNT(*)::int FROM claimnet.group_members gm WHERE gm.group_id = g.id) AS "memberCount"
          FROM claimnet.groups g
          WHERE g.id IN (${sql.join(allGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
          ORDER BY g.name
        `);

        interface GroupRow { id: string; slug: string; name: string; description: string | null; memberCount: number }
        const groups = (rows as unknown as GroupRow[]).map((g) => ({
          id: g.id,
          slug: g.slug,
          name: g.name,
          description: g.description ?? "",
          memberCount: g.memberCount,
          access: {
            read: readGroupIds.includes(g.id),
            write: writeGroupIds.includes(g.id),
            isDefault: g.id === defaultWriteGroupId,
          },
        }));

        // Format as readable text for the agent
        let text = `Your API key has access to ${groups.length} group(s):\n\n`;
        for (const g of groups) {
          const access = [];
          if (g.access.read) access.push("read");
          if (g.access.write) access.push("write");
          if (g.access.isDefault) access.push("default write target");
          text += `[${g.slug}] ${g.name} (${g.memberCount} member${g.memberCount !== 1 ? "s" : ""}) — ${access.join(", ")}\n`;
          if (g.description) text += `  ${g.description}\n`;
          text += "\n";
        }
        text += "Use the group parameter on check_recipe to write to a specific group (slug or ID).\n";
        text += "Use the read_groups parameter to restrict search to specific groups.\n";
        text += `Default write group: ${groups.find((g) => g.access.isDefault)?.slug ?? "none"} — recipes go here unless you specify otherwise.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
      }
    },
  );

  // ── update_group_description tool ───────────────────────────────────────
  //
  // Group descriptions are critical context — agents reading or writing to
  // a group see the description and can leave out anything it already
  // implies. Stale descriptions degrade clustering and recipe voice. This
  // tool lets agents propose updates, dogfooding-style, guided by the
  // user's accumulated taste.
  //
  // Authorization: api_key.user_id must be a group owner or admin AND the
  // group must be in the api_key's writeGroupIds. The owner/admin
  // requirement matches the JWT PUT /groups/:id route. The write-scope
  // requirement makes API-key delegation honest — a read-only key can't
  // mutate group metadata even if the underlying user is an owner.

  server.tool(
    "update_group_description",
    "Update the description of a group your API key has write access to. " +
    "Agents should recipe-check the proposed description first (e.g., 'As a " +
    "[role] working on [project], I want [group] to be described as [proposed " +
    "description] so that agents writing here understand [context]'). The " +
    "description shapes how every future agent reads and writes to this group, " +
    "so a small change can have outsized effect — check before committing. " +
    "Authorization: your api key's user must be an owner or admin of the group, " +
    "AND the group must be in your key's write groups (a read-only key cannot " +
    "mutate group metadata).",
    {
      group_id_or_slug: z.string().describe(
        "The group's UUID or slug. Use list_my_groups to find the slug or ID."
      ),
      description: z.string().min(1).max(2000).describe(
        "The new description text. Max 2000 chars. Pass an empty string only " +
        "if you genuinely intend to clear the description."
      ),
    },
    async ({ group_id_or_slug, description }, extra) => {
      const apiKey = (extra.authInfo as Record<string, unknown> | undefined)?.["token"] as string | undefined;
      if (!apiKey) {
        return { content: [{ type: "text" as const, text: "Error: No API key in auth context." }] };
      }

      try {
        const db = getDb();
        const keyResult = await validateKey(db, apiKey);
        if (!keyResult) {
          return { content: [{ type: "text" as const, text: "Error: Invalid or expired API key." }] };
        }

        const { userId, writeGroupIds } = keyResult;

        // Resolve slug or UUID to a group_id within the key's write scope.
        // No write access → no mutation, even if the user is an owner.
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let groupId: string | null = null;
        if (uuidRe.test(group_id_or_slug)) {
          if (writeGroupIds.includes(group_id_or_slug)) groupId = group_id_or_slug;
        } else {
          const slugRows = await db.execute(sql`
            SELECT id FROM claimnet.groups
            WHERE slug = ${group_id_or_slug}
              AND id IN (${sql.join(writeGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
            LIMIT 1
          `);
          groupId = (slugRows as unknown as Array<{ id: string }>)[0]?.id ?? null;
        }

        if (!groupId) {
          return {
            content: [{ type: "text" as const, text: `Error: Group "${group_id_or_slug}" not found in your key's write groups. Use list_my_groups to see what's reachable.` }],
          };
        }

        // Owner/admin gate — same as the JWT PUT /groups/:id route, scoped
        // to the API key's underlying user.
        const roleRows = await db.execute(sql`
          SELECT role FROM claimnet.group_members
          WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid
        `);
        const role = (roleRows as unknown as Array<{ role: string }>)[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return {
            content: [{ type: "text" as const, text: "Error: This API key's user is not an owner or admin of the target group. Description edits require owner/admin role." }],
          };
        }

        const beforeRows = await db.execute(sql`
          SELECT name, slug, description FROM claimnet.groups WHERE id = ${groupId}::uuid
        `);
        const before = (beforeRows as unknown as Array<{ name: string; slug: string; description: string | null }>)[0];
        if (!before) {
          return { content: [{ type: "text" as const, text: "Error: Group not found." }] };
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
            actor: "mcp:update_group_description",
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
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
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

function buildMcpJsonResponse(
  result: SubmitAndSearchResult,
  enriched: EnrichedResult[],
  page: number,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    recipeId: result.traceId,
    checkedRecipe: result.traceText,
    searchMode: result.searchMode ?? "lexical",
    clustered: result.clustered ?? false,
    results: enriched.map((r) => {
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
        // Drill-down hint: agent can re-check with the exemplar text to explore this cluster
        item["drillDown"] = {
          hint: `This exemplar represents ${r.clusterSize} similar recipes. To explore them, re-check with this recipe text and expand=true or a higher cluster count.`,
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

  // Related evidence (full fields)
  if (result.relatedEvidence && result.relatedEvidence.length > 0) {
    data["relatedEvidence"] = result.relatedEvidence.map((e) => ({
      evidenceId: e.evidenceId,
      parentRecipe: e.parentTraceText,
      evidence: e.evidenceContent,
      similarity: e.semanticScore,
      strategy: "contextual_evidence",
    }));
  }

  // Concept axes (semantic projection)
  if (result.conceptAxes) {
    data["conceptAxes"] = result.conceptAxes;
  }

  // Available actions — what the agent can do next
  const actions: Record<string, unknown> = {};
  if (result.clustered && enriched.some((r) => r.clusterSize && r.clusterSize > 1)) {
    actions["expandClusters"] = "Re-check with expand=true to see all results without clustering.";
    actions["moreClusters"] = "Re-check with a higher clusters value (e.g., clusters=10) for finer granularity.";
  }
  if (result.totalPages > page) {
    actions["nextPage"] = `Results are paginated. Request page=${page + 1} for more.`;
  }
  actions["sortByRecent"] = "Add sort=recent to order results by date instead of relevance.";
  actions["filterByKeyword"] = "Add filter=keyword to narrow results. Use comma-separated terms for concept-axis projection.";
  data["actions"] = actions;

  return { ok: true, data };
}

// ── Simple check response formatter (subset of stdio MCP's formatter) ───────

function formatCheckResponse(response: Record<string, unknown>): string {
  if (!response["ok"] || !response["data"]) {
    return `Error: ${(response["error"] as string) ?? "Unknown error"}`;
  }

  const data = response["data"] as Record<string, unknown>;
  let text = `Recipe checked as #${data["recipeId"]}\nSearch mode: ${data["searchMode"]}\n`;

  // Format warning
  if (data["formatWarning"]) {
    text += `Format suggestion: ${data["formatWarning"]}\n`;
  }

  const results = (data["results"] as Array<Record<string, unknown>>) ?? [];
  if (results.length === 0) {
    text += "\nNo similar recipes found.";
    return text;
  }

  text += `${data["totalResults"]} similar recipe(s) found`;
  if (data["clustered"]) {
    text += ` (clustered to ${results.length} exemplars)`;
  }
  text += ":\n";

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const score = r["score"] as Record<string, unknown>;
    const pct = score["semantic"] !== null
      ? `${Math.round(Number(score["semantic"]) * 100)}%`
      : `${Number(score["combined"]).toFixed(2)}`;
    text += `\n#${i + 1} (${pct} similar) -- ${String(r["createdAt"]).split("T")[0]}`;
    if (r["clusterSize"]) text += ` (represents ${r["clusterSize"]} similar recipes)`;
    const group = r["group"] as Record<string, unknown> | undefined;
    if (group) text += ` [${group["name"]}]`;
    text += `\nRecipe: ${r["recipe"]}\n`;

    // Evidence for this recipe
    const evidenceFor = (r["evidenceFor"] as Array<Record<string, unknown>>) ?? [];
    if (evidenceFor.length > 0) {
      for (const ev of evidenceFor) {
        text += `  Supporting: ${ev["interpretation"]}`;
        if (ev["clusterSize"]) text += ` (${ev["clusterSize"]} similar entries)`;
        text += "\n";
        const refs = (ev["references"] as Array<Record<string, unknown>>) ?? [];
        for (const ref of refs) {
          if (ref["quote"]) text += `    > "${ref["quote"]}"\n`;
          if (ref["source"]) text += `    -- ${ref["source"]}\n`;
          if (ref["fileUrl"]) {
            const filename = (ref["originalFilename"] as string) || (ref["fileUrl"] as string);
            const mime = ref["fileMimeType"] ? ` (${ref["fileMimeType"] as string})` : "";
            text += `    [file: ${filename}${mime}]\n`;
            const hash = ref["fileHash"] as string | undefined;
            if (hash) text += `    [sha256: ${hash}]\n`;
            const rm = ref["regionMeta"] as { image_box?: { x0: number; y0: number; x1: number; y1: number } } | undefined;
            const box = rm?.image_box;
            if (box) {
              const pct = (n: number) => `${Math.round(n * 100)}%`;
              text += `    [region x ${pct(box.x0)}–${pct(box.x1)}, y ${pct(box.y0)}–${pct(box.y1)}]\n`;
            }
          }
        }
      }
    }
  }

  // Related evidence from other recipes
  const related = (data["relatedEvidence"] as Array<Record<string, unknown>>) ?? [];
  if (related.length > 0) {
    text += "\nRelated evidence from other recipes:\n";
    for (const e of related) {
      text += `  - ${e["evidence"]} (${Math.round(Number(e["similarity"]) * 100)}% similar)\n`;
      text += `    From: "${String(e["parentRecipe"]).slice(0, 100)}"\n`;
    }
  }

  // Concept axes
  const axes = data["conceptAxes"] as Record<string, unknown> | undefined;
  if (axes) {
    text += `\nConcept axes: "${axes["axisA"]}" (X) / "${axes["axisB"]}" (Y)\n`;
  }

  // Pagination info
  if (Number(data["totalPages"]) > 1) {
    text += `\nPage ${data["page"]} of ${data["totalPages"]}`;
  }

  return text;
}

// ── Route handler ───────────────────────────────────────────────────────────

mcpRouter.all("/", mcpRateLimit, async (c) => {
  // Extract and validate API key from Bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
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
