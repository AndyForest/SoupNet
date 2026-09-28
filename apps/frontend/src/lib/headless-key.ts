/**
 * Headless keys on the keys page (drafts-and-triage slice 5, S5-K1, S5-K3).
 *
 * The wire uses the ladder's name (`depositLevel`: "full" | "drafts"); the
 * page calls "drafts" headless. The level is chosen when a key is made and
 * never changed, so the page offers the checkbox only on the new-key form.
 */

export const HEADLESS_KEY_DESCRIPTION =
  "Every recipe this key's agent checks waits as a draft for you to review, and the key cannot verify drafts; for agents you expect to run unattended.";

export const HEADLESS_KEY_FIXED_NOTE =
  "Headless is chosen when a key is made. To change it, make a new key and revoke this one.";

export interface ScopedKeyForm {
  readRecipeBookIds: string[];
  writeRecipeBookIds: string[];
  defaultWriteRecipeBookId: string;
  expiresAt: string;
  label: string;
  headless: boolean;
}

/** The POST /keys/scoped body. An unticked checkbox sends no level, so an
 *  ordinary key's request is unchanged from before the slice. */
export function scopedKeyPayload(form: ScopedKeyForm): Record<string, unknown> {
  return {
    readRecipeBookIds: form.readRecipeBookIds,
    writeRecipeBookIds: form.writeRecipeBookIds,
    defaultWriteRecipeBookId: form.defaultWriteRecipeBookId,
    expiresAt: form.expiresAt,
    ...(form.label ? { label: form.label } : {}),
    ...(form.headless ? { depositLevel: "drafts" } : {}),
  };
}

/** The text a headless key's row and banner show; null for an ordinary key.
 *  Like the server's predicate, any level other than "full" reads as
 *  headless; a missing field (an older server) reads as ordinary. */
export function headlessKeyLabel(depositLevel: string | undefined): string | null {
  if (depositLevel === undefined || depositLevel === "full") return null;
  return "Headless: deposits drafts only";
}
