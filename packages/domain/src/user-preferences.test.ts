import { describe, it, expect } from "vitest";
import {
  userPreferencesSchema,
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  applyPreferencesPatch,
} from "./user-preferences";
import type { UserPreferences } from "./user-preferences";

describe("userPreferencesSchema", () => {
  it("accepts a sparse features group", () => {
    const parsed = userPreferencesSchema.safeParse({ features: { synthesize: true } });
    expect(parsed.success).toBe(true);
  });

  it("accepts both groups together", () => {
    const parsed = userPreferencesSchema.safeParse({
      briefing: { clusterCount: 7 },
      features: { synthesize: false },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown top-level keys (.strict())", () => {
    expect(userPreferencesSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("rejects unknown keys inside the features group (.strict())", () => {
    expect(userPreferencesSchema.safeParse({ features: { enabled: true } }).success).toBe(false);
  });

  it("rejects a non-boolean synthesize value", () => {
    expect(userPreferencesSchema.safeParse({ features: { synthesize: "yes" } }).success).toBe(false);
  });
});

describe("DEFAULT_USER_PREFERENCES", () => {
  it("defaults synthesize off", () => {
    expect(DEFAULT_USER_PREFERENCES.features.synthesize).toBe(false);
  });
});

describe("mergeUserPreferences", () => {
  it("fills feature defaults when nothing is stored", () => {
    expect(mergeUserPreferences({})).toEqual(DEFAULT_USER_PREFERENCES);
    expect(mergeUserPreferences(undefined)).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("carries an explicit synthesize override through", () => {
    const merged = mergeUserPreferences({ features: { synthesize: true } });
    expect(merged.features.synthesize).toBe(true);
    // Briefing defaults still fill in — one group's override does not clobber the other.
    expect(merged.briefing).toEqual(DEFAULT_USER_PREFERENCES.briefing);
  });

  it("treats unparseable input as empty and returns full defaults", () => {
    // Unknown key fails .strict(), so the whole object is discarded → defaults.
    expect(mergeUserPreferences({ features: { bogus: 1 } })).toEqual(DEFAULT_USER_PREFERENCES);
  });
});

describe("applyPreferencesPatch", () => {
  it("patches features without clobbering briefing", () => {
    const existing: UserPreferences = { briefing: { clusterCount: 9 } };
    const next = applyPreferencesPatch(existing, { features: { synthesize: true } });
    expect(next.features).toEqual({ synthesize: true });
    expect(next.briefing).toEqual({ clusterCount: 9 });
  });

  it("patches briefing without clobbering features", () => {
    const existing: UserPreferences = { features: { synthesize: true } };
    const next = applyPreferencesPatch(existing, { briefing: { clusterCount: 3 } });
    expect(next.briefing).toEqual({ clusterCount: 3 });
    expect(next.features).toEqual({ synthesize: true });
  });

  it("merges into an existing features group rather than replacing it", () => {
    const existing: UserPreferences = { features: { synthesize: false } };
    const next = applyPreferencesPatch(existing, { features: { synthesize: true } });
    expect(next.features).toEqual({ synthesize: true });
  });

  it("returns the sparse form (only set keys) from an empty base", () => {
    const next = applyPreferencesPatch(undefined, { features: { synthesize: true } });
    expect(next).toEqual({ features: { synthesize: true } });
  });
});
