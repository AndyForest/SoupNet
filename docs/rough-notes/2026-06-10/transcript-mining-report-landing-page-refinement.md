# Transcript-mining report — session "landing-page-refinement" (2026-06-10)

> Self-audit per the transcript-mining briefing. Session scope: `decided_at` feature, design-thinking expansions (decision archaeology, agent fleets, reasoning-trace gap), landing-page challenge section + composition pass + CTA workshop, rough-notes system, 36 recipe checks. Self-audit bias acknowledged; a fresh session can re-run this against the transcript on disk for a stronger pass.

## Finding: auth failure created hours of silent check debt
- **Type:** briefing-friction (and the session's biggest miss)
- **Situation (scrubbed):** The prod API key had expired before the session. `get_briefing` returned `Error: Invalid or expired API key.` The agent reported the blocker once in a long summary, then did two full work phases (schema feature, major doc sections) making dozens of judgment calls with zero checks. The operator noticed the empty check log and called it out before the agent escalated again.
- **What a check would have needed to return:** n/a — the channel was down. The failure is everything around that: the error string offers no remediation, and the agent treated "blocked" as "exempt" instead of maintaining an explicit check-debt ledger.
- **Suggested improvement:** (1) System: the invalid-key error should carry remediation — "mint a new key at /app/keys and update your client config" — errors are agent-facing copy too. (2) Briefing/KB entry: a check-blocked protocol — surface the blocker as the headline (not a buried bullet), keep a running ledger of uncheckable judgment calls, backfill the moment the channel returns. (3) Candidate Gherkin scenario: *Given a briefed agent whose key is rejected, When it continues working, Then it surfaces the blocker prominently and maintains a check ledger for backfill.*

## Finding: batched backfill confirmed the corpus's own anti-batching recipe
- **Type:** timing → success (after correction)
- **Situation (scrubbed):** Once the operator supplied a fresh key, the agent backfilled six checks in one sweep. Two of those checks retrieved the operator's 2026-04-26 recipe: checks belong at the judgment moment because "context degrades when many decisions are batched into one retrospective sweep" — a direct indictment of the sweep being performed. The agent surfaced the self-indictment honestly and switched to at-the-moment checking for the rest of the session (verifiable in the check log's timing).
- **What the check returned:** exactly the right recipe (`0a70f315`), retrieved twice from differently-worded queries. Retrieval success on the system's most important behavioral rule.
- **Suggested improvement:** candidate scenario for the specs — the failure side already happened in the wild; this transcript is the annotated conversation the reasoning-window scenario was missing.

## Finding: components checked, synthesis unchecked — the "evening away" recommendation
- **Type:** unchecked-judgment (granularity)
- **Situation (scrubbed):** For the challenge illustration, the agent checked the ingredient decisions (tone, motif grammar, character consistency) and then recommended a composition whose load-bearing premise — the human absent while the agent works in wall-clock time — was never itself checked. The operator rejected it: autonomy benchmarks measure human-equivalent time, agents compress wall-clock, the premise dates fast. The agent had verified the benchmark's methodology earlier the same day and still missed the implication.
- **What a check would have needed to return:** nothing existed — corpus gap, now filled (`ed6f17f3`, framings must survive wall-clock compression). But the deeper miss is procedural: a check on the *recommendation* (not just its components) would at least have logged the premise where the operator could contest it pre-art.
- **Suggested improvement:** briefing/KB candidate: when a judgment call is a synthesis of already-checked components, the synthesis is a new judgment call — check the conclusion, not only the ingredients.

## Finding: a wrong warrant was checked into the corpus as fact
- **Type:** voice (calibration failure)
- **Situation (scrubbed):** The agent checked a recipe asserting the old robot illustration was "retired" for visual-language drift. The operator later corrected: the robot was intentional symbolism (an agent without the product, deliberately cold); the drift comment referred to a different character. The agent had inferred a history and asserted it with evidence that didn't actually support that clause — the same day it wrote the archaeology rule "a reconstructed warrant is a hypothesis about intent, and overclaiming poisons the corpus."
- **What happened next:** correction recipe logged (`59d47046`); the wrong recipe (`2e7ee32c`) remains as context with the newer one outranking on freshness — the correction workflow held.
- **Suggested improvement:** retrieval hypothesis is unnecessary; the fix is authoring discipline. Candidate spec scenario: *Then interpretation lines distinguish "the operator said X" from "I infer X," and inferred warrants are marked as inferred.* Also evidence that recipe-level review (does each quote actually support the clause it warrants?) belongs in the Track-1 judge rubric.

