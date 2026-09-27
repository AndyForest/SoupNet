---
name: browser-verify
description: "Verify a UI change in a real browser: write expectations from the PR's claims, hand them to a fresh verifier agent that writes and runs a Playwright spec, then relay labelled results with the HTML report. Use when asked to browser-check, demo, or verify a pull request or a merged change that affects the SPA."
---

# Browser verification

You are the orchestrator. You write the expectations and relay the results. You do not write the spec: a fresh verifier agent does, so the check is independent of whoever built the change and of your reading of the code. Read `docs/workflows/browser-verification.md` for the why. This file is the how.

## 0. Set up

- **Where expectations and results go.** Ask the person if it isn't stated. The default is a working directory outside this repo. For a security fix, results never go in this repo.
- **The stack.** Backend: `docker compose up --build -d` from the checkout whose code is under test, then check `curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health/ready` returns 200. Frontend: `npm run dev:frontend` in the background, from a worktree at the head under test.
- **The harness.** If `@playwright/test` is missing from the worktree, run `npm install`. Then `npx playwright install chromium`, then `npx playwright test smoke`. Don't go on until smoke passes.
- **Open handbacks.** Look for `handback.md` files in earlier run folders that have no closing line, and handle them first: they are harness problems an earlier run found.
- **One dev server serves one head.** PRs in a stack are verified one after another. If other sessions use the stack, tell them before you move the frontend.

## 1. Expectations, before any browser opens

Read the PR descriptions, including the base PR for a stack, and any validation steps the person handed you. Do not read the implementation to decide what should happen. Write `expectations.md` as lists (the person annotates it in place, and tables break under that):

- **Head under test.** The commit, the status values (met / not met / unverified / open), the environment (ports, how accounts are seeded, limits on API fixture setup).
- **One `E<n>` per claim.** Each has:
  - the source, quoted;
  - the actor;
  - the steps in user terms;
  - the expected outcome in checkable words;
  - fixed screenshot names (`E<n>-NN-<what-it-shows>`).
- **Open expectations.** Where the sources don't say what the page should do, mark it open: record the outcome, don't assert it.
- **A control for every new error or empty state.** The same action where it should succeed.
- **"Every X" or "each X" in a claim.** Add an expectation that the verifier lists every X it finds in the app.
- **Extras.** An axe scan of the touched pages, a keyboard-only pass on new controls, the mobile project where the phone layout changed, and a reload after each state change.
- **Out of scope.** Say what is out of scope and why (API-only behaviour the SPA never calls, concurrency).

## 2. Launch the verifier

Use the Agent tool with `subagent_type: general-purpose`, in the background. Never use a fork: a fork inherits your context, which is exactly the dependence this step removes. The brief:

> You are the browser verifier in a three-step verification: someone else wrote the expectations, you check them in a real browser, and a results file reports what you saw.
>
> **Read:** `<expectations path>` (your contract); the harness in `<worktree>`: `playwright.config.ts`, `tests/e2e/helpers/*`, `tests/e2e/smoke.spec.ts`, `tests/e2e/README.md`; the app code as needed for pages, selectors and fixture routes. Do not read the PR descriptions, git log messages, or `<private findings dir, if any>`.
>
> **Environment (running; do not restart):** `<ports>`. Work only in `<worktree>`. Seed every actor with `seedUser`; never use the DEV_USERNAME account.
>
> **Do:**
> 1. Write `tests/e2e/pr-<n>.spec.ts`: one test per expectation, `test.step` per user step, the fixed screenshot names via `shot()`, and an assertion message on every assertion stating the expected behaviour in words. Tag `@mobile` where the expectations ask.
> 2. Run it with `npx playwright test pr-<n>`.
> 3. Fix spec bugs until every failure is a real finding. Never change app code, the config or the helpers to make something pass. A failing assertion that shows the app is wrong stays failing.
> 4. Read your screenshots and confirm each shows what you say it does.
> 5. Write `<results path>` as lists:
>    - the run: head, date, ports, command, counts per project, report path;
>    - what did not run, and why;
>    - per expectation: ID, status, one factual sentence, then indented the screenshot names and test title; for anything not met, what the page showed against what was expected, and the code you believe responsible, marked as your reading;
>    - "Found, not listed";
>    - the seeded accounts.
> 6. Anything you find about the harness itself (a helper, the config, an older spec this change broke) goes in `handback.md` beside the results, not in the results.
> 7. Do not commit or push.
>
> **Report back:** the results file's top section and the per-expectation lines, and anything that blocked you.

## 3. Check the results before relaying them

- Open the screenshots behind every **met** and **not met** yourself. A verifier can assert on the wrong element and pass.
- For each **not met**, confirm the mechanism against the code at the head. Add your own verdict: confirmed, plausible, or spec bug. For a spec bug, send the verifier back (SendMessage) rather than editing the spec yourself.
- **Unverified** items: check whether the machine already has what the verifier lacked. Often one curl or one seeded account settles it.

## 4. Show the person

- The command: `npm run test:e2e:report`, run from the worktree. It serves the HTML report, and the trace viewer is one click from each test.
- The results in chat, in this order: that the run happened (head, counts); what did not run; one line per expectation with its status; findings with the screenshot name to look at; the seeded-account cleanup command.
- For a PR that isn't merged yet: draft the description's verification under **Verified by Claude Code Agent**, with an empty **Verified Manually Myself** heading carrying the same steps. Never write a step as done by the person.
- The spec: offer it for `tests/e2e/`, naming which tests pin a decision worth keeping. The author decides. Don't commit it unasked.
