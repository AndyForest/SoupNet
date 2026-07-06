/**
 * Substitutes the hosted MCP host in the /info/connect markdown source
 * (docs/connectors/index.md) with this deployment's own backend origin.
 *
 * The markdown hardcodes `https://mcp.soup.net` so it reads correctly as
 * plain source (GitHub, a raw file view) without a build step. Rendered
 * as-is on a self-hosted deployment, though, it would tell the user's AI
 * client to connect to the hosted cloud instance instead of their own
 * backend — wrong host, and a silent failure mode (the client just talks to
 * someone else's Soup.net). (2026-07-05 journey-eval defect #8.)
 *
 * `apiBase` is expected to be the frontend's own `API_BASE` (auth.ts) — in
 * the hosted production build that already equals the hosted host, so the
 * substitution is a no-op there (identical text renders); everywhere else
 * (self-hosted deployments, local dev) it becomes the deployment's real
 * backend origin. No new env var, and the markdown source stays honest
 * plain text for anyone who opens the .md file directly instead of viewing
 * the rendered page.
 */

export const HOSTED_MCP_HOST = "https://mcp.soup.net";

export function localizeConnectDocs(markdown: string, apiBase: string | undefined): string {
  if (!apiBase || apiBase === HOSTED_MCP_HOST) return markdown;
  return markdown.split(HOSTED_MCP_HOST).join(apiBase);
}
