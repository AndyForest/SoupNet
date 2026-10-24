/**
 * Unknown MCP parameter names (drafts-and-triage slice 8a, S8a-U1 to S8a-U4).
 *
 * The MCP SDK validates a tools/call against the tool's zod object, which
 * strips keys the tool does not declare before the handler runs. An agent
 * that sends `recipe_id` to get_recipes, or `limit` to search_recipes, gets
 * an answer that silently ignored what it asked for (the revision doc's
 * "an unknown search parameter name was accepted without error and had no
 * effect"). This guard sits on the transport, ahead of the SDK, and either
 * refuses such a call or runs it with a warning, by one constant.
 *
 * It wraps the transport rather than any tool, so no handler changes and a
 * parameter a tool gains later is accepted with no list to keep in step: the
 * accepted names are read from the server's registered schemas at call time.
 * Both MCP servers call it once (the /mcp route, the stdio entry).
 *
 * The transport shape is declared structurally here so the domain package
 * needs no SDK dependency.
 */

/** "refuse": a call naming an undeclared parameter runs nothing and answers
 *  a tool error. "warn": it runs as before (the SDK drops the name) and its
 *  result leads with one warning line. The operator chooses (build log,
 *  question 56); both are built so the two answers can be compared. */
export type UnknownParamMode = "refuse" | "warn";
export const UNKNOWN_PARAM_MODE: UnknownParamMode = "refuse";

/** The part of an MCP transport the guard touches: the inbound hook the
 *  server's protocol installs on connect, and the outbound send. */
export interface McpTransportLike {
  onmessage?: ((message: unknown, extra?: unknown) => void) | undefined;
  send(message: unknown, options?: unknown): Promise<void>;
}

