# Guards: BRIEFING.build surface profile (recipe-guide-content.ts), renderBookStatsLine,
# resolveScope mcpSurface + k default (services/briefing.ts), operator rulings 2026-08-23
# (soupnet-oss recipes ef844c32 thin-MCP-default, 401998c5 index-not-summary).
# Field grounding: retrieval-at-initialization loses to retrieve-when-needed
# (arXiv 2604.20572, 2607.08716); token-matched controls (arXiv 2605.29630).
Feature: Surface-profiled briefings — thin index for tool-connected agents, full artifact for unknown receivers

  The always-pushed layer stays a thin index on surfaces where the agent can
  retrieve on demand; the paste-delivered artifact keeps everything because
  its receiver's capabilities are unknown and follow-up retrieval may not
  exist. Corpus depth arrives task-keyed through checks and searches, not
  front-loaded.

  Scenario: Fresh MCP-connected agent receives the thin briefing
    Given a fresh MCP-capable agent whose only context is the get_briefing response
    When the agent inspects the briefing it received
    Then the briefing contains no client setup configs (no Codex TOML, no .mcp.json snippet)
    And it contains no web URL-construction guidance and no link-formatting rules
    And it contains no clustered corpus exemplars
    And each recipe book renders with an Index line (recipe count, newest judgment date, activity, authors, feedback/reaction rollups) beside its description
    And the principles, recipe format, when-to-check, and feedback-loop sections are present in full

  Scenario: MCP agent opts back into corpus exemplars
    Given a fresh MCP-capable agent that wants a corpus sample in one call
    When it calls get_briefing with verbosity high
    Then the briefing carries clustered exemplars (~10) in addition to the index lines

  Scenario: Thin-briefed agent reaches corpus depth by retrieval, not by a bigger briefing
    Given a fresh MCP-capable agent primed with only the thin briefing, starting a task
    When it wants context on the task area
    Then it makes a broad discovery check or a search (task-keyed retrieval)
    And it does not re-fetch the briefing at higher verbosity as its first move

  Scenario: Index short-ids resolve directly
    Given a thin-briefed agent whose book description or index cites an 8-char recipe short id
    When the agent wants that recipe's full text
    Then it calls get_recipes with the short id and receives the full recipe

  Scenario: Web copy-paste briefing keeps the full artifact
    Given a human pastes the dashboard-copied briefing into an external chat LLM
    When that LLM reads the artifact
    Then the setup sections, link-formatting rules, clustered exemplars, and pasted-JSON guidance are all present
    And the artifact is byte-identical to the pre-profile briefing shape (per-surface snapshot guard)

  Scenario: Mid-session corpus refresh returns the index, not a sample
    Given an MCP-connected agent whose conversation moves into a new area of the user's work
    When it calls list_my_recipe_books
    Then the response carries identity, books with descriptions and Index lines
    And no clustered exemplar sample
