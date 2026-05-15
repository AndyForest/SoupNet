/**
 * Screenshot capture for the Soup.net sitemap.
 *
 * Captures full-page screenshots of user-facing routes (SPA + agent-facing
 * HTML on the backend) at desktop and mobile viewports. Outputs PNGs to
 * the `screenshots/` directory at the repo root (gitignored — captures
 * are regenerated on demand against the local dev stack and may contain
 * personal data from the logged-in DEV user).
 *
 * Usage:
 *   npm run screenshot                    -- all routes
 *   npm run screenshot -- landing         -- only routes whose name matches "landing"
 *   npm run screenshot -- landing,map     -- multiple substring matches (OR)
 *   npm run screenshot -- --only landing  -- same; --only is the explicit form
 *
 * Filter substrings match against the `name` field of each route (e.g. "landing",
 * "admin", "docs-recipe"). When the filter excludes every authenticated route,
 * the auth phase is skipped to save time.
 *
 * Prereqs:
 *   - Both dev servers running: frontend on :5273, backend on :3101.
 *   - Puppeteer available: `npm install --no-save puppeteer`.
 *   - Auth env vars set (DEV_USERNAME / DEV_PASSWORD typically; see README).
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI ─────────────────────────────────────────────────────────────────────

// Parse a comma-separated list of substring filters. `--only foo,bar` is the
// explicit form; a bare positional `foo,bar` works too. Empty filter → no
// filter (capture everything).
function parseFilters(argv) {
  const args = argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--only" || a === "--routes") {
      const next = args[i + 1];
      if (next) {
        out.push(...next.split(",").map((s) => s.trim()).filter(Boolean));
        i++;
      }
    } else if (!a.startsWith("--")) {
      out.push(...a.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}
const FILTERS = parseFilters(process.argv);
const matchesFilter = (name) => FILTERS.length === 0 || FILTERS.some((f) => name.includes(f));

// ── Config ──────────────────────────────────────────────────────────────────

const FRONTEND = process.env["SCREENSHOT_FRONTEND_URL"] ?? "http://localhost:5273";
const BACKEND = process.env["SCREENSHOT_BACKEND_URL"] ?? "http://localhost:3101";

// Auth — system-role user so admin pages are accessible. No fallback for
// password; we never want a credential in source. Auth is only required if
// the run will hit an authenticated route; the env check happens later, after
// filters are applied.
const USERNAME = process.env["DEV_USERNAME"] ?? process.env["SCREENSHOT_USERNAME"];
const PASSWORD = process.env["DEV_PASSWORD"] ?? process.env["SCREENSHOT_PASSWORD"];

// Viewports — match the iPhone 14 Pro profile and a 1440-wide desktop, which
// matches the design system reference profile in DESIGN.md.
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false };
const MOBILE = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true };

// CSS to hide third-party UI that leaks into screenshots (TanStack Query
// devtools floating button in dev mode). Injected on every page load.
const HIDE_DEVTOOLS_CSS = `
  .tsqd-open-btn-container,
  .tsqd-parent-container,
  [data-tanstack-query-devtools] {
    display: none !important;
  }
`;

// ── Routes ──────────────────────────────────────────────────────────────────

// SPA routes captured against the React app at FRONTEND. `auth` controls
// whether to log in before navigation; `note` captures known caveats.
const SPA_ROUTES = [
  // Public — captured in a clean unauth'd context so no app shell appears.
  { path: "/", name: "landing", auth: false },
  { path: "/auth/login", name: "login", auth: false },
  { path: "/auth/register", name: "register", auth: false },
  { path: "/auth/forgot-password", name: "forgot-password", auth: false },
  { path: "/auth/reset-password?token=invalid", name: "reset-password", auth: false, note: "error state — supply a real token to capture the form variant" },
  { path: "/auth/verify?token=invalid", name: "verify", auth: false, note: "error state — supply a real token to capture the success state" },
  { path: "/info/terms", name: "terms", auth: false },
  { path: "/info/privacy", name: "privacy", auth: false },
  { path: "/info/how-it-works", name: "how-it-works", auth: false },
  { path: "/info/claude-connector", name: "claude-connector", auth: false },
  // Authenticated — captured after login. The DEV user is system role, so
  // /admin/* is reachable.
  { path: "/app/dashboard", name: "dashboard", auth: true },
  { path: "/app/check", name: "check", auth: true },
  { path: "/app/keys", name: "keys", auth: true },
  { path: "/app/groups", name: "groups", auth: true },
  { path: "/app/settings", name: "settings", auth: true },
  { path: "/app/map", name: "map", auth: true },
  { path: "/app/checks", name: "checks", auth: true },
  { path: "/admin", name: "admin", auth: true },
  { path: "/admin/queues", name: "admin-queues", auth: true },
  { path: "/admin/workers/embeddings", name: "admin-embeddings", auth: true },
  { path: "/admin/users", name: "admin-users", auth: true },
];

// Trace detail captured separately because the path includes a dynamic ID
// fetched at runtime from the user's corpus.
const TRACE_DETAIL = { name: "trace-detail", auth: true };

// Agent-facing HTML pages on the backend. Public — no login needed.
const AGENT_ROUTES = [
  { path: "/docs/recipe-check-guide", name: "docs-recipe-check-guide" },
  { path: "/docs/recipe-scenarios", name: "docs-recipe-scenarios" },
  { path: "/docs/mcp-setup", name: "docs-mcp-setup" },
  { path: "/docs/bootstrap", name: "docs-bootstrap" },
  // /check on :3101 requires an API key in the URL; capture only with a
  // throwaway key, which this script doesn't mint. Skipped.
];

// /verify-pending requires a logged-in but unverified user. The dev user is
// verified, so this state isn't reachable from the standard run. Captured
// manually with a throwaway registration; documented in the README.

// ── Helpers ─────────────────────────────────────────────────────────────────

const outDir = path.resolve(__dirname, "../screenshots");
fs.mkdirSync(outDir, { recursive: true });

// Pre-compute filtered route lists so phase logic stays simple.
const PUBLIC_SPA = SPA_ROUTES.filter((r) => !r.auth && matchesFilter(r.name));
const AUTH_SPA = SPA_ROUTES.filter((r) => r.auth && matchesFilter(r.name));
const FILTERED_AGENT = AGENT_ROUTES.filter((r) => matchesFilter(r.name));
const INCLUDE_TRACE = matchesFilter(TRACE_DETAIL.name);

if (FILTERS.length > 0) {
  const total = PUBLIC_SPA.length + AUTH_SPA.length + FILTERED_AGENT.length + (INCLUDE_TRACE ? 1 : 0);
  console.log(`Filter: ${FILTERS.join(", ")} → ${total} route(s) match.`);
  if (total === 0) {
    console.log("Nothing to capture. Exiting.");
    process.exit(0);
  }
}

async function shoot(page, name, viewport, baseUrl, urlPath) {
  await page.setViewport(viewport);
  await page.goto(`${baseUrl}${urlPath}`, { waitUntil: "networkidle2" });
  await page.addStyleTag({ content: HIDE_DEVTOOLS_CSS });
  // Brief pause so any hover/transition state settles.
  await new Promise((r) => setTimeout(r, 600));
  const suffix = viewport.isMobile ? "mobile" : "desktop";
  const file = path.join(outDir, `${name}-${suffix}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function captureBoth(page, name, baseUrl, urlPath) {
  console.log(`  ${name}…`);
  await shoot(page, name, DESKTOP, baseUrl, urlPath);
  await shoot(page, name, MOBILE, baseUrl, urlPath);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const browser = await puppeteer.launch({ headless: "new" });

  // Phase 1: public SPA routes in a clean unauth'd context.
  if (PUBLIC_SPA.length > 0) {
    console.log("Phase 1: public SPA routes (unauth'd)");
    const publicCtx = await browser.createBrowserContext();
    const publicPage = await publicCtx.newPage();
    for (const r of PUBLIC_SPA) {
      await captureBoth(publicPage, r.name, FRONTEND, r.path);
    }
    await publicCtx.close();
  }

  // Phase 2 + 3: authenticated SPA routes (skip the entire auth phase if
  // nothing under it matches the filter — login is the slow part).
  const needsAuth = AUTH_SPA.length > 0 || INCLUDE_TRACE;
  if (needsAuth) {
    if (!USERNAME || !PASSWORD) {
      console.error("Missing auth: set DEV_USERNAME + DEV_PASSWORD (or SCREENSHOT_USERNAME + SCREENSHOT_PASSWORD) in your environment.");
      console.error("Tip: `set -a && source .env && set +a && npm run screenshot` if your .env has DEV_USERNAME/DEV_PASSWORD.");
      process.exit(1);
    }
    console.log("Phase 2: authenticated SPA routes");
    const authCtx = await browser.createBrowserContext();
    const authPage = await authCtx.newPage();
    await authPage.goto(`${FRONTEND}/auth/login`, { waitUntil: "networkidle2" });
    await authPage.type("input[type='email']", USERNAME);
    await authPage.type("input[type='password']", PASSWORD);
    await authPage.click("button[type='submit']");
    await authPage.waitForNavigation({ waitUntil: "networkidle2" });
    console.log("  logged in");
    for (const r of AUTH_SPA) {
      await captureBoth(authPage, r.name, FRONTEND, r.path);
    }

    if (INCLUDE_TRACE) {
      console.log("Phase 3: trace detail");
      try {
        const tracesUrl = `${FRONTEND}/app/checks`;
        await authPage.goto(tracesUrl, { waitUntil: "networkidle2" });
        const traceId = await authPage.evaluate(() => {
          const a = document.querySelector("a[href*='/traces/']");
          const href = a?.getAttribute("href") ?? "";
          const m = href.match(/\/traces\/([0-9a-f-]+)/i);
          return m ? m[1] : null;
        });
        if (traceId) {
          await captureBoth(authPage, TRACE_DETAIL.name, FRONTEND, `/traces/${traceId}`);
        } else {
          console.log("  no trace IDs on /app/checks — skipping trace-detail capture");
        }
      } catch (err) {
        console.log("  trace-detail capture failed:", err.message);
      }
    }
    await authCtx.close();
  }

  // Phase 4: agent-facing HTML on backend (no auth needed).
  if (FILTERED_AGENT.length > 0) {
    console.log("Phase 4: agent-facing HTML (backend :3101)");
    const agentCtx = await browser.createBrowserContext();
    const agentPage = await agentCtx.newPage();
    for (const r of FILTERED_AGENT) {
      await captureBoth(agentPage, r.name, BACKEND, r.path);
    }
    await agentCtx.close();
  }

  await browser.close();

  // Auto-generated flat index. Only regenerate
  // on a full unfiltered run — a partial index would misleadingly suggest
  // missing routes were never captured.
  if (FILTERS.length === 0) {
    const lines = ["# Sitemap (auto-generated)\n", "Flat list of every captured route. Regenerated by `npm run screenshot`.\n"];
    for (const r of SPA_ROUTES) {
      lines.push(`## SPA \`${r.path}\`${r.note ? `  — _${r.note}_` : ""}`);
      lines.push(`- desktop: \`${r.name}-desktop.png\``);
      lines.push(`- mobile: \`${r.name}-mobile.png\``);
      lines.push("");
    }
    lines.push(`## SPA \`/traces/<id>\``);
    lines.push(`- desktop: \`${TRACE_DETAIL.name}-desktop.png\``);
    lines.push(`- mobile: \`${TRACE_DETAIL.name}-mobile.png\``);
    lines.push("");
    for (const r of AGENT_ROUTES) {
      lines.push(`## Backend \`${r.path}\``);
      lines.push(`- desktop: \`${r.name}-desktop.png\``);
      lines.push(`- mobile: \`${r.name}-mobile.png\``);
      lines.push("");
    }
    fs.writeFileSync(path.join(outDir, "_index.md"), lines.join("\n"));
  }
  const captured = PUBLIC_SPA.length + AUTH_SPA.length + (INCLUDE_TRACE ? 1 : 0) + FILTERED_AGENT.length;
  console.log(`Done. ${captured} route(s) × 2 viewports → ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
