import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Load .env so DATABASE_URL, BACKEND_URL, etc. reach tests
// without requiring manual `source .env` on Windows.
function loadDotEnv(): Record<string, string> {
  try {
    const text = readFileSync(".env", "utf-8");
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1);
      // Strip surrounding single or double quotes (standard dotenv behavior,
      // matches `node --env-file=.env`). Without this, values like
      // DEV_PASSWORD="#!&..." arrive with the outer quotes included.
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      // Don't override env vars already set (e.g., from CLI or CI)
      if (process.env[key] === undefined) {
        env[key] = value;
      }
    }
    return env;
  } catch { return {}; }
}

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "scripts/**/*.test.mts",
    ],
    env: loadDotEnv(),
    // Set 2026-06-11 when integration beforeAll hooks signed users up over
    // HTTP (register → verify → login), each costing the backend a 12-round
    // bcryptjs hash on its single thread; the 10s default hook timeout was
    // marginal on a loaded machine. Setup users now come from
    // apps/backend/src/test-users.ts, which keeps that work off the backend
    // (2026-09-28). These are ceilings, not targets: passing runs are
    // unaffected.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
