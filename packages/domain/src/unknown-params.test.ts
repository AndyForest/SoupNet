import { describe, it, expect } from "vitest";
import {
  findUnknownParams,
  nearMissParam,
  unknownParamsMessage,
  guardUnknownParams,
  toolParamsFromRegistry,
} from "./unknown-params";
import type { McpTransportLike } from "./unknown-params";

// Drafts-and-triage slice 8a, S8a-U1 to S8a-U4: parameter names a tool does
// not declare are refused or warned, depending on one constant.

describe("findUnknownParams", () => {
  it("lists names the tool does not declare, in the order sent", () => {
    expect(findUnknownParams({ recipe_id: "x", limit: 3, recipe_ids: "y" }, ["recipe_ids"])).toEqual(["recipe_id", "limit"]);
  });

  it("is empty for declared names, no arguments, or a non-object", () => {
    expect(findUnknownParams({ recipe_ids: "y" }, ["recipe_ids"])).toEqual([]);
    expect(findUnknownParams(undefined, ["a"])).toEqual([]);
    expect(findUnknownParams(null, ["a"])).toEqual([]);
    expect(findUnknownParams(["a"], ["a"])).toEqual([]);
  });
});

describe("nearMissParam", () => {
  const accepted = ["recipe_ids", "query", "read_recipe_books", "verbosity", "intent"];
  it("suggests the singular/plural, case, and separator neighbours", () => {
    expect(nearMissParam("recipe_id", accepted)).toBe("recipe_ids");
    expect(nearMissParam("recipeIds", accepted)).toBe("recipe_ids");
    expect(nearMissParam("Query", accepted)).toBe("query");
    expect(nearMissParam("recipe_books", accepted)).toBe("read_recipe_books");
  });

  it("suggests a small typo", () => {
    expect(nearMissParam("verbosty", accepted)).toBe("verbosity");
  });

  it("prefers a typo's target over a shorter name that only appears inside it", () => {
    expect(nearMissParam("recipe_boook", ["recipe", "recipe_book", "read_recipe_books"])).toBe("recipe_book");
  });

  it("never suggests a name the call already sent (verifier finding 3)", () => {
    expect(nearMissParam("recipe_boook", ["recipe", "supporting_evidence"], ["recipe", "recipe_boook"])).toBeUndefined();
    expect(nearMissParam("recipe_id", ["recipe_ids"], ["recipe_ids", "recipe_id"])).toBeUndefined();
  });

  it("suggests nothing for an unrelated name", () => {
    expect(nearMissParam("limit", accepted)).toBeUndefined();
    expect(nearMissParam("page", accepted)).toBeUndefined();
  });
});

describe("unknownParamsMessage — names already sent", () => {
  it("leaves out a suggestion the call already holds", () => {
    expect(unknownParamsMessage("check_recipe", ["recipe_boook"], ["recipe", "supporting_evidence"], "refuse", ["recipe", "recipe_boook"])).toBe(
      "Error: check_recipe does not take recipe_boook. Nothing was run; send it again with the names it takes: recipe, supporting_evidence.",
    );
  });
});

describe("unknownParamsMessage", () => {
  it("refuse: says nothing ran, with the near miss and the accepted names", () => {
    expect(unknownParamsMessage("get_recipes", ["recipe_id"], ["recipe_ids"], "refuse")).toBe(
      "Error: get_recipes does not take recipe_id (did you mean recipe_ids?). Nothing was run; send it again with the names it takes: recipe_ids.",
    );
  });

  it("warn: says the call ran without it", () => {
    expect(unknownParamsMessage("search_recipes", ["limit", "page"], ["query", "verbosity"], "warn")).toBe(
      "Warning: search_recipes ignored limit and page, which it does not take; the call ran without them. It takes: query, verbosity.",
    );
  });

  it("a tool with no parameters says so", () => {
    expect(unknownParamsMessage("list_my_recipe_books", ["book"], [], "refuse")).toBe(
      "Error: list_my_recipe_books does not take book. Nothing was run; send it again with no parameters (it takes none).",
    );
  });
});

/** An in-memory stand-in for an MCP transport: what the server's protocol
 *  received, and what went back to the client. */
function fakeTransport(): McpTransportLike & { received: unknown[]; sent: unknown[]; deliver(m: unknown): void } {
  const t = {
    received: [] as unknown[],
    sent: [] as unknown[],
    onmessage: undefined as McpTransportLike["onmessage"],
    async send(message: unknown) {
      t.sent.push(message);
    },
    deliver(m: unknown) {
      t.onmessage?.(m, undefined);
    },
  };
  t.onmessage = (m: unknown) => {
    t.received.push(m);
  };
  return t;
}

