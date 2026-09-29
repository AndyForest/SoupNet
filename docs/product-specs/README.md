# Product behavioral specs

Gherkin-style specs for Soup.net's deterministic product behavior: what the server stores, returns, hides, and refuses. Each scenario pins one design commitment with a Given (state), a When (a request), and observable Then-clauses. These are the "behavioral spec" step in the requirement → user story → spec → test chain described in [docs/customers/README.md](../customers/README.md).

## How these differ from the briefing specs

[docs/briefing-specs/](../briefing-specs/README.md) pins agent-facing *copy*: an LLM-eval harness primes a fresh agent with the briefing and judges what it does. The files here pin *server behavior*, which is deterministic, so each scenario is realized as a Layer 3 integration test (status codes and response shapes against a real stack; see [docs/testing-plan.md](../testing-plan.md)), or as a Layer 1 unit test or a static check where that is the natural home. A feature that has both a behavior and copy (drafts has both) gets scenarios in both places: behavior here, copy there under the briefing regression rule.

## Conventions

- **Organized by behavioral concern**, not by customer, not by phase. One `.feature` file per feature area; `Rule:` blocks group its concerns.
- **Scenario ids.** Every scenario carries a stable tag such as `@DT-VIS-03` (feature prefix, concern, number). Rubrics, tests, and verification records cite scenarios by id. Ids are never reused; a withdrawn scenario keeps its id with a `# Withdrawn:` comment.
- **`# Guards:` comments** trace each Rule or Scenario to its source: a section of `docs/design-thinking.md`, a design doc in `docs/planning/`, an ADR, or a Soup.net recipe id that holds the operator's ruling.
- **`# Requirement:` comments** name the customer requirement a scenario answers, e.g. `# Requirement: C01-R15`. Traceability runs both ways: from a requirement id to its scenarios, and from a failing scenario to who it matters to.
- **Then-clauses are observable**: a status code, a field in a response body, the presence or absence of an id in a result list, a row count, the byte size of a payload. "Handles correctly" and "understands" are not Then-clauses.
- **Negative scenarios are first-class.** Visibility rules are pinned by what must *not* appear as much as by what must. "Uniformly absent" means the response for a hidden recipe is byte-for-byte the response for an id that never existed, apart from the id itself.
- **`@unreleased`** tags a scenario for a capability that doesn't exist yet. The PR that ships it drops the tag in the same diff, so the spec is reviewed before the code and the shipping PR shows exactly which scenarios went live. A slice tag (`@slice-1` …) says which planned slice realizes it.
- **`# Pending decision:`** marks a scenario whose Then-clause states a recommended behavior that the operator has not yet ruled on. The slice that realizes it must get the ruling first.
- **Format is the point, not the toolchain.** Plain `.feature` files, no Cucumber step definitions. The realizing test names its scenario id in its `describe`/`it` title so a grep for the id finds both.
- Prose is unwrapped: one line per paragraph or bullet.

## Files

| File | Concern |
|---|---|
| [drafts-and-triage.feature](drafts-and-triage.feature) | Triage ratings and the tool-roster trim (slice 1), draft visibility and verification (slice 2), the review queue (slice 3), drafts on behalf of another person (slice 4), and headless keys (slice 5; DT-HDL-02 waits for derived keys) are built; `@unreleased` per Rule — option sets. Design: [planning/drafts-and-triage.md](../planning/drafts-and-triage.md) |
