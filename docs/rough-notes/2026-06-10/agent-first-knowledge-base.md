# Agent-first knowledge base + agent-suggested system improvements

> **Rough note (2026-06-10).** Idea capture from operator riffing, lightly structured. Not designed, not committed. Related: [briefing-regression-testing.md](briefing-regression-testing.md) (Track 2 findings are the first KB content source).

## The chain of ideas

1. Track 2 of the regression work will produce **measured authoring knowledge** ("with gemini-embedding-2-preview, self-contained jargon sharpens retrieval; codename-grade jargon hurts; goal clause disambiguates role terms…").
2. That knowledge shouldn't all ship to every agent — briefing size is precious. So: a **knowledge base** of authoring/usage nuances, retrieved *per recipe book* — matched against the book's description and recipe contents using the **existing semantic-similarity subsystems**. The briefing composer already clusters exemplars; injecting the two or three KB entries nearest to the user's actual corpus is the same cheap math. Personalized briefings with zero server-side LLM.
3. KB articles are **agent-first**: the readers are AI agents, so the formats are the ones agents parse natively and we already use — Gherkin scenarios for behavioral guidance, actual recipe-check format for examples, measured assertions with the data that backs them. Not human-style help-center prose.
4. **The feedback loop: end users' AI agents suggest KB entries and system improvements.** We don't want human developers looking at end-user data — instead, when a user's agent hits and solves a problem for its use case, it submits a **synthetic demonstration**: a constructed recipe check (or matched pair) that exhibits the issue and the fix, with no real user content. The agent does the distillation and de-identification at the source, where the context lives. This is stigmergy applied to the system itself — Soup.net improves through traces its users' agents deliberately leave about Soup.net.

## Why this fits the existing architecture

- **Zero LLM on the server holds.** KB retrieval is embedding similarity; KB authoring, distillation, and synthesis are all client-agent work. Agents do the heavy lifting; the server does cheap math.
- **Privacy posture strengthens, not weakens.** The feedback channel is *designed* so that nothing private ever needs to cross: synthetic-by-construction demonstrations, reviewed before any use.
- **It reuses the recipe shape.** A KB suggestion is structurally a recipe check about Soup.net itself — claim, warrant, demonstrating data. The submission surface might literally be a recipe book.

## Sketch of mechanics (all open)

- **KB store:** entries with embeddings; could be a system-owned recipe book or a dedicated table. Retrieval at briefing-compose time against the key's book descriptions + a corpus centroid.
- **Suggestion channel:** an MCP tool (`suggest_improvement`?) or a designated public recipe book; submissions carry the synthetic demonstration + the agent's interpretation.
- **Review gate — non-negotiable:** KB entries become *instructions inside other users' briefings*. A community-suggested entry that flows to agents unreviewed is a **prompt-injection vector** by construction. Every suggested entry passes human (operator) review before publication; the synthetic-only rule keeps that review safe to perform. Provenance recorded per entry.
- **Quality bar:** suggested entries should arrive with their Track-2-style evidence (the matched pair / measurement that shows the issue is real), so review is verification rather than investigation.

## Open questions

- Does per-book KB injection go in the briefing, the check response, or both? (Check-response injection reaches web-only agents too.)
- How do we keep the KB from re-growing the briefing it was meant to slim? (Hard cap per briefing; relevance threshold.)
- Synthetic-demonstration verification: can we automatically screen submissions for accidental real-data leakage (entity detection, corpus-similarity check against the submitter's own books) before a human ever sees them?
- Incentive/abuse: rate limits, per-key attribution, what stops spam suggestions.

## Roll-up path

If adopted: per-book KB injection → backlog `[DESIGN]` then ADR (briefing composer change); suggestion channel → its own design pass with the security review workflow (`docs/workflows/security.md`) because of the injection surface.
