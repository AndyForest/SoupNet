# tests/e2e — browser verification

Playwright Test against the running dev stack. The process these specs serve (expectations → separate verifier → results) is in [docs/workflows/browser-verification.md](../../docs/workflows/browser-verification.md).

## Run

```bash
docker compose up --build -d      # backend on :3101 (ALLOW_AUTO_SETUP=true seeds accounts)
npm run dev:frontend              # SPA on :5273, in another terminal
npx playwright install chromium   # once
npm run test:e2e                  # all specs; or: npx playwright test pr-96-97
npm run test:e2e:report           # open the HTML report (screenshots, video, trace)
```

Watch a run: `E2E_SLOWMO=500 npx playwright test smoke --headed --project=desktop`.

Other hosts: `E2E_FRONTEND_URL` and `E2E_BACKEND_URL`. For example, `E2E_FRONTEND_URL=http://localhost:5274` verifies a frontend served from another worktree.

Passing `--reporter=list` (or any `--reporter`) replaces the configured reporters, so no HTML report is written. To keep it, use `--reporter=list,html`.

If a run fails oddly, run `npx playwright test smoke` first. It proves a seeded account can reach the dashboard.

## Conventions

- One spec per pull request, `pr-<n>.spec.ts`, with one `test` per expectation ID from the expectations file and a `test.step` per user step.
- Every assertion message states the expected behaviour in words: `expect(link, "the error should link to Recipe Books").toBeVisible()`.
- Screenshots go through `shot(page, testInfo, "<fixed name>")` from `helpers/evidence.ts`, using the names the expectations file fixed, so the report and the results file refer to the same image.
- Accounts come from `seedUser(request, "<label>")` in `helpers/accounts.ts`, fresh per test. Sign in with `signIn(page, user, path)`. The real login form is only for specs about login itself.
- Tag a test `@mobile` to also run it on the phone project.
- `axeScan(page, testInfo, name)` attaches the full axe result and returns the serious and critical violations. `axeFindings(...)` returns all of them grouped as `{ blocking, moderate, minor }`, for specs that record moderate findings.
- Not part of `test:ci`: it needs the dev stack and a browser.
