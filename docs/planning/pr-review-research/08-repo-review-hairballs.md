# 08: Hairballs in this repo's own PR and review process

Research track 8 for [../pr-review-helpers.md](../pr-review-helpers.md), by agent `a-pr-review-research-hairballs-2026-09-27`, 2026-09-27. The operator asked: "Go through the PR documentation and the PR review documentation I gave you. Check for any hariballs in there that we could solve in a better way."

Read: `CLAUDE.md` (main checkout, which is newer than this worktree's for Pre-Commit and adds `browser-verify`), `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `docs/workflows/security.md`, `docs/workflows/browser-verification.md` and `.claude/skills/browser-verify/SKILL.md` (main checkout only), `docs/testing-plan.md` (main checkout, which has Layer 3b), `docs/briefing-specs/README.md` and `spec-decision-log.md`, and `docs/planning/drafts-and-triage-build.md` (How the work is run, the slice 2 rubric and verification record, the rulings).

## Key findings for the plan

- **The PR is not yet the one place a reviewer finds the evidence.** Verification lives in the build log (repo), the browser results ("not in this repo"), the security audit (private), recipes (Soup.net), and the operator's "handoff list" (no home found). The PR template carries four checkboxes and none of the conventions the other docs define. Smallest fix is plain: extend the template. Soup.net's part is the plan's existing convention that every recipe cites the PR URL, so `search_recipes "pull/N"` gathers the judgment trail.
- **Deferred Layer 4 checks pile up with no home.** Three slices end with "stays on the operator's handoff list", and nothing in the repo is that list. Fix: they go in each PR's **Verified Manually Myself** heading, which `browser-verification.md` already defines.
- **Layer 4 mixes two jobs.** Mechanical "page loads" checks are now the verifier's job (Layer 3b). The operator's original reason for Layer 4 was alignment: "What would you like my eyes on to make sure we're aligned on what success looks like". Alignment questions are taste and judgment, so they fit `my-drafts`. Page-load checks do not.
- **Orchestrator escalations are buried in a long log.** The drafts build log is the operator's review surface for rulings and verdicts. Escalations fit drafts about the operator, rated impact × uncertainty, in `/app/drafts`. This is the plan's `my-drafts` loop pointed at the operator's own build process: a free dogfood tracer once drafts deploy.
- **The "before committing" sweep and the PR sweep are the same retrieval.** `pr-review-assist` run on one's own branch before the push can replace a step each agent must remember from CLAUDE.md.
- **Some hairballs are plain tooling, not Soup.net:** the briefing-spec declaration rule has no guard, the CI env mirror is kept by hand, and CLAUDE.md contradicts itself on when to commit.
- **Fine as is:** the operator's own push step, and the separate audit and implementation roles. Both are deliberate human or independence gates.

## Hairballs, ranked by payoff to the operator

### 1. Verification evidence is scattered, and the PR template carries none of the conventions

Quotes:

- `docs/workflows/browser-verification.md`, Evidence: "In a PR description, the verified items go under **Verified by Claude Code Agent**. An empty **Verified Manually Myself** heading lists the same steps, so the person moves each item across as they rerun it themselves."
- `docs/workflows/browser-verification.md`, Where the files live: "Expectations and results: beside whoever runs the verification, not in this repo."
- `docs/briefing-specs/README.md`, The regression rule: "must **declare which scenarios it intends to change** — name the files/scenarios in the PR description".
- `CONTRIBUTING.md`, Pull requests: "If it can't be tested automatically, document the manual verification steps in the PR."
- `.github/PULL_REQUEST_TEMPLATE.md`, Tests: "- [ ] `npm run test:ci` passes locally". The template has What, Why, Tests and Docs, and no heading for any of the conventions above.
- `docs/planning/drafts-and-triage-build.md`, Rubrics and verification records: "the verifier records the evidence (test name and file, command output, byte counts) next to each one in the slice's verification record."

Friction: four documents each define a piece of what a PR description must carry, and the template carries none of it, so each agent re-derives the shape from memory. A reviewer gathers the evidence from the build log, a results folder outside the repo, the private audit, and Soup.net.

Recipe `97fa42eb` (author andy@soup.net): "I want the verification steps written beside each comment rather than in a separate section". Recipe `5f1c2192` (author andy@soup.net) chose "an Executive Summary section at the top of the PR template" for a peer team's verbose agent PRs.

Better way:

- Plain tooling first. Add to the template: a short summary; **Verified by Claude Code Agent** and **Verified Manually Myself**; a "Briefing copy" line naming declared scenarios, or N/A; and an "Evidence" list linking the verification record commit, the results path, and the recipe ids. This is a template edit.
- Soup.net's part: the plan's convention "`-- https://github.com/o/r/pull/123, path:lines`" (plan §6, "Link a recipe to its PR") also applies to verification outcomes and rulings. `search_recipes "pull/123" author:anyone` then gathers every judgment made about the PR, and `pr-review-assist` reads them.

Payoff: high. Every PR, every reviewer. Smallest change.

### 2. Deferred Layer 4 checks go to a "handoff list" that has no home

Quotes:

- `docs/planning/drafts-and-triage-build.md`, Slice 1 verification record: "The verifier did not run the Layer 4 browser check, so it stays on the operator's handoff list."
- The same file, Slice 3: "Browser (Layer 4) items from slices 1 to 3 stay on the operator's handoff list."
- `docs/testing-plan.md` (main), Layer 4: "When an agent modifies HTML routes, CSS, or frontend components, it provides the human with a verification checklist. The agent cannot see the browser — the human confirms."
- `docs/testing-plan.md` (main), Layer 3b: "Layer 4 stays the person's own look. This layer gives them the evidence and the steps to repeat."

Friction: the operator must remember a list that exists only in chat, and it grows each slice. "The agent cannot see the browser" is stale since Layer 3b. The Layer 4 URL table is static (for example "Page loads. All sections render (How this works, Examples, Tips).") and describes pages rather than the change under review.

Better way:

- Plain tooling. Each deferred check goes under the PR's **Verified Manually Myself** heading (hairball 1), so the list lives with the PR it belongs to and closes when the operator ticks it.
- Correct the stale Layer 4 sentence: agents now drive a browser through Layer 3b.
- Replace the static table with "the PR's Verified Manually Myself items" (hairball 3 splits out what remains).

Payoff: high. It removes a list the operator must hold in his head. Soup.net is not the tool here: a manual page check is a task, and the operator's own words were "I find Claude to be a poor task list" (recipe `103e6242`). The drafts queue is for taste and judgment, not a to-do list.

### 3. Layer 4 mixes mechanical checks with alignment questions

Quotes:

- `CLAUDE.md`, Pre-Commit Workflow: "check `docs/testing-plan.md` Layer 4 for manual browser verification — tell the human what URLs to check and what to look for."
- Recipe `03a11c5e` (author andy@soup.net), quoting the operator: "What would you like my eyes on to make sure we're aligned on what success looks like, not just are we successful based on your assumptions. It's a great spot for a demo."

Friction: "what URLs to check" invites a page-loads checklist, which Layer 3b now covers with screenshots. The part only the operator can give (is this what success looks like?) is a taste-and-judgment question that gets lost among the mechanical checks.

Better way:

- Split the two jobs. Mechanical checks go to `browser-verify`.
- Each alignment question ("the empty state says X; is that the promise we want?") becomes a draft about the operator, carrying the screenshot as evidence, answered in his own agent through `my-drafts` or in `/app/drafts`.
- Once verified, the answer is a recipe the next UI change retrieves, not a chat message.

Payoff: medium-high, after drafts deploy. It fits the plan's `my-drafts` helper with no new Soup.net work, and `check_recipe` already takes an image `file_url`.

### 4. Orchestrator escalations and verdicts are buried in a long build log

Quotes:

- `docs/planning/drafts-and-triage-build.md`, How the work is run: "**Record.** Rubric outcome, evidence, deviations, and follow-ups land here; the slice's decisions are recipe-checked with feedback closing the loop."
- The same file, Orchestrator rulings: "No question is escalated to the operator at this point. Anything that turns out to need him during a slice is raised then, with the evidence."
- The same file, Slice 2 verification record: "**Verdict: accepted with follow-ups.** Nothing fails." This sits below a cast paragraph, above a table of criteria and a table of read paths.
- The same file, Slice 2 rulings: "both option recipes landed in the production corpus as ordinary recipes, because the production server doesn't have the `draft` parameter yet." And: "Once drafts ship, the options can be drafts instead, which keeps the losing option out of everyone's results."

Friction: the rubric-first and separate-verifier process is sound (hairball 10). The cost is on the reading side. The operator finds what needs him by reading rulings, build notes and verification tables. The decisions are already recipe-checked, so the log and the corpus say the same thing twice.

Better way:

- Once drafts deploy, each escalation is a draft about the operator, rated for impact and uncertainty. It reaches him through the briefing's Drafts line or `/app/drafts`, and his answer verifies it with his own words.
- Build-both options become drafts, as the log itself proposes.
- The log keeps one verdict line per slice at the top of each record, plus recipe ids, and drops prose that restates a recipe.

Payoff: high for the operator. It is also the cheapest end-to-end tracer for the plan's phase 2: one person, real questions, no new code. Escalated as a proposal (see Soup.net use): it changes how he receives rulings.

### 5. The "before committing" sweep is a step each agent must remember

Quotes:

- `CLAUDE.md`, Recipe Checks, When to check: "**Before committing** — sweep for what the session missed. The corpus often surfaces related prior decisions (ADRs describing the old behavior, security audit findings now stale, dead code from a refactor) that the session itself didn't flag."
- `CLAUDE.md`, Security: "**Check recipes on Soup.net** before making security-related decisions".

Friction: nothing triggers the sweep, and nothing records that it ran. It is the same retrieval as plan §4.1 step 4 (extract each decision, `search_recipes` it once unbounded and once bounded to the dates of the work).

Better way: `pr-review-assist` pointed at one's own branch before the push is the pre-commit sweep. The branch + draft-PR hand-back could name it once ("run `pr-review-assist` on this branch"), which takes it off the remembered list. The PR's Evidence section (hairball 1) would carry its search ids.

Payoff: medium. Soup.net plus the helper solve it directly, with no new Soup.net work.

### 6. The same rules are restated in every sub-agent brief

Quotes:

- `CLAUDE.md`, Recipe Checks: "include recipe-check instructions in their prompts — which recipe book is in scope, the when-to-check moments above, and the voice rules (or tell them to call `get_briefing`)."
- This track's own brief restated the Soup.net rules and the writing rules, then added "Nested sub-agents get these same rules."
- `docs/briefing-specs/README.md`, Files: "`subagent-purpose-briefing.feature` | `@unreleased` — `purpose`-scoped `get_briefing` for sub-agents".

Friction: every orchestrator copies a paragraph of rules into each brief, the copies drift, and a nested agent gets a copy of a copy.

Better way: split by kind of rule.

- The Soup.net rules already have one home: `get_briefing`, and slice 7 moves when-to-draft into it. A brief can shrink to "call `get_briefing` with purpose; book soupnet-oss; agent_id X".
- The writing rules (no hard wraps, verbatim quotes with sources, "taste and judgment" paired) live in the operator's private memory and in briefs, not in the repo. A short repo writing-rules page linked from CLAUDE.md gives them one public home. That is plain docs, not Soup.net.

Payoff: medium. It cuts brief length for every fleet, including the helpers' own nested agents.

### 7. The briefing-copy regression rule depends on memory, and its harness has never run

Quotes:

- `docs/briefing-specs/README.md`, The regression rule (once wired): "re-run the suite, and show every undeclared scenario still holding."
- `docs/briefing-specs/spec-decision-log.md`, repeated in each recent entry: "Suite re-run: harness not yet wired; the .feature files remain the manual checklist." Six entries carry this line.
- No script in `scripts/`, `.github/` or `package.json` references `spec-decision-log`.

Friction: the declaration step depends on the agent remembering. The re-run step has never happened, and each entry says so.

Better way: plain tooling. A `check:` script beside `check:data-model` fails when a diff touches the named briefing files without a new log entry. It closes the declaration half without the eval harness. Soup.net adds nothing here.

Payoff: medium. It matters because every drafts slice touches briefing copy.

### 8. CLAUDE.md contradicts itself on when to commit

Quotes, both from `CLAUDE.md`, Pre-Commit Workflow:

- "Commit only after gates pass and human confirms."
- "build features on a branch — worktrees for parallel sessions — and commit logical units as gates pass."

Friction: an agent following the first waits for the human before every commit on a feature branch. The draft-PR flow, and the operator's commit-batching preference, say otherwise.

Better way: a one-line correction. Scope "human confirms" to merges and pushes, which the draft-PR flow already gates. By CLAUDE.md's own rule this is an autonomous correction. It is not made here, because this track may edit only its report.

Payoff: low effort, and it removes a recurring stall.

### 9. The CI environment is mirrored by hand, and security.md has stale rows

Quotes:

- `CLAUDE.md`, Pre-Commit Workflow: "**The two files must stay in sync.** They're maintained separately".
- `docs/workflows/security.md`, File Locations: "| Security regression tests | `tests/security/` (to be created) |". `tests/` holds `e2e` and `search-quality` only.
- `docs/workflows/security.md`, Recipes Checked: "1. **Separate audit and implementation agents** — prevents self-validation bias". The six items carry no recipe ids.

Friction: a manual sync rule already failed once (CLAUDE.md records the `FRONTEND_URL` miss). Stale rows mislead the security agents the doc directs.

Better way:

- Plain tooling: `test-ci-local.mjs` reads the env block from `ci.yml`, or a check compares the two.
- Security.md: replace the Recipes Checked prose with recipe ids, which `get_recipes` resolves in one call. This is Soup.net's lookup, used as intended. Mark `tests/security/` as not yet created, or drop the row.

Payoff: low for PR review, cheap to fix.

### 10. Fine as is

- **The push step.** `CLAUDE.md`: "finish by handing back the exact `git push -u origin <branch>` command, and once the operator has pushed, open a draft PR (`gh pr create --draft`) for their review." This handoff is deliberate: "The push to the shared remote is the operator's personal checkpoint". The only saving is for the agent to have the PR body ready as a file, so the PR opens in one command after the push.
- **Separate audit, implementation and verification roles.** `docs/workflows/security.md`: 'Never mark your own fix as "verified" — the audit agent does that on re-scan'. Also `drafts-and-triage-build.md`: "Other agents do research, specs, and verification, and never the implementation they verify." This is the independence the operator asks of automated review (recipe `0960a183`: "observable, understandable and verifiable"). Keep it. Hairballs 1 and 4 fix how its output is read, not the roles.
- **The rubric written before implementation.** It gives the verifier a contract. Recipe `d03bdd24` (author andy@soup.net): "every implied surface enumerated ... so that 'done' is verifiable against the plan rather than remembered."

## Suggested sequence

1. Template edit and the CLAUDE.md commit-line correction (hairballs 1 and 8). Plain edits, usable now.
2. Move deferred Layer 4 items into PR descriptions, and correct the stale Layer 4 text (hairball 2).
3. The `spec-decision-log` guard, and the security.md cleanup (hairballs 7 and 9).
4. When `pr-review-assist` ships (plan phase 1): name it as the pre-commit sweep (hairball 5), and shrink briefs to a `get_briefing` pointer plus a repo writing-rules page (hairball 6).
5. When drafts deploy (plan phase 2): orchestrator escalations and alignment questions become drafts about the operator (hairballs 3 and 4). This is the first real `my-drafts` tracer.

## Soup.net use

- Briefing intent: `int_ETh2WESWvB78VY5dZRDA3awc`, agent_id `a-pr-review-research-hairballs-2026-09-27`.
- Search `ecfca0a4-9923-45a1-8547-7604cda69ef2` (PR review handoff, verification evidence, rubric burden). It surfaced `97fa42eb` (verification beside each comment), `0960a183` (observable and verifiable automation), `842703c5` and `3fe6f013` (browser verification practice), and `e7c16ef0` and `103e6242` (plan decisions). These shaped hairballs 1, 3 and 10.
- Search `335b3428-1b9f-41af-ac27-ccdd6c2c70b7` (manual checklist, what URLs to check). It surfaced `03a11c5e`, whose alignment quote is the basis for splitting Layer 4 (hairball 3), and `d03bdd24` (checklists for cross-checking).
- Search `7ed71f55-84a1-4bd9-99f5-e4d55acd1028` (long rubrics, reviewer burden). No recipe about the operator reading long build logs. It surfaced `5f1c2192` and `216e0341` (PR summary for skimming readers), which informed hairball 1. A null result on the specific question.
- `get_recipes` on `5f1c2192`, `216e0341`, `842703c5`, `3fe6f013`, `061a7926`, `eb4b77eb`, `103e6242`.
- Recipe checks: none. Every finding is a documentation reading.
- Escalated rather than checked: hairball 4, routing orchestrator escalations to the operator as drafts instead of build-log prose. It changes how he receives rulings, and no recipe records his view on it.
- Feedback rows logged for all three searches.