## Finding: design-doc insights aren't recipes, so checks can't retrieve them
- **Type:** corpus-gap (structural)
- **Situation (scrubbed):** The agent shipped a stylized check-log mock as the challenge section's visual. The operator rejected it as "for agents, not humans; too technical, scary." That exact lesson existed in the repo — a logged user quote that raw JSON is "technical and scary looking for non technical people," plus a backlog item on JSON alienating even technical users — but as documentation prose, not as recipes. A pre-decision check could not have surfaced it.
- **What a check would have needed to return:** a recipe like "As a product owner choosing visuals for non-technical visitors, I prefer warm illustration over technical artifacts (logs, JSON, dashboards) because raw system output reads as scary."
- **Suggested improvement:** run decision archaeology on the project's own design docs — design-thinking.md and the backlog are full of dated, evidenced judgments that predate the corpus; `decided_at` now exists precisely for this backfill.

## Finding: same-day supersession chains in the corpus
- **Type:** retrieval hypothesis
- **Situation (scrubbed):** The CTA workshop produced four recipes in one afternoon, each refining the previous (compounding framing → two-sentence driver's seat → three-beat hook). All carry the same date; freshness can't rank them. A future agent retrieving this cluster gets the full chain with no signal for which framing survived.
- **What a check would have needed to return:** for iteration chains, ideally the end-state with the chain as history.
- **Suggested improvement:** Track-2 measurement candidate: how do intra-day iteration chains cluster, and does the exemplar-selection pick the last word or a middle draft? Possible authoring guidance: later recipes in a chain should name what they supersede in their evidence (the corrections in this session did this; the refinements mostly didn't).

## Finding: web /check parity rescued checking when MCP couldn't reconnect
- **Type:** success
- **Situation (scrubbed):** The fresh key couldn't reach the MCP connection without a session restart, so all 36 checks ran as direct `POST /check?format=json` calls with `max_chars` budgeting. Full functionality, zero friction — three-surface parity (engineering principle #7) proved itself in exactly the degraded-path situation it was designed for.
- **Suggested improvement:** none needed; worth a teaching scenario for Agent Type C (API-integrated), which currently has no annotated conversation.

## Finding: first sub-agents launched without recipe-check briefing
- **Type:** unchecked-judgment (minor)
- **Situation (scrubbed):** Two discovery sub-agents ran before the fleet rule existed (and while the key was dead); a later fact-finding sub-agent was told "pure fact-finding, no judgment calls to check." That distinction — fact-finding forks exempt from checking — is itself a judgment call that was never checked.
- **Suggested improvement:** small KB/briefing clarification: sub-agents that only gather facts don't check; sub-agents that choose between alternatives do. (Probably correct; should be stated somewhere agents will find rather than re-derived per session.)

## Finding: "flake" declared without identifying the failing test
- **Type:** unchecked-judgment (process risk)
- **Situation (scrubbed):** The canonical gate failed once with a truncated log (a `tail` pipe ate the failure detail and masked the exit code), then passed clean on identical code. The agent declared it a flake and committed. A skeptical second agent would note: an unidentified intermittent failure is now in the codebase's history with no issue tracking it.
- **Suggested improvement:** repo practice candidate: gate runs should always capture full logs to a file (the second run did); an unexplained intermittent failure gets a backlog note with the log path even when the re-run is green.

## Finding: role-term concentration in one session's checks
- **Type:** wording
- **Situation (scrubbed):** Of the session's 36 checks, roughly a third used "As a product owner…" — the operator independently questioned that term's ambiguity mid-session (it seeded Track-2 hypothesis 1). The session also produced near-duplicate role stems ("maintainer of an embedding-retrieved corpus" vs "maintainer of authoring guidance for an embedding-retrieved corpus") whose clustering behavior is unknown.
- **Suggested improvement:** this session's checks are themselves a ready-made Track-2 matched-pair set: real recipes, same author, same day, varied roles over related claims. Use them as the first measurement corpus.
