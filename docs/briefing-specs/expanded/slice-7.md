# Slice 7 (drafts and triage), PR C1: expanded text

Frozen 2026-10-24. The served forms are in `packages/domain/src/recipe-guide-content.ts` as of the C1 commits on `drafts/7-briefing`; the decision-log entry is [../spec-decision-log.md](../spec-decision-log.md) (2026-10-24, C1). Why it was trimmed, in every case unless a chunk says otherwise: the thin briefing has a 21,000-character ceiling and the first drafts of these additions came to about 3,700 characters against about 2,800 of headroom (build log question 56, ruled). Where the expanded text carries a later ruling as well (the 7a addition of revision commit `a7f4d20`), it is the fullest version written.

## slice7.drafts

Served in: `BRIEFING.build`, the "## Drafts" section, shared body (thin and full).

```text
A draft (`draft: true` on `check_recipe`) is a hypothesis you can't yet stand behind from the context you hold, private to the person it's about and their agents until it's resolved. At a call like that, the useful order of moves:
- If you'll act on it, check it as an ordinary recipe and own it; its id is where a later correction attaches.
- If the call is a person's and they're reachable, ask them in plain words, with your recommendation and its reasoning. If you keep working meanwhile, deposit that recommendation as a draft under your intent, so their answer reaches you through the corpus wherever they give it: in chat, a review, or a commit message.
- Otherwise draft it: say in the first evidence entry what would settle it, rate impact and uncertainty, and come back to it when that lands. A draft is your hypothesis to own, not an item for a person's to-do list.

A draft is yours to resolve. Whichever of a person's agents holds the settling context, you included once the work or their reply settles it, resolves it with `verify_draft` (verified, rejected, or not chosen) under the same confidence rule as any check, quoting that person's words wherever they gave them; ask the person only when that's useful. A draft waits for a person's click only while nothing any agent holds settles it. In a shared book the call may be a colleague's; a draft on their behalf is resolved by their agents, not by you.

Orchestrating sub-agents is live work: sub-agents decide as they go and raise only high impact × uncertainty calls, without blocking; poll your run's drafts (`is:draft intent:<id>`) during the run, correct mid-run, ratify what you can settle, and after the run resolve your sub-agents' drafts or list them with a recommendation.
```

