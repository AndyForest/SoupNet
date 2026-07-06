/**
 * Soup.net MCP Server (stdio transport)
 *
 * Thin proxy. Forwards tool calls to the Soup.net backend HTTP API using the
 * user's API key. The backend is the source of truth for tool behavior, so
 * this file stays a transport-only shell — when the HTTP MCP route adds a
 * tool, mirror it here with a fetch call.
 *
 * Tools:
 *   - check_recipe   → POST /check (or GET ?key=...&format=json)
 *   - get_briefing   → GET /briefing
 *
 * Auth: SOUPNET_API_KEY env var. The same daily or scoped key shown on the
 * dashboard.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  EXT_TO_MIME,
  MCP_PARAM_DESCRIPTIONS,
  MCP_TOOL_DESCRIPTIONS,
  buildCheckRecipeToolDescription,
  renderCheckResponseMarkdown,
} from "@soupnet/domain";
import type { CheckResponseJson } from "@soupnet/domain";

const backendUrl = process.env["SOUPNET_BACKEND_URL"] ?? "http://localhost:3101";
const apiKey = process.env["SOUPNET_API_KEY"] ?? "";

// The local formatting helpers that used to live here (formatResults etc.)
// were replaced by @soupnet/domain renderCheckResponseMarkdown — the same
// renderer the HTTP MCP route and the web /check copy-back block use, so the
// two MCP surfaces can't drift. Pagination text is gone with them: agents
// can't page (no page param), so the renderer emits a narrowing hint instead.

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "soupnet",
  version: "0.4.0",
  description:
    "Soup.net: check recipes — taste and judgment traces with evidence. " +
    "Call get_briefing before your first check to learn the format and get a sample of the user's corpus.",
});

// ── check_recipe tool ──────────────────────────────────────────────────────────

server.tool(
  "check_recipe",
  buildCheckRecipeToolDescription({ includeFileAttachment: false }),
  {
    recipe: z.string().describe(MCP_PARAM_DESCRIPTIONS.recipe),
    supporting_evidence: z.string().describe(MCP_PARAM_DESCRIPTIONS.supportingEvidence),
    clusters: z.number().optional().describe(MCP_PARAM_DESCRIPTIONS.clusters),
    max_chars: z.number().optional().describe(MCP_PARAM_DESCRIPTIONS.maxChars),
    decided_at: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.decidedAt),
    // No SDK-level outputSchema — see the HTTP MCP route (routes/mcp.ts):
    // declaring one would force structuredContent onto every response,
    // violating the one-format-per-response rule.
    response_format: z.enum(["markdown", "structured"]).optional().describe(MCP_PARAM_DESCRIPTIONS.responseFormat),
    known_recipes: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.knownRecipes),
    agent_id: z.string().optional().describe(MCP_PARAM_DESCRIPTIONS.agentId),
    feedback: z.array(z.object({
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
    })).optional().describe(MCP_PARAM_DESCRIPTIONS.feedbackParam),
    file: z.string().optional().describe(
      "Optional file to attach as reference evidence (multimodal embedding). " +
      "Local file path (e.g., 'docs/screenshot.png') or URL. " +
      "Supports: images (PNG/JPEG/WebP), video (MP4/MOV ≤120s), audio (MP3/WAV/FLAC/OGG), PDF (≤6 pages)."
    ),
  },
  {
    title: "Recipe check",
    // Append-only trace as a side effect — not read-only, but not destructive either.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ recipe, supporting_evidence, clusters, max_chars, decided_at, response_format, known_recipes, agent_id, feedback, file }) => {
    if (!apiKey) {
      return {
        content: [{ type: "text" as const, text: "Error: SOUPNET_API_KEY not configured. Get a key from your Soup.net dashboard." }],
      };
    }

    try {
      let response: Response;

      if (file) {
        // File attached — POST as multipart/form-data
        const { readFile } = await import("node:fs/promises");
        const { resolve } = await import("node:path");
        const { basename } = await import("node:path");

        let fileBuffer: Buffer;
        let fileName: string;

        if (file.startsWith("http://") || file.startsWith("https://")) {
          // URL — fetch the file
          const fileRes = await fetch(file);
          if (!fileRes.ok) throw new Error(`Failed to fetch file: ${fileRes.status}`);
          fileBuffer = Buffer.from(await fileRes.arrayBuffer());
          fileName = file.split("/").pop() ?? "attachment";
        } else {
          // Local file path — resolve relative to cwd
          const filePath = resolve(process.cwd(), file);
          fileBuffer = await readFile(filePath);
          fileName = basename(filePath);
        }

        // Detect MIME type from extension (shared definition in @soupnet/domain)
        const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = EXT_TO_MIME[ext] ?? "application/octet-stream";

        const formData = new FormData();
        formData.set("key", apiKey);
        formData.set("trace", recipe);
        formData.set("ef", supporting_evidence);
        if (clusters) formData.set("clusters", String(clusters));
        if (max_chars) formData.set("max_chars", String(max_chars));
        if (decided_at) formData.set("decided_at", decided_at);
        if (agent_id) formData.set("agent_id", agent_id);
        if (known_recipes) formData.set("known_recipes", known_recipes);
        formData.set("format", "json");
        formData.set("image", new Blob([fileBuffer], { type: mimeType }), fileName);

        response = await fetch(`${backendUrl}/check`, {
          method: "POST",
          headers: { "X-SoupNet-Surface": "mcp-stdio" },
          body: formData,
        });
      } else {
        // No file — GET with query params (lighter, avoids multipart overhead)
        const params = new URLSearchParams();
        params.set("key", apiKey);
        params.set("trace", recipe);
        params.set("ef", supporting_evidence);
        if (clusters) params.set("clusters", String(clusters));
        if (max_chars) params.set("max_chars", String(max_chars));
        if (decided_at) params.set("decided_at", decided_at);
        if (agent_id) params.set("agent_id", agent_id);
        if (known_recipes) params.set("known_recipes", known_recipes);
        params.set("format", "json");

        response = await fetch(`${backendUrl}/check?${params.toString()}`, {
          headers: { "Accept": "application/json", "X-SoupNet-Surface": "mcp-stdio" },
        });
      }

      const json = (await response.json()) as CheckResponseJson;

      // Ride-along feedback about PRIOR checks: the web /check endpoint this
      // proxy talks to doesn't carry feedback, so forward rows to the REST
      // /feedback surface (same server-side service and validation path).
      // Failures become marker text — never a request-killing error.
      let feedbackSummary = "";
      if (feedback && feedback.length > 0) {
        try {
          const rows = feedback.map((row) => ({ ...(agent_id ? { agent_id } : {}), ...row }));
          const fbRes = await fetch(`${backendUrl}/feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ feedback: rows }),
          });
          const fbJson = (await fbRes.json()) as {
            ok: boolean;
            error?: string;
            data?: { recorded: number; results: Array<{ index: number; ok: boolean; traceId: string; error?: string }> };
          };
          if (fbJson.data) {
            const lines = [`Feedback: ${fbJson.data.recorded}/${feedback.length} row(s) recorded.`];
            for (const r of fbJson.data.results) {
              if (!r.ok) lines.push(`  - row ${r.index + 1} (${r.traceId || "no trace_id"}): ${r.error}`);
            }
            feedbackSummary = lines.join("\n");
          } else {
            feedbackSummary = `Feedback: not recorded — ${fbJson.error ?? "unknown error"}`;
          }
        } catch (err) {
          feedbackSummary = `Feedback: not recorded — ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // One format per response: structured returns the backend's JSON data
      // as structuredContent with a one-line stub; markdown (default) is the
      // shared readable report. Never both.
      if (response_format === "structured" && json.ok && json.data) {
        const stub = `Recipe checked as #${json.data.recipeId ?? "?"}. ${json.data.totalResults ?? 0} similar recipe(s) — see structuredContent.${feedbackSummary ? `\n${feedbackSummary}` : ""}`;
        return {
          content: [{ type: "text" as const, text: stub }],
          structuredContent: json.data as unknown as Record<string, unknown>,
        };
      }

      let text = renderCheckResponseMarkdown(json, {
        knownRecipeIds: (known_recipes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (feedbackSummary) text += `\n\n${feedbackSummary}`;

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error checking recipe: ${message}` }],
      };
    }
  },
);

// elicit_divergent_check was removed 2026-04-18. The major MCP clients either
// don't surface the elicitation form (Antigravity) or render it as an
// unusable wall of text (Claude Code). The divergent-check pattern lives on
// as natural-language conversation — present 2-4 framings to the user, then
// call check_recipe with the chosen one. See briefings.

// ── log_feedback tool ──────────────────────────────────────────────────────────
//
// Mirror of the backend HTTP MCP log_feedback tool — proxies to the REST
// POST /feedback surface (same server-side service, validation, and ACL
// path). Flat single-row params; batching lives on check_recipe's feedback
// param.

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
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async (args) => {
    if (!apiKey) {
      return {
        content: [{ type: "text" as const, text: "Error: SOUPNET_API_KEY not configured. Get a key from your Soup.net dashboard." }],
      };
    }
    try {
      const res = await fetch(`${backendUrl}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(args),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { recorded: number; results: Array<{ ok: boolean; traceId: string; feedbackId?: string; error?: string }> };
      };
      const r = json.data?.results?.[0];
      if (r?.ok) {
        return { content: [{ type: "text" as const, text: `Feedback recorded for check ${r.traceId} (feedback id ${r.feedbackId}).` }] };
      }
      return { content: [{ type: "text" as const, text: `Feedback rejected: ${r?.error ?? json.error ?? "unknown error"}` }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error logging feedback: ${message}` }] };
    }
  },
);

// ── get_briefing tool ──────────────────────────────────────────────────────────
//
// Fetches the unified briefing from the backend (/briefing endpoint, Bearer-token
// auth). The backend composer reads the user's preferences, looks up their
// recipe books, and includes a clustered sample of exemplar recipes. Same
// artifact as the dashboard's Copy briefing button.

server.tool(
  "get_briefing",
  MCP_TOOL_DESCRIPTIONS.getBriefing,
  {},
  {
    title: "Get briefing",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async () => {
    if (!apiKey) {
      return {
        content: [{ type: "text" as const, text: "Error: SOUPNET_API_KEY not configured. Get a key from your Soup.net dashboard." }],
      };
    }

    try {
      const res = await fetch(`${backendUrl}/briefing`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { text: string } };
      if (!json.ok || !json.data) {
        return { content: [{ type: "text" as const, text: `Error: ${json.error ?? "briefing fetch failed"}` }] };
      }
      return { content: [{ type: "text" as const, text: json.data.text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error fetching briefing: ${message}` }] };
    }
  },
);

// ── Start server ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] Soup.net MCP server started (stdio transport)");
}

main().catch((err) => {
  console.error("[mcp-server] Fatal error:", err);
  process.exit(1);
});
