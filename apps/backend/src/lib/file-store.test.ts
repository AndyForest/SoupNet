import { describe, it, expect } from "vitest";
import { storeFile, FileStoreError } from "./file-store";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const UPLOADS_DIR = resolve(process.cwd(), "uploads", "artifacts");

// A tiny valid PNG (1x1 pixel, transparent)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("file-store", () => {
  it("stores a PNG and returns content-addressed path", async () => {
    const result = await storeFile(TINY_PNG, "image/png");
    const expectedHash = createHash("sha256").update(TINY_PNG).digest("hex");

    expect(result.contentHash).toBe(expectedHash);
    expect(result.publicUrl).toContain(`/uploads/artifacts/${expectedHash}.png`);
    expect(result.filePath).toBe(`artifacts/${expectedHash}.png`);

    // File actually exists on disk
    const stored = await readFile(resolve(UPLOADS_DIR, `${expectedHash}.png`));
    expect(stored.equals(TINY_PNG)).toBe(true);

    // Cleanup
    await rm(resolve(UPLOADS_DIR, `${expectedHash}.png`));
  });

  it("deduplicates identical files", async () => {
    const r1 = await storeFile(TINY_PNG, "image/png");
    const r2 = await storeFile(TINY_PNG, "image/png");
    expect(r1.contentHash).toBe(r2.contentHash);
    expect(r1.publicUrl).toBe(r2.publicUrl);

    // Cleanup
    await rm(resolve(UPLOADS_DIR, `${r1.contentHash}.png`));
  });

  it("rejects unsupported MIME types", async () => {
    await expect(storeFile(TINY_PNG, "image/gif")).rejects.toThrow(FileStoreError);
    await expect(storeFile(TINY_PNG, "text/plain")).rejects.toThrow(FileStoreError);
    await expect(storeFile(TINY_PNG, "application/json")).rejects.toThrow(FileStoreError);
  });

  it("rejects empty files", async () => {
    await expect(storeFile(Buffer.alloc(0), "image/png")).rejects.toThrow(FileStoreError);
  });

  it("rejects files over max upload size", async () => {
    const { MAX_UPLOAD_BYTES } = await import("@soupnet/domain");
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    await expect(storeFile(big, "image/png")).rejects.toThrow(FileStoreError);
  });

  it("accepts video MIME types", async () => {
    const result = await storeFile(TINY_PNG, "video/mp4"); // bytes don't matter for MIME validation
    expect(result.publicUrl).toContain(".mp4");
    const { rm: rmFile } = await import("node:fs/promises");
    const { resolve: resolvePath } = await import("node:path");
    await rmFile(resolvePath(process.cwd(), "uploads", "artifacts", `${result.contentHash}.mp4`));
  });

  it("accepts audio MIME types", async () => {
    const result = await storeFile(TINY_PNG, "audio/mpeg");
    expect(result.publicUrl).toContain(".mp3");
    const { rm: rmFile } = await import("node:fs/promises");
    const { resolve: resolvePath } = await import("node:path");
    await rmFile(resolvePath(process.cwd(), "uploads", "artifacts", `${result.contentHash}.mp3`));
  });
});
