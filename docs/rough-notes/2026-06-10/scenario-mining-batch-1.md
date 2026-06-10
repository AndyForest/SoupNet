# Scenario Mining — Batch 1 (soupnet-oss + repo artifacts)

> **Status:** Rough note (2026-06-10). Phase 2 of [briefing-regression-testing.md](briefing-regression-testing.md) §"Source material — expanding the scenario corpus". Seven candidates mined for extending the public [recipe-scenarios](../../../apps/backend/public/docs/recipe-scenarios.md) page (Scenarios A–F), plus the first operator-interview batch. Nothing here is final scenario copy — every candidate waits on the interview answers for its ground-truth annotation.
>
> **Scrubbing note:** substitution, not deletion, throughout. Partner/company names → functional descriptions; the operator → functional roles in recipe text. All recipe text quoted here comes from the public repo or the public `soupnet-oss` recipe book; nothing from other recipe books appears below.
>
> **Method limitation (prominent, per plan):** the spec'd read-only mining path — `/check?filter=...` without recipe text — **does not exist in the code**. Mining fell back to the briefing exemplar surface + repo artifacts. Full detail in §Method note; the missing param is itself Candidate 3.

---

## Candidates

### C1 — A check that paid off ten weeks later: the test-data-isolation recipe

**Situation (scrubbed: none needed).** On 2026-04-01, while iterating on the ranking algorithm, a session logged the judgment that experiments must not pollute the production corpus with test data. Ten weeks later (2026-06-10), a planning session designing Track 2 of the briefing-regression system (matched-pair embedding measurements) cited that prior recipe directly when scoping where synthetic recipe variants may live:

> "Synthetic variants live in the isolated CI stack (`docker-compose.ci.yml`) or a dedicated throwaway recipe book — never the production corpus (prior recipe, 2026-04-01: iterate on ranking without polluting the database with test data)."
> — docs/rough-notes/2026-06-10/briefing-regression-testing.md §Track 2 Method

**Recipe text involved.** The 2026-04-01 recipe's verbatim text was not retrievable through the fallback read path — the paraphrase above is from the citing document. *Interview item: confirm the original wording.*

