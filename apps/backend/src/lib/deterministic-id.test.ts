import { describe, it, expect } from "vitest";
import { mintImportId } from "./deterministic-id";

const USER_B = "11111111-1111-4111-8111-111111111111";
const USER_C = "22222222-2222-4222-8222-222222222222";
const ORIGINAL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("mintImportId", () => {
  it("is deterministic: same importer + same original → same id, every call", () => {
    expect(mintImportId(USER_B, ORIGINAL)).toBe(mintImportId(USER_B, ORIGINAL));
  });

  // The isolation property parallel benchmark runs depend on.
  it("differs across importers for the same original", () => {
    expect(mintImportId(USER_B, ORIGINAL)).not.toBe(mintImportId(USER_C, ORIGINAL));
  });

  it("differs across originals for the same importer", () => {
    expect(mintImportId(USER_B, ORIGINAL)).not.toBe(mintImportId(USER_B, USER_C));
  });

  it("never returns the original id", () => {
    expect(mintImportId(USER_B, ORIGINAL)).not.toBe(ORIGINAL);
  });

  it("emits a valid RFC 4122 v5 UUID (version nibble 5, variant 8-b)", () => {
    const id = mintImportId(USER_B, ORIGINAL);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  // Guards the "never change the namespace" contract: if the constant or the
  // hashing changes, previously minted ids on live instances stop colliding
  // with re-imports and idempotency silently breaks. Pinned vector computed
  // from the current implementation at introduction (2026-07-13).
  it("matches the pinned vector for the frozen namespace", () => {
    expect(mintImportId(USER_B, ORIGINAL)).toBe(
      "4890b143-fabe-58f5-bf02-01f74d8af294",
    );
  });
});
