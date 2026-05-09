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
    ],
    env: loadDotEnv(),
  },
});
