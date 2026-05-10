# Scripts

Utility scripts for development and tooling. Not part of the application runtime — these are operator-side helpers.

## `screenshot.mjs` — sitemap screenshot capture

Captures full-page screenshots of every user-facing route at desktop and mobile viewports, for local design-system review. Output goes to `screenshots/` at the repo root (gitignored — captures may include personal data from the logged-in DEV user).

### Two surfaces, one script

The script captures both surfaces of the product:

- **Human SPA** at `:5273` — public pages (clean unauth'd context), authenticated pages, admin pages (DEV user has the system role).
- **Agent-facing HTML** at `:3101` — the four `/docs/*` reference pages served by the backend for AI agents reading via `fetch`.

It also captures the dynamic `/traces/$traceId` detail page, picking a real trace ID from the user's corpus at runtime (skipped if the corpus is empty).

### Prerequisites

1. **Dev servers running** — frontend on `:5273` and backend on `:3101`. Easiest: `docker compose up -d` and `npm run dev:frontend`.
2. **Puppeteer installed** — Puppeteer is a root `devDependency`, so `npm install` at the repo root pulls it in (along with a one-time ~170MB Chromium binary).
3. **Auth env vars** — the script logs in with `DEV_USERNAME` / `DEV_PASSWORD` (the auto-created system-role dev user). Both must be in your environment when the script runs. `SCREENSHOT_USERNAME` / `SCREENSHOT_PASSWORD` are accepted as overrides if you want to capture as a different user. **No fallback for password** — the script exits 1 if neither is set, so a credential never has to live in source.

### Usage

```bash
# Full sitemap (all 24 routes × 2 viewports)
set -a && source .env && set +a && npm run screenshot

# Targeted: only routes whose name contains "landing"
npm run screenshot -- landing

# Multiple substring matches (OR)
npm run screenshot -- landing,map

# Explicit form
npm run screenshot -- --only landing
```

(Equivalent to `node scripts/screenshot.mjs`. The `screenshot` npm script is defined in the root `package.json`.)

The filter matches against the `name` field of each route entry (e.g. `landing`, `admin-users`, `docs-recipe-check-guide`). When the filter excludes every authenticated route, the auth phase is skipped — useful for capturing only public pages without needing `DEV_USERNAME` / `DEV_PASSWORD` set. The auto-generated `_index.md` is only regenerated on a full unfiltered run, so a partial run can't make it look like missing routes were never captured.

### What it does

1. Opens a clean unauth'd browser context. Captures public SPA routes (landing, login, register, forgot/reset/verify password, terms, privacy).
2. Opens an authenticated context, logs in via the form, captures the authenticated SPA routes (dashboard, check, keys, groups, settings, map, checks, admin landing + queues + embeddings + users).
3. Hits `/checks`, scrapes a real trace ID from the page, captures `/traces/<id>`.
4. Opens a third unauth'd context against `:3101` and captures the agent-facing HTML pages (`/docs/recipe-check-guide`, `/docs/recipe-scenarios`, `/docs/mcp-setup`, `/docs/bootstrap`).
5. Hides third-party UI like the TanStack Query devtools floating button via injected CSS so it doesn't leak into screenshots.
6. Writes PNGs to `screenshots/` named `${routeName}-desktop.png` and `${routeName}-mobile.png`.
7. Writes a flat auto-generated index at `screenshots/_index.md`.

### Viewports

- **Desktop:** 1440 × 900, DPR 1
- **Mobile:** iPhone 14 Pro profile (393 × 852, DPR 3, mobile mode enabled)

These match the design-system reference captures behind `DESIGN.md`. Override via the `DESKTOP` / `MOBILE` constants at the top of the script if needed for a one-off.

### Routes that need special handling (not captured automatically)

- **`/verify-pending`** — requires a logged-in but *unverified* user. The DEV user is verified, so this state isn't reachable from the standard run. Capture manually by registering a throwaway account and screenshotting before verifying.
- **`/reset-password`** and **`/verify`** with valid tokens — the script captures the error/empty state by passing a dummy token in the URL. Capture the success state separately by triggering a real password-reset / email-verification flow.
- **Backend `:3101/check`** — the agent-facing recipe-check form. Requires an API key in the URL, which would expose the key in the screenshot. Capture manually with a short-lived throwaway key if needed.

### Modifying routes

If new routes are added, edit the `SPA_ROUTES` or `AGENT_ROUTES` arrays at the top of `screenshot.mjs`. Each entry is `{ path, name, auth?, note? }` for SPA or `{ path, name }` for agent. The `name` becomes the screenshot filename prefix.

If it's a routing change, also re-check `apps/frontend/src/routeTree.ts`.