Trimmed away in the served form: "its id is where a later correction attaches"; "through the corpus … in chat, a review, or a commit message"; "ask the person only when that's useful" (superseded by the click sentence); the shared-book sentence (the served "you included" is wrong for a draft on a colleague's behalf, and the server refuses it with `only_subject_reviews`); "without blocking", "ratify what you can settle", and "list them with a recommendation" in the orchestration sentence.

## slice7.over-caution-example

Served in: nowhere yet; carried to PR C2 (build log row S7-B6).

```text
An orchestrator once refused to verify drafts its own context settled, because the tool copy spoke of a person confirming. The goal is that a person's agent resolves what it can stand behind, and a person sees only what no agent could.
```

## slice7.building-both

Served in: `BRIEFING.build`, "## Divergent recipe checks", appended to the wait-for-the-choice paragraph.

```text
Building both is the other case: when every option will genuinely be pursued, each claim is true when checked, so check each as an ordinary recipe; when you can't stand behind any yet, draft each under one intent with the rubric for choosing stated before you measure. Either way, check the chosen path with the outcome as evidence and leave a feedback row on each of the others.
```

Trimmed away: "each claim is true when checked" (the reason ordinary recipes are right here), "before you measure", "a feedback row on each of the others".

## slice7.reading-results

Served in: `BRIEFING.build`, "## Reading results", shared body.

```text
A returned recipe is a call someone made in their context, not a rule. Weigh it against your situation and say how it applies ("in their context, they chose X"). Recurrence isn't restatement: a familiar judgment in a new context is worth logging, with that context as evidence. A neighbor that is your own open draft, or one deposited today under your intent, is your own assumption coming back; weigh it as that. When results in your context are thin, think harder and check more of your calls rather than stretching a near miss.
```

Trimmed away: the worked phrase "in their context, they chose X"; "Recurrence isn't restatement"; "or one deposited today under your intent"; the thin-results sentence (served instead as a line on the check response's empty result, in `check-response-renderer.ts`, which only an empty result prints).

## slice7.when-to-check-moments

Served in: `WORKFLOW_WHEN`, three bullets after the original three.

```text
- Extending something that already has a default (who gets through when no rule matches, a short list turning into policy)? It may not feel like a call; a check finds your user's principle if they have stated one.
- Writing for a particular reader in a particular place? Their corrections are often already logged, and a check before writing finds them.
- An instruction pulling against your judgment? Check the call you think is right, with the instruction quoted, then proceed: the judgment is logged either way, and its id is where later redirection attaches.
```

Trimmed away: "a short list turning into policy" (the field case); "Their corrections are often already logged"; "the judgment is logged either way".

## slice7.two-axes

Served in: `PRINCIPLES`, the paragraph after "The same mechanics govern a changed mind" in Authoring for retrieval.

```text
Granularity and generality are separate axes. One judgment per recipe sets the count; how much of this case sits inside the claim sets the specificity. State the claim at the most general level that is still true, written as a choice ("I chose", "I prefer") rather than a "must", and put the specifics in the evidence, where they are still read and still checkable: the detail moves rather than disappears.
```

Trimmed away: the examples of a choice; "still read"; "the detail moves rather than disappears".

## slice7.recipient-role

Served in: `ROLE_PATTERNS`, the fourth pattern.

```text
- **For what the user receives** (a document, a report, a dashboard), the recipient role is the invariant one: name the kind of thing received ("As a reader of weekly status reports..."), keep the goal clause separate, and use "prefer" or "chose" rather than "want". The test: it stays true when the same person authors the next one instead of reading it.
```

Trimmed away: "(a document, a report, a dashboard)"; "instead of reading it".

## slice7.probe-is-a-search

Served in: `BRIEFING.build`, "Search vs check" paragraph.

```text
Probing the corpus itself (what's there on a topic, how a role clusters) is a search too: a probe made as a check takes exemplar slots from the recipes it competes with.
```

## slice7.ratings

Served in: `BRIEFING.build`, "How to check", the optional-parameters list.

```text
`impact` and `uncertainty` (your triage ratings, low | medium | high; leave out one you have no view on rather than defaulting to medium)
```

## slice7.headless

Served in: `HEADLESS_KEY_SECTION` (400-character cap). The served form is the full intent of 7c; this is the first draft, for comparison.

```text
So drafting well is the work (see Drafts): in each draft, say what would settle it and rate its impact and uncertainty, and when options stay open, draft each under one intent.
```

## slice7.search-includes-own

Served in: `BRIEFING.build`, "Search vs check" paragraph (recipe `885143c2`).

```text
it's the tool to reach for when the judgment you need is already logged, your user's or a collaborator's: reviewing a teammate's PR area (…), or joining a shared recipe book mid-project. Its results include your own recipes: `author:<email>` narrows to one person, `-author:me` leaves yours out, and `after:`/`before:` bound the judgment date.
```

## slice7.intent-only-outcome

Served in: `BRIEFING.build`, "Closing the loop — feedback".

```text
An outcome row about the whole session, with no single recipe behind it, can carry your intent_id alone.
```

## Thin profile only: dropped duplicates

Not trimmed text but text the thin profile no longer serves (recipe `63abcc48`). Both are still served in the full profile, verbatim, so their expanded text is the full profile's: the paragraph beginning "If you auto-compact your context or otherwise no longer hold the recipes you've been shown" and the line "Evidence entries follow this shape: …". For MCP agents the same guidance is in the `session_id` and `supporting_evidence` parameter descriptions.
