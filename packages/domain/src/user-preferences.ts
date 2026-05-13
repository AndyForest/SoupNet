/**
 * User-level preferences. Stored sparsely as a JSONB column on
 * claimnet.users.preferences — the stored object may contain only the keys
 * the user has explicitly overridden. Always merge with DEFAULT_USER_PREFERENCES
 * before use via mergeUserPreferences().
 *
 * Extensibility: new preference groups should be added as new top-level keys
 * (e.g. preferences.privacy, preferences.notifications). Each group has its
 * own Zod sub-schema and corresponding defaults. Keep keys camelCase to match
 * the wire format.
 */
import { z } from "zod";

// ── Briefing preferences ────────────────────────────────────────────────────

export const briefingPreferencesSchema = z.object({
  /**
   * Number of clusters returned in the cluster-exemplars section of the
   * unified briefing. Bigger numbers give the agent a wider view of the
   * corpus shape at the cost of context-window space.
   */
  clusterCount: z.number().int().min(1).max(20).optional(),

  /**
   * Stub for the planned sub-cluster drill-down. Value of 1 means no
   * sub-clustering (the current behavior). The unified briefing pipeline
   * reads this field but currently ignores values > 1.
   */
  subClusterCount: z.number().int().min(1).max(10).optional(),
}).strict();

export type BriefingPreferences = z.infer<typeof briefingPreferencesSchema>;

// ── Root schema ─────────────────────────────────────────────────────────────

export const userPreferencesSchema = z.object({
  briefing: briefingPreferencesSchema.optional(),
}).strict();

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

// ── Defaults ────────────────────────────────────────────────────────────────

export interface ResolvedBriefingPreferences {
  clusterCount: number;
  subClusterCount: number;
}

export interface ResolvedUserPreferences {
  briefing: ResolvedBriefingPreferences;
}

export const DEFAULT_USER_PREFERENCES: ResolvedUserPreferences = {
  briefing: {
    clusterCount: 5,
    subClusterCount: 1,
  },
};

/**
 * Merge a sparse stored preferences object (or unknown DB value) with the
 * defaults so callers always get a complete, typed object. Unknown input is
 * treated as empty — callers should validate with userPreferencesSchema
 * first if the input is from the wire.
 */
export function mergeUserPreferences(stored: unknown): ResolvedUserPreferences {
  const parsed = userPreferencesSchema.safeParse(stored ?? {});
  const sparse: UserPreferences = parsed.success ? parsed.data : {};
  return {
    briefing: {
      clusterCount: sparse.briefing?.clusterCount ?? DEFAULT_USER_PREFERENCES.briefing.clusterCount,
      subClusterCount: sparse.briefing?.subClusterCount ?? DEFAULT_USER_PREFERENCES.briefing.subClusterCount,
    },
  };
}

/**
 * Deep-merge a partial update into an existing stored preferences object.
 * Returns the sparse form (only set keys) suitable for writing back to JSONB.
 * Used by PATCH /me/preferences.
 */
export function applyPreferencesPatch(
  existing: unknown,
  patch: UserPreferences,
): UserPreferences {
  const base: UserPreferences =
    userPreferencesSchema.safeParse(existing ?? {}).data ?? {};

  const next: UserPreferences = { ...base };
  if (patch.briefing) {
    next.briefing = { ...(base.briefing ?? {}), ...patch.briefing };
  }
  return next;
}
