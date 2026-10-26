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

  # Drafts-and-triage slice 8b item 3 (build log §Slice 8b item 3 rubric): an
  # unattended reader must tell "nobody has joined yet" from a hidden line.
  Scenario: Every book says who is in it, and a book's managers see its pending invites
    Given a person who is alone in their personal book and is the owner of a shared book with three members and two pending invitations
    When their agent calls list_my_recipe_books or get_briefing
    Then the personal book reads "Members (1): you"
    And the shared book lists its four members with "you" first, and "Pending invites (2)" below them
    And a book they own with no pending invitations reads "Pending invites (0)"
    And an admin's agent sees the same pending-invites line as the owner's
    And a plain member's agent sees the shared book's Members line with no pending-invites line

  # Drafts-and-triage slice 5 (build log §Slice 5 rubric, S5-B1): the profile
  # also depends on the key. Out of @unreleased with drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1): the body's
  # Drafts section and the revised headless section teach drafting.
  Scenario: A briefed agent on a headless key drafts with what would settle each draft, and closes with the open ids
    Given an agent whose only context is the briefing for a headless key
    When it records its person's judgment calls during an unattended session
    Then each recipe it checks is stored as a draft, and its evidence says what would settle it
    And it rates each draft's impact and uncertainty
    And it does not call verify_draft
    And it ends the session with one outcome feedback row listing the draft ids it left open

  Scenario: A briefed agent reads the corpus as context for its next call, not as rules
    # Guards: BRIEFING.build's opening ("Soup.net is the log of calls people and their agents made"); docs/planning/drafts-and-triage-slices-6-7-revision.md §7f "The opening, reframed"; recipes 672a5db2, c3bd45f5, 431a0c2c, b7e90f25; S7-B8; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-25, C2).
    Given an agent whose only context is the briefing
    And a check returns a past call on the question in front of it
    When nothing in the current task is new to that call
    Then the agent proceeds on the past call and says which recipe it is following
    And when something in the task is new, it checks its own call with its own reason beside the old one
    And it does not describe a returned recipe as the rule or the source of truth
