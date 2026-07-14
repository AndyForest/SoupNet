import crypto from "node:crypto";

/**
 * Deterministic per-importer id minting for corpus import (v1.1 isolation
 * ruling, Andy 2026-07-13).
 *
 * RFC 4122 UUIDv5 (SHA-1, name-based) over a fixed project namespace, with
 * name = `${importerUserId}:${originalId}`. Properties the import design
 * leans on:
 *
 * - Same importer + same original id → the SAME minted id, every run, on any
 *   instance. Re-importing a file is idempotent because the minted id
 *   collides with itself and flows down the same-owner upsert path.
 * - Different importers → different minted ids, so parallel imports of one
 *   source corpus (the fresh-user-per-benchmark-run pattern) produce fully
 *   disjoint subgraphs that cannot cross-contaminate.
 * - The original id is not recoverable from the minted id (one-way), and the
 *   minted id never equals the original (different input space entirely).
 */

/** Fixed namespace for corpus-import minting. Never change this value — every
 *  previously minted id on every instance derives from it. */
const IMPORT_MINT_NAMESPACE = "b5f5c1d2-8e6a-4f3b-9c7d-2a1e0f4b6c8d";

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** RFC 4122 UUIDv5 of `name` within `namespace`. */
function uuidV5(namespace: string, name: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(uuidBytes(namespace))
    .update(name, "utf8")
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The importer's own deterministic id for someone else's row. */
export function mintImportId(importerUserId: string, originalId: string): string {
  return uuidV5(IMPORT_MINT_NAMESPACE, `${importerUserId}:${originalId}`);
}
