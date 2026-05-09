/**
 * Soup.net MCP Server
 *
 * Provides two tools for AI agents:
 *   - check_recipe: Check a recipe against Soup.net (returns structured results)
 *   - get_recipe_guide: Learn the recipe format before your first check
 *
 * Auth: SOUPNET_API_KEY required — a daily or scoped key from the Soup.net dashboard.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  TIPS,
  BOOTSTRAP_BLURB,
  EXT_TO_MIME,
} from "@soupnet/domain";

const backendUrl = process.env["SOUPNET_BACKEND_URL"] ?? "http://localhost:3001";
const apiKey = process.env["SOUPNET_API_KEY"] ?? "";

// ── Types for the JSON API response ─────────────────────────────────────────

interface CheckReference {
  quote: string;
  source: string;
  fileUrl?: string;
  fileMimeType?: string;
}

interface CheckEvidence {
  interpretation: string;
  references: CheckReference[];
}

interface RelatedEvidence {
  evidenceId: string;
  parentRecipe: string;
  evidence: string;
  similarity: number;
  strategy: string;
}

interface CheckResultItem {
  id: string;
  recipe: string;
  createdAt: string;
  score: { combined: number; semantic: number | null; lexical: number | null };
  clusterSize?: number;
  evidence: CheckEvidence[];
}

interface CheckResponse {
  ok: boolean;
  error?: string;
  formatWarning?: string;
  data?: {
    recipeId: string;
    searchMode: string;
    clustered?: boolean;
    results: CheckResultItem[];
    relatedEvidence?: RelatedEvidence[];
    totalResults: number;
    page: number;
    totalPages: number;
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatEvidence(label: string, items: CheckEvidence[]): string {
  if (items.length === 0) return "";
  const entries = items
    .map((e) => {
      let text = `  - ${e.interpretation}`;
      for (const ref of e.references) {
        if (ref.quote) text += `\n    > "${ref.quote}"`;
        if (ref.source) text += `\n    -- ${ref.source}`;
        if (ref.fileUrl) text += `\n    [file: ${ref.fileUrl}]`;
      }
      return text;
    })
    .join("\n");
  return `${label}:\n${entries}`;
}

function formatRelatedEvidence(items: RelatedEvidence[]): string {
  if (items.length === 0) return "";
  const entries = items
    .map((e, i) => {
      const pct = Math.round(e.similarity * 100);
      return `  ${i + 1}. ${e.evidence}\n     From recipe: "${e.parentRecipe.slice(0, 100)}${e.parentRecipe.length > 100 ? "..." : ""}"\n     (${pct}% similar, strategy: ${e.strategy})`;
    })
    .join("\n");
  return `\nRelated evidence from other recipes:\n${entries}`;
}

function formatResults(response: CheckResponse): string {
  if (!response.ok || !response.data) {
    return `Error: ${response.error ?? "Unknown error"}`;
  }

  const { data } = response;
  let text = `Recipe checked as #${data.recipeId}\nSearch mode: ${data.searchMode}\n`;

  if (response.formatWarning) {
    text += `\nFormat suggestion: ${response.formatWarning}\n`;
  }

  if (data.results.length === 0) {
    text += "\nNo similar recipes found.";
    return text;
  }

  text += `${data.totalResults} similar recipe(s) found`;
  if (data.clustered) {
    text += ` (clustered to ${data.results.length} exemplars)`;
  }
  text += ":\n";

  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i]!;
    const pct = r.score.semantic !== null ? `${Math.round(r.score.semantic * 100)}%` : r.score.lexical !== null ? `${Math.round(r.score.lexical * 100)}% keyword` : `${r.score.combined.toFixed(2)}`;
    text += `\n#${i + 1} (${pct} similar) -- ${r.createdAt.split("T")[0]}`;
    if (r.clusterSize) {
      text += ` (represents ${r.clusterSize} similar recipes)`;
    }
    text += `\nRecipe: ${r.recipe}`;
    const ev = formatEvidence("Evidence", r.evidence);
    if (ev) text += `\n${ev}`;
    text += "\n";
  }

  // Related evidence from other recipes (evidence discovery pipeline)
  if (data.relatedEvidence && data.relatedEvidence.length > 0) {
    text += formatRelatedEvidence(data.relatedEvidence);
  }

  if (data.totalPages > 1) {
    text += `\nPage ${data.page} of ${data.totalPages}`;
  }

  return text;
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "soupnet",
  version: "0.3.0",
  description:
    "Soup.net: check recipes — taste and judgment traces with evidence. " +
    "Call get_recipe_guide before your first check to learn the format.",
});

// ── check_recipe tool ──────────────────────────────────────────────────────────

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
    file: z.string().optional().describe(
      "Optional file to attach as reference evidence (multimodal embedding). " +
      "Local file path (e.g., 'docs/screenshot.png') or URL. " +
      "Supports: images (PNG/JPEG/WebP), video (MP4/MOV ≤120s), audio (MP3/WAV/FLAC/OGG), PDF (≤6 pages)."
    ),
  },
  async ({ recipe, supporting_evidence, clusters, max_chars, file }) => {
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
        formData.set("format", "json");
        formData.set("image", new Blob([fileBuffer], { type: mimeType }), fileName);

        response = await fetch(`${backendUrl}/check`, {
          method: "POST",
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
        params.set("format", "json");

        response = await fetch(`${backendUrl}/check?${params.toString()}`, {
          headers: { "Accept": "application/json" },
        });
      }

      const data = (await response.json()) as CheckResponse;
      const text = formatResults(data);

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

// ── get_recipe_guide tool ───────────────────────────────────────────────────────

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

TIPS
${tips}

${BOOTSTRAP_BLURB.title.toUpperCase()}
${BOOTSTRAP_BLURB.text}

For annotated scenarios showing common mistakes and detailed analysis, visit:
${backendUrl}/docs/recipe-scenarios`;

    return {
      content: [{ type: "text" as const, text: guide }],
    };
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