const ACCEPTED: Record<string, readonly string[]> = { get_recipes: ["recipe_ids"] };
const acceptedFor = (tool: string) => ACCEPTED[tool];

function call(id: number, args: Record<string, unknown>, name = "get_recipes") {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

describe("guardUnknownParams — refuse", () => {
  it("answers an isError result naming the unknown and runs nothing", async () => {
    const t = fakeTransport();
    guardUnknownParams(t, acceptedFor, "refuse");
    t.deliver(call(7, { recipe_id: "x" }));
    await Promise.resolve();
    expect(t.received).toEqual([]);
    expect(t.sent).toEqual([{
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [{ type: "text", text: "Error: get_recipes does not take recipe_id (did you mean recipe_ids?). Nothing was run; send it again with the names it takes: recipe_ids." }],
        isError: true,
      },
    }]);
  });

  it("passes declared calls, other methods, notifications, and unregistered tools through untouched", () => {
    const t = fakeTransport();
    guardUnknownParams(t, acceptedFor, "refuse");
    const messages = [
      call(1, { recipe_ids: "a" }),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "x" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      call(3, { anything: 1 }, "not_a_tool"),
      call(4, {}),
    ];
    for (const m of messages) t.deliver(m);
    expect(t.received).toEqual(messages);
    expect(t.sent).toEqual([]);
  });
});

describe("guardUnknownParams — warn", () => {
  it("runs the call without the undeclared name and puts one warning block first in its result", async () => {
    const t = fakeTransport();
    guardUnknownParams(t, acceptedFor, "warn");
    const m = call(9, { recipe_ids: "a", recipe_id: "b" });
    t.deliver(m);
    // The guard drops the name itself: the tools' strict schemas would
    // otherwise refuse it at the SDK (#166).
    expect(t.received).toEqual([call(9, { recipe_ids: "a" })]);
    await t.send({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "Requested recipes" }], structuredContent: { a: 1 } } });
    expect(t.sent).toEqual([{
      jsonrpc: "2.0",
      id: 9,
      result: {
        content: [
          { type: "text", text: "Warning: get_recipes ignored recipe_id, which it does not take; the call ran without it. It takes: recipe_ids." },
          { type: "text", text: "Requested recipes" },
        ],
        structuredContent: { a: 1 },
      },
    }]);
  });

  // F107: an error reply (or any reply without a content array) must still
  // clear the request's entry, or the long-lived stdio transport leaks one
  // entry per warned call that failed.
  it("clears a warned request's entry on an error reply, so the map does not grow", async () => {
    const t = fakeTransport();
    const warnings = guardUnknownParams(t, acceptedFor, "warn");
    t.deliver(call(5, { recipe_id: "b" }));
    expect(warnings.size).toBe(1);
    const error = { jsonrpc: "2.0", id: 5, error: { code: -32603, message: "boom" } };
    await t.send(error);
    expect(t.sent).toEqual([error]);
    expect(warnings.size).toBe(0);
  });

  it("bounds the map: past the limit the oldest pending warning is dropped", () => {
    const t = fakeTransport();
    const warnings = guardUnknownParams(t, acceptedFor, "warn");
    for (let i = 0; i < 300; i++) t.deliver(call(i, { recipe_id: "b" }));
    expect(warnings.size).toBe(256);
    expect(warnings.has(0)).toBe(false);
    expect(warnings.has(299)).toBe(true);
  });

  it("leaves responses to other requests untouched", async () => {
    const t = fakeTransport();
    guardUnknownParams(t, acceptedFor, "warn");
    t.deliver(call(1, { recipe_id: "b" }));
    const other = { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "x" }] } };
    await t.send(other);
    expect(t.sent).toEqual([other]);
  });
});

describe("toolParamsFromRegistry", () => {
  it("reads the parameter names from each registered tool's object schema", () => {
    const server = { _registeredTools: { get_recipes: { inputSchema: { shape: { recipe_ids: {} } } }, list: { inputSchema: { shape: {} } } } };
    const accepted = toolParamsFromRegistry(server);
    expect(accepted("get_recipes")).toEqual(["recipe_ids"]);
    expect(accepted("list")).toEqual([]);
    expect(accepted("missing")).toBeUndefined();
  });

  it("is undefined for every tool when the registry cannot be read, so the guard passes everything through", () => {
    expect(toolParamsFromRegistry({})("get_recipes")).toBeUndefined();
    expect(toolParamsFromRegistry(null)("get_recipes")).toBeUndefined();
  });
});