/** Names in `args` the tool does not declare, in the order sent. */
export function findUnknownParams(args: unknown, accepted: readonly string[]): string[] {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return [];
  const known = new Set(accepted);
  return Object.keys(args).filter((k) => !known.has(k));
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, "");
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The declared name an unknown one most plausibly meant: the same name in
 *  another case or separator style, its singular or plural, a name that
 *  contains it (recipe_books → read_recipe_books), or one a two-letter typo
 *  away. A name the call already sent is never suggested ("did you mean
 *  recipe?" beside a recipe the agent did send). Undefined when nothing is
 *  close. */
export function nearMissParam(name: string, accepted: readonly string[], sent: readonly string[] = []): string | undefined {
  const n = normalize(name);
  const already = new Set(sent);
  let best: { name: string; score: number } | undefined;
  for (const candidate of accepted) {
    if (already.has(candidate)) continue;
    const c = normalize(candidate);
    let score: number | undefined;
    // Lower is closer: same name, then singular/plural, then a typo of at
    // most two letters, then containment (a typo beats a shorter name that
    // merely appears inside: recipe_boook means recipe_book, not recipe).
    if (c === n) score = 0;
    else if (c === `${n}s` || n === `${c}s`) score = 1;
    else if (Math.min(n.length, c.length) >= 5) {
      const d = editDistance(n, c);
      if (d <= 2) score = 1 + d;
      else if (c.includes(n) || n.includes(c)) score = 4;
    }
    if (score !== undefined && (!best || score < best.score)) best = { name: candidate, score };
  }
  return best?.name;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The refusal or warning text: which names, a near miss for each where one
 *  is obvious, and the names the tool does take. */
export function unknownParamsMessage(
  tool: string,
  unknown: readonly string[],
  accepted: readonly string[],
  mode: UnknownParamMode,
  sent: readonly string[] = [],
): string {
  const described = listNames(unknown.map((u) => {
    const guess = nearMissParam(u, accepted, sent);
    return guess ? `${u} (did you mean ${guess}?)` : u;
  }));
  if (mode === "refuse") {
    const retry = accepted.length > 0
      ? `send it again with the names it takes: ${accepted.join(", ")}.`
      : "send it again with no parameters (it takes none).";
    return `Error: ${tool} does not take ${described}. Nothing was run; ${retry}`;
  }
  const them = unknown.length === 1 ? "it" : "them";
  const takes = accepted.length > 0 ? `It takes: ${accepted.join(", ")}.` : "It takes no parameters.";
  return `Warning: ${tool} ignored ${described}, which it does not take; the call ran without ${them}. ${takes}`;
}

interface ToolCall {
  id: string | number;
  name: string;
  args: unknown;
}

function asToolCall(message: unknown): ToolCall | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const m = message as { id?: unknown; method?: unknown; params?: unknown };
  if (m.method !== "tools/call" || (typeof m.id !== "string" && typeof m.id !== "number")) return undefined;
  const params = m.params as { name?: unknown; arguments?: unknown } | undefined;
  if (!params || typeof params.name !== "string") return undefined;
  return { id: m.id, name: params.name, args: params.arguments };
}

/** Most warned requests awaiting a reply at once. A stdio transport lives as
 *  long as its client, so the pending map is bounded: past this, the oldest
 *  entry is dropped (its reply then goes out without the warning line). */
export const MAX_PENDING_WARNINGS = 256;

/**
 * Install the guard on a connected transport (call after `server.connect`,
 * which installs the protocol's inbound hook). `acceptedFor` returns a tool's
 * declared parameter names, or undefined for a tool it does not know, which
 * passes through untouched so the SDK gives its own "tool not found".
 * Returns the map of warnings awaiting their reply, for tests.
 */
export function guardUnknownParams(
  transport: McpTransportLike,
  acceptedFor: (tool: string) => readonly string[] | undefined,
  mode: UnknownParamMode = UNKNOWN_PARAM_MODE,
): ReadonlyMap<string | number, string> {
  const inbound = transport.onmessage;
  const outbound = transport.send.bind(transport);
  const warnings = new Map<string | number, string>();

  transport.onmessage = (message: unknown, extra?: unknown) => {
    const call = asToolCall(message);
    const accepted = call ? acceptedFor(call.name) : undefined;
    const unknown = call && accepted ? findUnknownParams(call.args, accepted) : [];
    if (call && accepted && unknown.length > 0) {
      const sent = call.args !== null && typeof call.args === "object" ? Object.keys(call.args) : [];
      const text = unknownParamsMessage(call.name, unknown, accepted, mode, sent);
      if (mode === "refuse") {
        void outbound({ jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text }], isError: true } });
        return;
      }
      warnings.set(call.id, text);
      // Maps iterate in insertion order, so the first key is the oldest.
      if (warnings.size > MAX_PENDING_WARNINGS) warnings.delete(warnings.keys().next().value!);
    }
    inbound?.(message, extra);
  };

  transport.send = async (message: unknown, options?: unknown) => {
    const m = message as { id?: unknown; result?: { content?: unknown } } | null;
    const id = m && (typeof m.id === "string" || typeof m.id === "number") ? m.id : undefined;
    const warning = id !== undefined ? warnings.get(id) : undefined;
    if (warning !== undefined && id !== undefined) {
      // Any reply to the request clears its entry (F107): an error reply, or
      // a result without content, gets no warning line but must not leave
      // the entry behind on a long-lived transport.
      warnings.delete(id);
      if (m?.result && Array.isArray(m.result.content)) {
        message = { ...m, result: { ...m.result, content: [{ type: "text", text: warning }, ...m.result.content] } };
      }
    }
    return outbound(message, options);
  };
  return warnings;
}

/**
 * Read each registered tool's declared parameter names from an McpServer.
 * The SDK keeps registrations on a private field; the guard only reads it.
 * If a future SDK moves it, every tool reads as unknown here and the guard
 * passes everything through: the tests that refuse an unknown parameter
 * through a real server then fail, rather than the guard silently refusing
 * declared names.
 */
export function toolParamsFromRegistry(server: unknown): (tool: string) => readonly string[] | undefined {
  const registry = (server as { _registeredTools?: Record<string, { inputSchema?: { shape?: unknown } } | undefined> } | null)
    ?._registeredTools;
  return (tool) => {
    const shape = registry?.[tool]?.inputSchema?.shape;
    if (!shape || typeof shape !== "object") return undefined;
    return Object.keys(shape);
  };
}
