# Browser Verification Workflow

How a UI change gets checked in a real browser, by an agent that did not build it, with evidence a person can step through. Tests and typecheck show the code does what its tests say. This workflow shows what the page does.

The harness is Playwright Test in `tests/e2e/` (see its [README](../../tests/e2e/README.md)). The orchestration is the `browser-verify` skill in `.claude/skills/`.

---

## When to run it

- A pull request changes what a user sees or does in the SPA: new states, error messages, buttons, copy that makes a promise.
- Before merge, on the PR branch, so the description's Demo and validation steps describe what the browser did. After merge, on `main`, when the pre-merge run was skipped or the change landed as part of a stack.
- Not for backend-only changes the SPA never reaches. Those are covered by route tests (testing-plan Layers 2–3).

## Three roles, three files

The workflow separates who states the claims, who checks them, and who reports. The verifier checks the author's claims, not the implementer's conclusions. This is the same separation the [security workflow](security.md) uses between audit and implementation.

1. **Expectations (orchestrating agent), before any browser opens.** An expectations file is written from the PR's description and validation steps, and from the base PR's for a stack. It is not written from the code. It has one expectation per claim:
   - the claim's source, quoted;
   - the actor (a seeded account and its role);
   - the steps in user terms;
   - the expected outcome in words a person can check;
   - fixed screenshot names.

   Where the sources do not say what should happen, the expectation is marked **open**: the run records the outcome and does not judge it. A **control** expectation goes beside each new error state, the same action where it should succeed, so an error that always shows cannot pass. **Extras** go in too, the checks every page gets: an axe scan of the touched pages, a keyboard-only pass on new controls, the mobile project where the phone layout changes, and a reload after each state change.
2. **Verification (a fresh verifier agent).** The verifier reads only the expectations, the environment notes, the harness and the app code. It does not read the implementer's notes or the PR discussion. It writes `tests/e2e/pr-<n>.spec.ts`:
   - one `test` per expectation and one `test.step` per user step;
   - screenshots through `shot()` with the fixed names;
   - every assertion message states the expected behaviour in words, so a failure reads as a sentence.

   It runs the spec and fixes its own spec bugs until each failure is a real finding. It never changes app code or the harness to make something pass.
3. **Results (the verifier).** A results file in plain lists:
   - the run: head, date, ports, command, counts, report path;
   - what did not run, and why;
   - one line per expectation with its status (**met**, **not met**, **unverified**, **open**) and one factual sentence of what the browser showed, with the evidence beneath it;
   - "found, not listed", for anything no expectation covered;
   - the seeded accounts.

The orchestrator then reads the results against the screenshots and relays them with a verdict per expectation. What goes to the person is what the evidence shows, not what the verifier concluded.

## Evidence

- **The Playwright HTML report** is the primary evidence. Every test records a screenshot, video and trace (`playwright.config.ts`), and `shot()` attaches each named screenshot in step order. Open it with `npm run test:e2e:report`. The trace viewer steps through every action with the DOM before and after.
- **Watching live** is optional: `E2E_SLOWMO=500 npx playwright test pr-<n> --headed --project=desktop`.
- **The results file** is the summary a reviewer reads first. Each line points into the report by test title and screenshot name.
- **In a PR description**, the verified items go under **Verified by Claude Code Agent**. An empty **Verified Manually Myself** heading lists the same steps, so the person moves each item across as they rerun it themselves. A description never claims a human check that has not happened.

## Accounts and data

- Every actor is a throwaway `@test.local` account seeded through the API (`seedUser`). Registration returns the verification token only when the backend runs with `ALLOW_AUTO_SETUP=true`, as the dev Docker stack does. Never use the `DEV_USERNAME` account: its state is a person's, and a verification run would change it.
- One set of accounts per test, so concurrent runs never collide on per-user pages.
- Fixture setup through the API is limited to what the expectations allow. The steps under test go through the UI.
- Recipe checks spend embedding quota, so seed at most a couple per scenario. Or run the backend with `EMBEDDINGS_PROVIDER=stub` when the scenario doesn't depend on search quality.
- Clean up with `npx tsx scripts/cleanup-test-data.mts --dry-run`, then without `--dry-run`. Seeded accounts carry a run timestamp, which is what the cleanup deletes; long-lived eval accounts share the domain but not the timestamp, and are kept (testing-plan, Test Data Isolation).

## The spec afterwards

A spec that passes on the merged change is a candidate regression test. The PR's author decides whether it stays in `tests/e2e/`. Keep a test that pins a decision a later change could silently undo (the error link, the control), and drop the rest. The e2e suite is not part of `test:ci`: it needs the running dev stack and a browser.

## Where the files live

- The spec and harness: this repo, `tests/e2e/`.
- Expectations and results: beside whoever runs the verification, not in this repo. One folder per run holds `expectations.md`, `results.md` and, when the run finds something about the harness itself (a helper, the config, an older spec the change broke), `handback.md`. Whoever next works on the harness handles each open `handback.md` and adds a line at its end saying what was done, so harness findings stay with the run that found them and don't depend on any one session. Results for a security fix follow the security workflow's rule: findings stay out of this public repo. The operator keeps them in the private companion repo.
- The report, screenshots, videos and traces: `playwright-report/` and `test-results/`, both gitignored. They can show local dev data.
