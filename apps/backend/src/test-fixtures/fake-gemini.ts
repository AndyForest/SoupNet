/**
 * A local stand-in for the Gemini embedding API, so tests can run the real client,
 * the real routes and the real worker without quota. Point a backend at it with
 * GEMINI_API_BASE_URL.
 *
 * Vectors carry their provenance in the first two dimensions, so a test can read a
 * stored row and see what made it: dimension 0 identifies the model on the wire,
 * dimension 1 is high when an image part was sent.
 */

import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const DIMS = 3072;

export const MODEL_MARKERS: Record<string, number> = {
  "gemini-embedding-2-preview": 0.25,
  "gemini-embedding-2": 0.75,
};
export const IMAGE_MARKER = 0.75;
export const TEXT_MARKER = 0.25;

export interface FakeGeminiCall {
  model: string;
  kind: "embed" | "batch";
  count: number;
  sentTaskType: boolean;
  sentImage: boolean;
}

function vectorFor(model: string, text: string, hasImage: boolean): number[] {
  const out = new Array<number>(DIMS);
  let seed = createHash("sha256").update(`${model}\0${text}`).digest();
  for (let i = 2; i < DIMS; i++) {
    const byte = i % 32;
    if (byte === 0) seed = createHash("sha256").update(seed).digest();
    out[i] = (seed[byte]! - 128) / 512;
  }
  out[0] = MODEL_MARKERS[model] ?? 0;
  out[1] = hasImage ? IMAGE_MARKER : TEXT_MARKER;
  return out;
}

interface Part { text?: string; inlineData?: { mimeType: string; data: string } }

export class FakeGemini {
  calls: FakeGeminiCall[] = [];
  /** Next N calls for a model answer 429. */
  rateLimit = new Map<string, number>();
  /** Calls to one model whose text contains a string answer 400, like a refused input. */
  poison: { model: string; text: string } | null = null;
  /** Models answering 404, like one the provider has stopped serving. */
  gone = new Set<string>();
  /** Calls to a model take this long to answer, in milliseconds. */
  delay = new Map<string, number>();
  private server: Server | null = null;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.handle(req.url ?? "", Buffer.concat(chunks).toString("utf8"), res));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}/v1beta/models`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  callsFor(model: string): FakeGeminiCall[] {
    return this.calls.filter((c) => c.model === model);
  }

  private handle(
    url: string,
    rawBody: string,
    res: ServerResponse,
  ): void {
    const match = /\/models\/([^:]+):(embedContent|batchEmbedContents)/.exec(url);
    if (!match) {
      res.writeHead(404).end("{}");
      return;
    }
    const model = decodeURIComponent(match[1]!);
    const body = JSON.parse(rawBody) as {
      content?: { parts: Part[] };
      taskType?: string;
      requests?: Array<{ content: { parts: Part[] }; taskType?: string }>;
    };
    const requests = body.requests ?? [{ content: body.content!, ...(body.taskType ? { taskType: body.taskType } : {}) }];
    const textOf = (parts: Part[]) => parts.map((p) => p.text ?? "").join("\n");
    const hasImage = (parts: Part[]) => parts.some((p) => p.inlineData);

    this.calls.push({
      model,
      kind: body.requests ? "batch" : "embed",
      count: requests.length,
      sentTaskType: requests.some((r) => r.taskType !== undefined),
      sentImage: requests.some((r) => hasImage(r.content.parts)),
    });

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      setTimeout(() => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(payload));
      }, this.delay.get(model) ?? 0);
    };

    if (this.gone.has(model)) {
      send(404, { error: { code: 404, status: "NOT_FOUND", message: `models/${model} is not found` } });
      return;
    }
    const limited = this.rateLimit.get(model) ?? 0;
    if (limited > 0) {
      this.rateLimit.set(model, limited - 1);
      send(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, { "Retry-After": "1" });
      return;
    }
    const poison = this.poison;
    if (poison && poison.model === model && requests.some((r) => textOf(r.content.parts).includes(poison.text))) {
      send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "refused input" } });
      return;
    }

    if (body.requests) {
      send(200, {
        embeddings: requests.map((r) => ({
          values: vectorFor(model, textOf(r.content.parts), hasImage(r.content.parts)),
        })),
      });
    } else {
      const parts = requests[0]!.content.parts;
      send(200, { embedding: { values: vectorFor(model, textOf(parts), hasImage(parts)) } });
    }
  }
}
