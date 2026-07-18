@unreleased
Feature: known_recipes dedup — trimming repeats without touching the record
  # Not yet implemented — gated on WT-4 dedup phase 1 (known_recipes param on
  # check_recipe and /check). See
  # docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md §WT-4
  # ("Dedup, phase 1: known_recipes param", lines 144) and
  # docs/design-thinking.md:229 (the original, previously-dangling user story:
  # "When I include known_recipes=[id1, id2, ...], Soup.net omits full text
  # for those and returns only a compact... tree of IDs for the duplicates").
  #
  # Guards: plan doc invariant — "rendering-only (trace logging and idempotency
  # semantics untouched); stubs still count in cluster math so the shape of
  # results doesn't shift" (§WT-4). This is a rendering optimization, not a
  # retrieval or logging change — the scenarios below assert that boundary.

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing
    And the agent has already seen several recipes earlier in the same session

  Scenario: Known ids render as compact stubs instead of full bodies
    When the agent calls check_recipe with known_recipes set to the ids it already holds
    And some of those ids are among the results
    Then each result matching a known id renders as an id-only stub (id, known flag, similarity — no recipe text; gist removed 2026-07-17, ossification ruling) instead of the full recipe text
    And results not in known_recipes still render with full text as usual

  Scenario: known_recipes affects rendering only, never the logged trace or idempotency
    When the agent checks a recipe whose content matches one it checked in an earlier session
    Then the new check is still logged as a new trace, regardless of any known_recipes param on this or any prior call
    And a recipe already known to one agent session is still returned in full to a different agent session that has not declared it as known

  Scenario: Stubbed results still count toward cluster math
    Given a result set where some members would stub out under known_recipes
    When the response is clustered to exemplars
    Then the cluster sizes and exemplar selection are computed as if the stubbed members were rendered in full
    And only the rendered text — not the clustering — changes because of known_recipes

  # Session refresh hint (2026-07-17, recipe 31d184df): the session models the
  # agent's context-fill state, so a compacted context calls for a fresh session.
  Scenario: Agent that compacted its context refreshes the session
    Given the agent's context was auto-compacted and it no longer holds the recipes it was shown
    When the agent makes its next check_recipe call
    Then it omits session_id instead of passing the stale token
    And the fresh session renders previously-shown recipes with full text again

  # Published schema pointer (2026-07-18, recipes 7945fd8a + 43ce7ec0): the
  # briefing carries ONE pointer line; the canonical field meanings live in
  # the generated JSON Schema, so copy and validation cannot drift.
  Scenario: Agent needing full field meanings fetches the published schema
    Given a briefed agent unsure what a response field (known, knownMembers, sessionId) means precisely
    When it re-reads the briefing's "How to check" section
    Then it finds the pointer to GET /schemas/recipe.json and /schemas/check-response.json
    And the fetched schema embeds each field's canonical description
