import { defineConfig, devices } from "@playwright/test";

// Browser verification against the local dev stack (docs/workflows/browser-verification.md).
// Nothing here starts servers: the backend runs in Docker on :3101
// (`docker compose up --build -d`) and the SPA on :5273 (`npm run dev:frontend`),
// so a run checks exactly the build a person would click through.
//
// Every test records screenshot, video and trace, because the output is
// evidence for a person reading the HTML report, not only a pass/fail signal.

export const FRONTEND_URL = process.env["E2E_FRONTEND_URL"] ?? "http://localhost:5273";
export const BACKEND_URL = process.env["E2E_BACKEND_URL"] ?? "http://localhost:3101";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  // One worker keeps the report in reading order; each test seeds its own
  // accounts, so raising this is safe when speed matters more than order.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/e2e/results.json" }],
  ],
  use: {
    baseURL: FRONTEND_URL,
    screenshot: "on",
    video: "on",
    trace: "on",
    // E2E_SLOWMO=500 with --headed lets a person watch each step happen.
    launchOptions: { slowMo: Number(process.env["E2E_SLOWMO"] ?? 0) },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Mobile runs only tests tagged @mobile: the phone layout is checked
    // where a PR changes what a phone user sees, not on every spec.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
