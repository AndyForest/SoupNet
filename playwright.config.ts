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

// Every run empties its output folder and rewrites its report. Parallel
// verifiers on one stack give each run its own, e.g. E2E_RUN=regression-s3
// writes test-results/regression-s3 and playwright-report-regression-s3.
const RUN = process.env["E2E_RUN"];
const OUTPUT_DIR = RUN ? `test-results/${RUN}` : "test-results/e2e";
const REPORT_DIR = RUN ? `playwright-report-${RUN}` : "playwright-report";
// Command-line --reporter replaces the reporters below; these variables send
// its html and json output to the same run folders.
process.env["PLAYWRIGHT_HTML_OUTPUT_DIR"] ??= REPORT_DIR;
process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"] ??= `${OUTPUT_DIR}/results.json`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: OUTPUT_DIR,
  // One worker keeps the report in reading order; each test seeds its own
  // accounts, so raising this is safe when speed matters more than order.
  workers: 1,
  // One retry absorbs a dev-server blip (Vite re-optimising dependencies
  // after an install refuses a request); the report marks such a test
  // "flaky", so a pass on retry is visible, never silent.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: REPORT_DIR, open: "never" }],
    ["json", { outputFile: `${OUTPUT_DIR}/results.json` }],
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
    // @mobile tests also run here (a desktop result for the same steps);
    // @mobile-only keeps a phone-specific expectation off the desktop project.
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile-only/ },
    // Mobile runs only tests tagged @mobile: the phone layout is checked
    // where a PR changes what a phone user sees, not on every spec.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
