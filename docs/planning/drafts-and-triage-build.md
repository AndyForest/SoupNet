# Drafts and triage: build log

The working record for building [drafts-and-triage.md](drafts-and-triage.md). Each slice gets its acceptance rubric written here **before** implementation starts, and its verification record written here **after**, by a different agent from the one that built it. Decisions made along the way are logged as Soup.net recipes and linked from the slice they belong to.

Branch: `feat/drafts-and-triage`. Started 2026-09-27.

## Sequencing, and one assumption questioned

The operator asked for this work before returning to organization accounts. That holds, with one adjustment: the drafts visibility rule, the triage ratings, and the headless key setting all live in the authorization seam and the key-authentication primitive. The seam's remaining three branches (#96, #97, and the unpushed key-authentication slice) are security fixes already built and verified, not org work, so they land first and this branch is built on top of them. Stacking this feature on code that is about to change underneath it would mean building everything twice.

This branch is updated by merging (not rebasing) as those land, so it never needs a force-push.

## How the work is run

One implementation agent at a time, sequential slices. Other agents do research, specs, and verification, and never the implementation they verify.

For each slice:

1. **Rubric first.** Acceptance criteria are written here, specific enough that an independent agent can say pass or fail with evidence: behaviors with the test that proves each, surfaces that must change or must not, measurable budgets (statement counts, context bytes), and the security properties that must hold.
2. **Implement.** A development agent builds the slice test-first on this branch, runs the full gate (recording the exit code, not just the summary), and reports.
3. **Verify.** A separate agent checks the slice against its rubric on an isolated stack, tries to break it, and writes the verification record below. Security-relevant slices also get the read-only audit role from `docs/workflows/security.md`, with findings kept in the private repo.
4. **Record.** Rubric outcome, evidence, deviations, and follow-ups land here; the slice's decisions are recipe-checked with feedback closing the loop.

At a genuine design fork where nobody can settle the choice in advance and both options are cheap enough to try, the agent may use the "build both" pattern this feature is about: recipe-check both options, try both, log feedback on each with the measurement, then recipe-check the final decision. This build is the first trial of the pattern, so its use (or the reasons it wasn't used) is recorded here too.

## Slices

Planned order. Each one ships something usable and keeps the gate green.

1. **Triage ratings and a tool-description trim.** Optional `impact` and `uncertainty` on checks, stored and returned, never used by ranking. Remove deprecated parameters from tool schemas (still honored), replace repeated schemas with pointers, so the net context cost of the tool roster goes down.
2. **Drafts for the key's own user.** Store the draft state, exclude drafts from every normal read path in one place in the authorization module, show a person's own drafts to their own agents labelled as drafts, and verification by the person (reaction) or their agent (evidence-backed).
3. **Review queue.** The human search page gains a drafts filter and `impact:` / `uncertainty:` qualifiers, sorted for triage, with confirm, reject, and not-chosen actions and an id-list link form.
4. **Drafts on behalf of another person.** Limited to people with write access to the target book; the verified-org-domain case waits for organization accounts.
5. **Headless keys.** A key setting that forces every deposit to be a draft, inherited by derived keys, with its own briefing profile. Designed together with the capability ladder (full, drafts only, nothing).
6. **Option sets.** The recipe-to-intent link, linked drafts under one intent with a rubric set in advance, and resolution into verified and not chosen.
7. **Briefing copy.** The when-to-draft guidance, the "checkable by someone who wasn't there" phrase, and the headless profile, declared under the briefing regression-spec process.

Rubrics for each slice are written in the next section before that slice starts.

## Rubrics and verification records

(Filled in per slice.)
