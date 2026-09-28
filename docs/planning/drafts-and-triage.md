# Drafts, triage, and deciding by building both

Status: design direction from the operator, 2026-09-20 and 2026-09-27. Not built. Generalizes the "drafts on behalf of another person" ruling in [org-accounts-program.md](org-accounts-program.md) §4.4 into a feature for every agent, not only organization backfill. Where this doc and that section differ, this doc wins.

## Decisions

| Decision | Status | Recipe |
|---|---|---|
| "Draft" and "on behalf of" are two independent properties of a recipe check. A person's own agent may deposit a draft when a call is high in impact and uncertainty. | Lean, then ratified in the 2026-09-27 reply | [0e3cb40e](https://www.soup.net/traces/0e3cb40e-b25a-4b8a-8eed-386379979ef7) |
| Any agent may deposit a draft about another person; it is accessible only to that person and their agents, and to the depositor, until verified. | Decided (2026-09-19) | [94e0e682](https://www.soup.net/traces/94e0e682-0236-4683-9b21-5f52a164f534) |
| A person's own drafts stay hidden from collaborators until verified. Revisit later, since seeing what someone is considering has value. | Decided | [84e6bc9f](https://www.soup.net/traces/84e6bc9f-293e-4dc2-baa4-2c7c7f72fc53) |
| When nobody can decide yet and both options are worth building, the agent deposits both as linked drafts with the rubric set in advance, builds and measures both, publishes the winner, and marks the other not chosen. | Lean | [ea930c3d](https://www.soup.net/traces/ea930c3d-0daa-47a9-b798-2e845b36e4b5) |
| A "headless" setting on an API key, for agents expected to act unsupervised: every deposit is forced to be a draft, and the agent gets a briefing written for working alone. | Lean | [e263dc40](https://www.soup.net/traces/e263dc40-5ee2-4d07-a453-d527abf79569) |
| Impact and uncertainty are recorded as two separate optional ratings on every check, with sensible defaults. They can't be combined with each other or with draft: a fairly certain call can still be worth a draft. | Decided (2026-09-27) | this doc |
| The review surface works as a queue of things for the person to review, built on the human search page. | Decided | this doc |
| Drafts don't replace asking the human. An agent that could ask, asks. | Decided | this doc |

## The model

Two properties, independent of each other:

- **On behalf of**: whose taste and judgment the recipe claims to record. Default: the key's own user.
- **Draft**: whether the person it is about has confirmed it. Default: not a draft.

| | Asserted | Draft |
|---|---|---|
| **About the key's own user** | Today's normal check | A thin but important hypothesis, parked for review |
| **On behalf of someone else** | Not allowed | Backfill; the server forces draft |

Two server rules follow. "On behalf of" someone else always implies draft. A headless key always implies draft. Nothing else forces it.

One visibility rule covers every draft: until verified, it is visible only to the person it is about and their agents, and to the person whose agent deposited it. It appears on no normal surface (search results, check results, briefing, map, counts) except that a person's own agents see their own drafts, labelled as drafts, so the agent weighs them as unconfirmed. The label is a fact about the recipe, not the system making a judgment.

### Triage ratings

Two optional ratings on every check, not only on drafts, using the briefing's own words for when a check is worth making ("uncertainty × impact"):

- `impact`: how much rides on getting this right. `low | medium | high`.
- `uncertainty`: how unsure the agent is about the person's position. `low | medium | high`.

Omitted means not rated, and the review queue sorts an unrated draft as medium on both. Ratings shape display and triage only, never ranking. The reason, besides the standing "context shapes rendering, never ranking" rule: the corpus's own calibration audit found agents' self-reported usefulness textually honest but mostly an echo of their own earlier hypotheses (recipe `ff54eafd`), so self-ratings are useful for sorting a queue and unsafe as a relevance signal.

## When to draft, and when to ask instead

Drafting exists for moments when the human can't be asked, not to replace asking. The briefing guidance, in its usual enabling voice:

- If the person is reachable, ask, or present divergent options (the existing divergent-check pattern). A draft is the asynchronous form of the same move, for when they aren't reachable.
- A draft earns its place when a call is high enough in impact and uncertainty that an unconfirmed record would mislead, and the agent has to proceed anyway. Everything below that bar stays an ordinary check, which keeps checking frictionless (the "a check is a read with a side effect" framing, recipe `449f4a36`).
- Say why you couldn't ask, and what would settle it. This fits existing surfaces without a schema change:
  - **On the draft itself**, as the first evidence interpretation: why the person couldn't be asked now, and the question that would settle it. This is where the person reviewing the queue sees it, and where a supervised agent with more context can see which drafts it might answer.
  - **On the declared intent**, when a whole task runs unattended: the story can say so ("…while my human is away until Monday, I want my agent to proceed on drafts for the calls it can't settle…"). Every draft deposited under that intent inherits the context.
  - **In feedback**, at the end of the session: one `outcome` row whose note lists the draft ids waiting for review, with disposition `deferred`. The existing feedback join then shows the human, on each check's detail page, what was left open.
- This extends the operator's standing preference that an autonomous agent should proceed but not proceed silently (recipe `5e59f9d3`).

## Verifying a draft

- **The person** verifies with one action in the review queue. Existing human reactions already carry the vocabulary: `still_true` confirms, `wrong` rejects. The draft queue reuses them rather than adding a second set of buttons.
- **An agent acting under the person's control** verifies with evidence, the same way every recipe is evidenced: the person's answer, quoted and cited, so anyone could check the verification independently. The typical flow is an agent that asks its human in conversation, gets an answer, and verifies the draft citing that answer. This keeps a depositing agent from verifying its own draft a moment later without anything new.
- **Links**: the trace detail page already exists and the briefing already teaches agents to link to it (the "Annotating creative output" section). A draft-review queue URL that accepts ids (`/app/drafts?ids=…`) lets an agent hand its human exactly the drafts it wants reviewed, as one link, with no API change.
- **Storage**: verification is a state on the recipe (a nullable timestamp in the house style, plus who verified). The human path writes it through the reaction; the agent path writes it through one new agent-callable operation. That operation is the only new agent surface this feature needs beyond the check parameters.

## Deciding by building both

When neither the person nor the agent has enough information, and building both options is worth the effort, the decision itself can be deferred until measurement settles it. Example: two candidate architectures, built side by side and measured.

1. The agent declares an intent whose story names the choice and the rubric in advance ("…I want my agent to build both caching strategies and keep the one with lower p95 latency at equal cost, so that…"). Setting the rubric before measuring is what makes the result trustworthy: it can't be adjusted to fit whichever option the agent already liked.
2. It deposits each option as a draft under that intent, with `impact` and `uncertainty` rated and the rubric restated in the evidence.
3. It builds and measures both.
4. It resolves the set: the option that meets the rubric is verified and its evidence cites the measurement; the other is marked **not chosen**. "Not chosen" is deliberately not `wrong`: it records that the option was viable and lost on the rubric, which is valuable history for the next agent facing the same choice.

Who may resolve: if the rubric came from the person (quoted in the intent or in a draft's evidence), applying it is carrying out their decision, so their agent may resolve the set and cite both the rubric and the measurement. If the rubric is the agent's own, the set stays in the person's queue with the measurements attached, ranked for them.

Linking the options needs the recipe-to-intent link already planned in [../architecture/agent-context-seams.md](../architecture/agent-context-seams.md) (gap 2). The intent is the set; no new "option set" concept is needed.

A not-chosen draft stays hidden like any other draft for now, reachable through the winner's evidence.

## Headless keys

A setting chosen when the API key is made, for agents the person expects to run unsupervised.

- Every deposit through a headless key is forced to be a draft, server-side. The agent can't opt out; a derived key made from a headless key is headless too (derived keys only ever narrow).
- The briefing gets a headless profile: how to draft well, how to say what would settle each draft, how to use triage ratings, and when to build both. The surface-profiled briefing from cold-start Phase B is the mechanism.
- It sits between two existing positions: an ordinary key deposits freely; the no-deposit principal for untrusted-input agents such as automated PR reviewers deposits nothing. Headless is drafts-only. Together they make one ladder of what a key may write: full, drafts only, nothing. That ladder is the "capabilities on a key" concept in the context-seams doc, so it should be designed once.
- For an autonomous reviewer, drafts-only may turn out to be enough: a draft about a PR's author is visible only to that author and the reviewer's owner, so injected text can reach at most one person's review queue and never anyone's results. Whether reviewers get drafts-only or no-deposit is a decision for when that principal is built.

## Parameters and tool-description size

New optional parameters on `check_recipe` (and its REST twin): `draft` (boolean, default false), `on_behalf_of` (email, default the key's user), `impact`, `uncertainty` (both default unrated). This replaces the single "draft on behalf of" parameter from the earlier ruling.

Many MCP clients load every tool's description and parameter schema into the model's context on every turn. (Claude Code can defer them behind tool search when a session has many tools, but other clients don't.) The current descriptions are roughly 6,000 characters of tool and parameter text, plus the full feedback-row schema repeated on both `check_recipe` and `search_recipes`. Four new parameters can be net-negative in size if they land with:

- the deprecated `clusters` and `max_chars` cut to a one-line pointer to `verbosity` (they stay declared, because the MCP SDK drops undeclared parameters before the handler sees them, and they are still honored; `session_id` is intended for deprecation but not yet deprecated, so it stays as is);
- the inline feedback-row schema on `check_recipe` and `search_recipes` replaced by a short pointer to `log_feedback`'s fields;
- the repeated shared parameters (`intent`, `agent_id`, `known_recipes`) cut to one line each, with the detail living once in the briefing.

These are agent-facing copy changes, so they go through the briefing regression specs and the declared-intent rule.

## Small briefing tweak to consider

Evidence is already required to be verifiable ("Reference = a raw verifiable quote + citation"), but the briefing never says by whom. One phrase makes the intent explicit and gives verification its standard for free: evidence should let someone who wasn't there check the claim independently. Suggested placement is the Truthfulness principle, for example extending "Every claim, every quoted reference, every 'so that' needs to be true at the moment you submit" with "and checkable by someone who wasn't there". Guidance, not a rule; declared under the regression-spec process like any briefing edit.

## Build notes

- Depends on: the authorization seam (drafts are one more visibility rule, and it belongs in one place, `authz/`); the recipe-to-intent link (for option sets); capability flags on keys (for headless).
- The review queue is the human search page with a draft filter and `impact:` / `uncertainty:` qualifiers, sorted for triage, with confirm, reject, and not-chosen actions.
- Every read path must exclude drafts except for the permitted viewers. With the seam in place that is one condition in the module, tested once, rather than a change in each route.
- Security-relevant (a new visibility rule, a new agent write, a key setting that must not be removable by a derived key): the security workflow applies.
