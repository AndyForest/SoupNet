/**
 * Tool-level OAuth signals for MCP hosts that link accounts per tool (the
 * OpenAI plugin directory round, stream O, item 12; recipe 3350158d).
 *
 * Two halves, both additive to the transport-level 401 the server already
 * sends (recipe 3dc8c00c, the MCP specification's refresh signal):
 *
 *   - every tool declares `securitySchemes` in its `_meta`. OpenAI's reference
 *     calls the `_meta` copy the mirror for clients that read only `_meta`,
 *     and SDK 1.30's tools/list emits `_meta` but no top-level field. The
 *     scopes follow the tool's own `readOnlyHint`, so a later annotation
 *     change carries through without a second list to keep in step;
 *   - a `tools/call` refused for its credential gets, inside the same HTTP
 *     401, a JSON-RPC body that is a tool error result carrying
 *     `_meta["mcp/www_authenticate"]`. Its text is the shared remediation
 *     copy and its challenge is fixed text: nothing from the request but its
 *     JSON-RPC id is echoed (the id is required to pair the response).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resourceMetadataUrl } from "./oauth-resource";

export interface SecurityScheme {
  type: "oauth2";
  scopes: string[];
}

/** The scopes a tool asks for, from its annotations. */
export function securitySchemesFor(annotations: { readOnlyHint?: boolean } | undefined): SecurityScheme[] {
  return [{ type: "oauth2", scopes: annotations?.readOnlyHint === true ? ["read"] : ["read", "write"] }];
}

interface ToolLike {
  annotations?: { readOnlyHint?: boolean };
  _meta?: Record<string, unknown>;
  update: (updates: { _meta?: Record<string, unknown> }) => void;
}

/**
 * Wrap the server's tool registration so every tool, however it is
 * registered (`tool` or `registerTool`), leaves with `_meta.securitySchemes`.
 * Call it right after constructing the server, before any tool.
 */
export function applyToolSecuritySchemes(server: McpServer): void {
  const target = server as unknown as Record<"tool" | "registerTool", (...args: unknown[]) => ToolLike>;
  for (const method of ["tool", "registerTool"] as const) {
    const original = target[method].bind(server);
    target[method] = (...args: unknown[]) => {
      const registered = original(...args);
      registered.update({ _meta: { ...registered._meta, securitySchemes: securitySchemesFor(registered.annotations) } });
      return registered;
    };
  }
}

/** Why a tool call was refused: no credential, or a dead one. */
export type AuthRefusal = "missing" | "invalid";

/** The RFC 6750 challenge for the tool-level `_meta`, with the `error` and
 *  `error_description` OpenAI requires. Fixed text only. */
export function toolAuthChallenge(refusal: AuthRefusal): string {
  const [error, description] =
    refusal === "missing"
      ? ["insufficient_scope", "Sign in to Soup.net to use this tool"]
      : ["invalid_token", "The access token is invalid or expired"];
  return `Bearer resource_metadata="${resourceMetadataUrl()}", error="${error}", error_description="${description}"`;
}

/**
 * The JSON-RPC id of a single `tools/call` request, or undefined when the
 * body is anything else (another method, a batch, a notification, not JSON).
 * Reads a clone, so the request stays unread.
 */
export async function toolCallId(request: Request): Promise<string | number | undefined> {
  let message: unknown;
  try {
    message = await request.clone().json();
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const m = message as { method?: unknown; id?: unknown };
  if (m.method !== "tools/call") return undefined;
  return typeof m.id === "string" || typeof m.id === "number" ? m.id : undefined;
}

/** The 401 body for a refused tools/call: a tool error result. */
export function toolCallAuthErrorBody(id: string | number, refusal: AuthRefusal, text: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      content: [{ type: "text" as const, text }],
      isError: true,
      _meta: { "mcp/www_authenticate": [toolAuthChallenge(refusal)] },
    },
  };
}
