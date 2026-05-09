import { describe, it, expect } from "vitest";
import { enqueueEmbedding } from "./enqueue";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/** Stand-in db — the invariant check runs before any DB access, so a
 *  proxy that throws on any property access is sufficient. */
const unusedDb = new Proxy({}, {
  get() { throw new Error("db should not be touched when the invariant throws"); },
}) as unknown as PostgresJsDatabase;

describe("enqueueEmbedding structural invariant", () => {
  it("rejects deferToWorker=true when a fileBuffer is present", async () => {
    await expect(
      enqueueEmbedding(unusedDb, {
        sourceType: "evidence",
        sourceId: "00000000-0000-0000-0000-000000000000",
        groupId: "00000000-0000-0000-0000-000000000000",
        sourceText: "test",
        artifactCategory: "multimodal",
        fileBuffer: Buffer.from("image-bytes"),
        fileMimeType: "image/png",
        deferToWorker: true,
      }),
    ).rejects.toThrow(/deferToWorker.*incompatible.*fileBuffer/);
  });

  it("accepts deferToWorker=true without a fileBuffer (text-only path)", async () => {
    // We don't care about the DB call succeeding — we only verify the
    // invariant check doesn't throw before the DB is touched. Any non-
    // invariant error proves we got past the guard.
    await expect(
      enqueueEmbedding(unusedDb, {
        sourceType: "evidence",
        sourceId: "00000000-0000-0000-0000-000000000000",
        groupId: "00000000-0000-0000-0000-000000000000",
        sourceText: "text-only",
        artifactCategory: "text",
        deferToWorker: true,
      }),
    ).rejects.toThrow(/db should not be touched/);
  });

  it("accepts fileBuffer without deferToWorker (sync multimodal path)", async () => {
    await expect(
      enqueueEmbedding(unusedDb, {
        sourceType: "evidence",
        sourceId: "00000000-0000-0000-0000-000000000000",
        groupId: "00000000-0000-0000-0000-000000000000",
        sourceText: "test",
        artifactCategory: "multimodal",
        fileBuffer: Buffer.from("image-bytes"),
        fileMimeType: "image/png",
        deferToWorker: false,
      }),
    ).rejects.toThrow(/db should not be touched/);
  });
});