**Coverage cells filled.** Reuse-value success (a check that demonstrably helped a later session — the matrix's strongest missing success shape); solo user; MCP-connected agent; software domain; "after completing meaningful work" checking moment.

**Success-side scenario would illustrate:** logging a constraint at the moment it's decided makes it retrievable in a *different design context* months later — the recipe was about ranking iteration, the payoff was in eval-suite design. The transfer is exactly what transferable roles + explicit "so that" clauses buy.

**Failure-side scenario would illustrate:** the counterfactual — a session that never logged it. The 2026-06-10 planner re-derives the constraint from scratch (cost: thoroughness-dependent luck), or worse, doesn't: synthetic recipes land in the production corpus, which is precisely the dark-mode-test-data pollution Scenario A documents from the user side.

**Draft annotation (pending interview).** "The principle: completed-work checks compound. The session that logged this got nothing back for it that day — the corpus paid the value forward to a session ten weeks later working on something the original author couldn't have predicted."

### C2 — Divergent checks discovered in the wild (ChatGPT, 2026-04-03)

**Situation (scrubbed: none needed — already public in design-thinking.md).** A read-only web agent (ChatGPT) helping with the product's design direction generated five divergent clickable recipe-check links instead of committing to one thin guess — each a fully-evidenced framing of the operator's taste (brand feel, visual language, content strategy, audience framing). The operator wanted to click *all* of them — revealing the hypotheses were complementary (select-many), not competing (select-one). The agent also could not discover the target recipe-book slug, being read-only — which directly motivated adding the recipe-books list to the check page.

> "I like this so much because it keeps me in the driver's seat making the actual taste and judgement calls."
> — operator, 2026-04-03 (quoted in design-thinking.md §Divergent Recipe Checks)

**Recipe text involved** (the brand-feel hypothesis, quoted in design-thinking.md):

> "As a founder shaping Soup.net's brand, I want the design to feel welcoming, warm, playful, and thorough so that it feels like wise family guidance rather than cold enterprise software"

**Coverage cells filled.** Web-browsing link-emitter agent (only Scenario F covers it today, and success-only); select-many vs select-one mode distinction (documented but never scenario-ized); the failure twin fills a matrix-named empty cell: **pre-checking divergent candidates before the user chooses**.

**Success-side scenario would illustrate:** the full discovered interaction — thin evidence → divergent links with full recipe text alongside each → human clicks → choice becomes evidence ("the user was presented with N framings and chose this one").

**Failure-side scenario would illustrate:** the agent checks all five candidates itself before presenting them, logging four recipes nobody believes — the briefing's "checking candidates before the user picks writes that sentence while it's still false" rule, shown as a transcript. Secondary failure: five near-simultaneous clicks in select-many mode shading into over-checking noise — needs the interview to establish whether that actually degraded anything.

**Repo finding:** design-thinking.md §Case study links `docs/case-studies/chatgpt-divergent-design-checks.md`, which **does not exist** in the repo. Either lost or never landed — the full annotated transcript would be the best source material in this entire batch if it exists anywhere.

**Draft annotation (pending interview).** "The principle: when evidence is thin, divergence is honesty. The agent does the hypothesis-forming work; the human's click is the only write."

### C3 — The documented-but-missing `filter` read path (gap candidate, found during this mining)

**Situation.** Three agent-facing/agent-read surfaces tell agents a keyword-narrowing `filter` param exists on `/check`:

- CLAUDE.md §Recipe Checks: "use the web endpoint's `filter` (alias `f`) query param for keyword narrowing rather than fabricating a recipe"
- The MCP check response's own `actions` block (apps/backend/src/routes/mcp.ts:793): `"Add filter=keyword to narrow results."`
- design-thinking.md Agent Archetypes: `filter` listed among parameters for all three agent types

But the drift-proof param table the `/check` route reads (`CHECK_PARAMS`, apps/backend/src/routes/check.ts:77–93) has **no filter row**, and `submitAndSearch` only runs when full recipe + evidence + key are present. A filter-only GET renders the blank form; a check with `&filter=` silently ignores it. (The param *does* exist on the briefing endpoints — `GET /briefing` and `GET /keys/briefing` — for exemplar narrowing.)

**Recipe text involved.** None — that's the point: this is a judgment call (was `/check` filter descoped? never implemented? moved to `/briefing`?) visible in repo history and docs, never checked as a recipe. This session checked the meta-judgment as `#4463e19e-03f6-40c5-b24b-d11efdd1dc4f`.

**Coverage cells filled.** Interaction-level failure: **handling stale guidance** (the matrix's stale-recipe-correction cell, here as stale-doc); API-integrated agent (light — a curl-shaped agent is who'd hit the silent-ignore first); over-checking pressure (the failure path ends in the cardinal anti-pattern).

**Success-side scenario would illustrate:** an agent that wants to browse, finds the documented path missing, and *doesn't improvise* — it uses the briefing's filter param or asks the user, and reports the doc drift. (This session's own trajectory is the prototype.)

**Failure-side scenario would illustrate:** two distinct failure shapes. (a) The agent passes `filter=` to `/check`, gets unfiltered results, and reasons over them as if narrowed — silent wrongness. (b) Under search pressure with the safe valve missing, the agent fabricates a discovery-shaped recipe it doesn't believe — the exact anti-pattern the documented valve was supposed to prevent. A missing escape valve doesn't remove the pressure; it redirects it at the corpus.

**Draft annotation (pending operator decision on the param's intended fate).** "The principle: the no-fabrication rule is only as strong as its sanctioned alternative. When docs promise agents a read path, the path existing is a corpus-integrity feature, not a convenience."

### C4 — Mid-session key rotation: interface fluidity (operator-named candidate)

**Situation (from the plan doc; operator-flagged 2026-06-10 as the real case to use).** Mid-session, the daily API key rotates and the MCP connection's auth goes stale. Instead of making the user restart the session, the agent switches surfaces: same conceptual operation, now via `GET /check?format=json` with the fresh key. The session continues without the user noticing the seam.

**Recipe text involved.** None logged at the time (interview item: did any check capture this?). The judgment to illustrate is the plan doc's phrasing: *interface fluidity* — "the agent doesn't care which surface it's on, and shouldn't." MCP and `/check?format=json` are the same conceptual surface; the API-integrated archetype is "MCP's fallback twin... a problem-solver / rosetta stone."

**Coverage cells filled.** **API-integrated agent** — a matrix-named empty cell, with the operator's explicit instruction that it stay *super light* (one short scenario; not a distinct workflow).

**Success-side scenario would illustrate:** the seamless switch — agent notices 401, re-reads the briefing's URL shape, continues via HTTP, mentions it to the user in one line.

**Failure-side scenario would illustrate:** the agent declares the tool broken and halts ("your MCP server is down, please reconnect and restart the session") — burning the session's accumulated context because it equated *one transport* with *the system*.

**Draft annotation (pending interview).** "The principle: agents should treat Soup.net as a capability, not a connection. Every surface accepts the same recipe; losing one surface loses nothing."

### C5 — Malformed evidence in the wild: `(no interpretation)` and orphaned citations

**Situation (scrubbed: none needed — all from repo artifacts).** Real recipe-checking LLM sessions produced two recurring evidence malformations, both visible in repo history:

1. Some LLM authors **literally emit the placeholder text `(no interpretation)`** when they have a quote but no synthesized commentary — it leaked from an internal rendering convention into agent-authored submissions (fixed render-side 2026-05-13: quote-less references now render as a bare `-- source` line).
2. **Blank-line fragmentation:** an author writes interpretation, blank line, `> quote` / `-- source` — and the parser split them into an interpretation-only entry plus a standalone citation-only entry. Real affected trace cited in backlog.md: `a2c8fb64-d0bd-4d65-9248-4a4a8c727650`. Fixed 2026-05-31 (fold orphaned citation blocks into the preceding entry; commit `62d97e9`), with a still-open edge: one interpretation followed by *two* quote blocks only folds the first.

The placeholder is still observable in live check results today — one of this session's checks returned a related-evidence entry whose interpretation reads literally `(no interpretation)`.

**Recipe text involved.** The malformations are evidence-layer, recipe-agnostic — the scenario can use any recipe; what matters is the evidence block shape.

**Coverage cells filled.** Evidence failure modes at the *interaction* level (`evidence_no_quote`'s inverse — quote without interpretation — which the taxonomy doesn't name yet; candidate new failure-mode id: `quote_no_interpretation` or `fragmented_evidence`); web-browsing agent ("format adherence will be lower" is a named design consideration with no annotated example).

**Success-side scenario would illustrate:** the canonical evidence discipline — interpretation paragraph, then `> "quote"`, then `-- source`, blank lines *between entries* only.

**Failure-side scenario would illustrate:** what the system actually received: a placeholder masquerading as interpretation, and a quote orphaned from its interpretation by a blank line — plus what the tolerant parser does with each (fold, don't drop), so agents understand the degradation is graceful but the well-formed shape retrieves better.

**Draft annotation (pending interview).** "The principle: evidence formatting is retrieval infrastructure, not etiquette. The parser forgives, but a fragmented warrant embeds as fragments."

### C6 — Raw JSON copy-back alienates even technical humans (2026-05-27 demo)

**Situation (scrubbed: partner name → functional description).** At a live demo to four AI-first developers at a partner company (2026-05-27), and earlier from a non-technical user relaying through the operator, the same friction surfaced: the `/check` web page hands the *human* a raw JSON blob to carry back to their agent. The demo falsified a design assumption — JSON was believed friendly for developers and scary only for non-technical users:

> "JSON is alienating *even for technical users*. They felt friction at the 'copy this JSON blob' step."
> — docs/backlog.md §Recipe-check response format

Proposed fix in backlog (open): render results as fenced markdown — readable by the human in transit, attachment-like when pasted into a chat UI. The citation-link concept (design-thinking.md) is the eventual ideal for the non-technical case.

**Recipe text involved.** None logged from the demo feedback (interview item — this is a checkable falsified-assumption judgment with a clean date).

**Coverage cells filled.** **AI-reluctant collaborator** (matrix-named, near-empty — only implicit today via Marcus in Scenario E): this archetype is hurt most by the JSON failure mode, per design-thinking.md §Archetype 5. Also web-browsing copy-back loop (Scenario F shows the outbound half; nobody shows the return trip).

**Success-side scenario would illustrate:** the power-user → AI-reluctant-collaborator link flow end to end: scoped link sent over SMS, recipient's free-tier chatbot reads the result, recipient pastes back something comprehensible — never learning what Soup.net is.

**Failure-side scenario would illustrate:** the agent instructs a non-technical human to "copy the JSON below back to me" — the human stalls, truncates the blob, or abandons the loop. The failure isn't the agent's recipe; it's the *relay design* — an interaction-level failure class no current scenario touches.

**Draft annotation (pending interview).** "The principle: in copy-back workflows the human is part of the transport layer. Format for the least-technical hop, not for the agent."

### C7 — Decision archaeology with temporal honesty (`decided_at`, 2026-06-10)

**Situation (scrubbed: work-trial engagement kept functional, per existing public phrasing).** The driving need: a single-sprint work trial on an unfamiliar production codebase, where the first move is discovery agents sweeping code/docs/history and recipe-checking as they go — backfilling decisions found in git blame and ADRs with `decided_at` set to the artifact's timestamp. The feature landed 2026-06-10 with deliberate judgment calls: `created_at` stays insertion time (the record never claims to have been logged earlier than it was); future dates rejected (no freshness gaming); agent surfaces read `COALESCE(decided_at, created_at)` as the judgment date.

**Recipe text involved** (verbatim from the soupnet-oss book — surfaced as a SoupNet-book exemplar during this session's own checks, logged 2026-06-10):

> "As a developer onboarding AI agents into an unfamiliar production codebase, I prefer discovery agents that form hypotheses about core decisions and confirm them in git blame and commit history before recipe-checking them with original timestamps, so that reconstructed judgment enters the corpus evidenced and dated rather than inferred."

**Coverage cells filled.** Decision archaeology (matrix-named: "decision archaeology with a wrong or missing `decided_at`" is an explicitly empty failure cell); voice-for-reconstructed-decisions (role = the *original* decision-maker's functional role — a voice rule with no annotated example); adjacent fleet cell (discovery agents are a fleet; "a sub-agent that worked without checking is invisible").

**Success-side scenario would illustrate:** hypothesis → provenance → check: agent hypothesizes why the team chose its queue library, finds the commit, checks the recipe in the original engineer's functional voice with verbatim commit-message quote, hash/date citation, and `decided_at` = commit timestamp. Unconfirmed hypotheses are not checked.

**Failure-side scenario would illustrate:** the missing-`decided_at` twin — a 2024 decision backfilled without the timestamp masquerades as fresh 2026 judgment, outranking genuinely current taste in `sort=recent` and (future) temporal decay; or the wrong-voice twin: the recipe written in the *discovering agent's* voice ("As an AI agent sweeping the codebase, I found...") instead of the original decision-maker's.

**Draft annotation (pending interview).** "The principle: backfilled judgment carries two dates, and honesty about both is what lets freshness ranking stay meaningful. Old decisions are valuable *as old decisions*."

---

## Interview batch for the operator

Numbered for easy answering. Q-numbers are stable — answer inline, tersely; "skip" is a valid answer.

**C1 — test-data-isolation recipe (2026-04-01 → 2026-06-10)**
1. What's the verbatim recipe text from 2026-04-01? (The fallback read path couldn't retrieve it.)
2. In the 2026-06-10 planning session, did the recipe come back via an actual check, or did you/the agent remember it and cite it? (Decides whether C1's success-side scenario shows retrieval or recall — different teaching value.)
3. At the original moment, was the check made at the judgment moment or batched later? Would different wording have made it surface in *more* sessions than the one we know about?

**C2 — divergent ChatGPT checks (2026-04-03)**
4. Did you end up clicking all five links? Did five near-simultaneous checks produce any noise you later noticed in retrieval (near-duplicate cluster, crowding)?
5. The case-study file design-thinking.md links (`docs/case-studies/chatgpt-divergent-design-checks.md`) doesn't exist in the repo. Does the full transcript survive anywhere (ChatGPT history, notes)? It would be the single best scenario source in this batch.
6. What was your actual goal at that moment — design direction, or testing whether a web-only agent could use the system at all? (Changes the failure-side framing.)

**C3 — missing `/check` filter param**
7. Was `filter` on `/check` ever implemented and removed, or planned and never built? What's its intended fate — implement on `/check`, or repoint CLAUDE.md/mcp.ts at the `/briefing?filter=` endpoint that does exist?
8. The MCP response's `actions` text advertises the same missing param to every agent on every check. Has any session visibly fallen for it (passed filter, reasoned over unnarrowed results)?
9. Should the public scenario teach "verify the surface before relying on documented read paths," or is that too inside-baseball for the public page — better kept as a Track-1 feature-file scenario only?

**C4 — key rotation / interface fluidity**
10. In the real incident: did the agent switch surfaces on its own, or did you prompt it? Which client was it?
11. Did it have the `/check?format=json` URL shape in context already (briefing pasted earlier), or did it reconstruct/re-fetch it?
12. Was anything lost in the switch (write-book scoping, read-scope narrowing) that the scenario's failure side should show?

**C5 — malformed evidence shapes**
13. Which agent products produced the `(no interpretation)` and fragmented-evidence submissions? (Persona for the Given-clause.)
14. The tolerant-parser posture (fold, render bare `-- source`, never reject) — settled judgment, or would you want the warn/reject system to nudge authors toward the well-formed shape?
15. Should `recipe-examples.json` gain a new failure-mode id for quote-without-interpretation / fragmentation (it has the inverse, `evidence_no_quote`)?

**C6 — JSON copy-back demo feedback**
16. What did the four developers literally say/do at the copy-JSON step? Any verbatim line usable (scrubbed) as the scenario's quoted evidence?
17. For the earlier non-technical user: did the JSON step end the collaboration, or did they push through? What would have made it work — fenced markdown, or only the citation-link?
18. Is the falsified assumption ("JSON is developer-friendly") worth checking as a dated recipe of its own (`decided_at` 2026-05-27)?

**C7 — decision archaeology / `decided_at`**
19. Has the archaeology workflow run for real yet on the unfamiliar codebase? If so: one real (scrubbable) backfilled recipe with its commit citation would anchor the success-side scenario.
20. The temporal-honesty judgments (created_at stays, future dates rejected, COALESCE on agent surfaces) — were these checked as recipes when decided? If not, want them backfilled with `decided_at` = 2026-06-10?
21. For the failure side: which wrong-`decided_at` shape worries you more — missing (old decision reads fresh) or wrong-but-plausible (subtly misdated, undetectable)? The scenario should teach against the one you actually fear.

**Cross-cutting**
22. Wrong-book routing is a matrix-named failure cell with likely real instances (personal vs soupnet-oss vs the private book), but checking that requires reading books out of this batch's scope. Do you want a batch-2 sweep with a different scrubbing posture, or should wrong-book routing be synthetic?

---

## Coverage report

**Cells these candidates fill (against the matrix in briefing-regression-testing.md §Source material):**

| Cell | Candidate(s) | Side |
|---|---|---|
| Reuse-value success (check helped a later session) | C1 | success |
| Web-browsing link-emitter agent | C2, C5, C6 | both |
| Pre-checking divergent candidates (interaction failure) | C2 | failure |
| Stale-guidance handling (interaction failure) | C3 | both |
| API-integrated agent (kept light, per operator) | C4, C3 | both |
| Evidence-layer malformation at interaction level | C5 | failure |
| AI-reluctant collaborator (human archetype) | C6 | both (partial) |
| Decision archaeology + wrong/missing `decided_at` | C7 | both |
| Voice for reconstructed decisions | C7 | both |
| Fleet (sub-agent checking) | C7 | adjacent only |

**Cells still empty, and why:**

- **Self-hosted user** — no material exists in soupnet-oss or the repo; nobody self-hosts yet. Needs synthetic scenarios or a future self-hoster's contributed material. (design-thinking.md Archetype 3 gives the Given-clause.)
- **Non-software domains** (8 of 9 in `recipe-examples.json`) — structurally absent: soupnet-oss is a software project's book by construction, and the scrubbing rule excludes the operator's other books. Domain spread must come from synthetic scenarios (the route `recipe-examples.json` itself already took) or future users.
- **Reasoning-window timing** — the §Reasoning-Trace Gap commitment still has no annotated real conversation; nothing in the artifacts shows a check demonstrably made *inside* the window vs batched. The transcript-mining channel (transcript-mining-briefing.md) is the right source — it observes timing; book mining can't.
- **Over-checking noise** — no observed instance (C2's select-many is the nearest neighbor; interview Q4 probes it). Real corpora may simply not contain it yet; synthetic until it shows up.
- **Wrong-book routing** — real instances likely exist but live across book boundaries this batch's scope excludes. Interview Q22 decides the path.
- **First adopter** — appears in scenarios already (per the plan doc) and wasn't re-mined here; the existing Scenario E/F coverage stands.

---

## Method note — read path used and its limits

**What the plan specified:** verify `/check` supports a filter-only GET (search without logging), then mine via `curl /check?key=...&filter=<kw>&format=json` scoped with `read_recipe_books=soupnet-oss`.

**What verification found:** not supported. `CHECK_PARAMS` (apps/backend/src/routes/check.ts:77–93) defines every wire param the route reads — `filter`/`f` is not among them — and the search+log call (`submitAndSearch`) only fires when recipe text, evidence, and key are all present (check.ts:664). Filter-only requests render the blank form: no search, no trace, and no narrowing either. The read-scope param the plan asked about does exist: `read_recipe_books` (alias `read_groups`). The `filter` param exists only on the briefing surfaces (`GET /briefing` Bearer-auth, `GET /keys/briefing` JWT-auth) for exemplar narrowing.

**The fallback actually used (per the plan's no-improvisation rule):**
1. `get_briefing` + `list_my_recipe_books` (MCP) — corpus shape, books, exemplars. Limit: exemplar sample spans all readable books and can't be scoped to soupnet-oss via MCP; most exemplars came from out-of-scope books and were discarded under the scrubbing rule.
2. An attempt at the legitimate read-only parametrized twin (`GET /briefing?recipe_book=soupnet-oss&filter=...` with Bearer key — provably write-free) was blocked by shell-permission denial in this environment, so it was abandoned rather than worked around.
3. Repo-side artifacts — backlog.md / backlog-completed.md, design-thinking.md, docs/rough-notes/2026-06-10/, adr/, route sources, recent commit log. This supplied most candidate material, with exact dates.
4. Side-effect reads from this session's three genuine recipe checks (logged for real judgment calls made during this work, not as searches) — these surfaced two verbatim soupnet-oss recipes (C7's archaeology recipe; the coverage-matrix-expansion recipe) and live confirmation of C5's `(no interpretation)` artifact.

**Net limits:** verbatim recipe text from soupnet-oss is only available where repo docs quote it or where genuine checks happened to surface it; original wordings for C1 and any C4/C6 recipes need the interview (Q1, Q10, Q16). A proper batch-2 should use the `/briefing?recipe_book=soupnet-oss&filter=<kw>` path from an environment where it's callable — or `/check` should grow the documented filter param (C3 / interview Q7) and become the canonical mining surface.

**Checks made during this work (genuine judgment calls, soupnet-oss):**
- `f71d8262-f12a-4a83-8150-b20cd32b1a3d` — candidate-selection criterion: artifact-backed candidates over invented-but-plausible ones.
- `53c6dd63-0ab8-4251-998c-2812e319cc3b` — scrubbing boundary: partner name → functional description, observation kept.
- `4463e19e-03f6-40c5-b24b-d11efdd1dc4f` — documented read paths must be verified against implemented routes (the C3 meta-judgment).
