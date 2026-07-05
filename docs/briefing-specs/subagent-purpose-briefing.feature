@unreleased
Feature: purpose-scoped sub-agent briefing
  # Not yet implemented — gated on WT-3's purpose param on get_briefing
  # (and REST /briefing, /keys/briefing). See
  # docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md §WT-3
  # ("purpose param on get_briefing", lines 110) and
  # docs/design-thinking.md §Agent Fleets ("The orchestrator's briefing to
  # each sub-agent should include recipe-check instructions... which recipe
  # book is in scope, when to check, and the voice rules"). CLAUDE.md
  # "Sub-agents check too" is the corresponding operator-facing rule.
  #
  # Guards: plan doc's stated shape for purpose — "purpose biases exemplar
  # choice within clusters first — tailored exemplars, stable cluster
  # structure — before any stronger reordering" (§WT-3 Features).

  Background:
    Given an orchestrating MCP-capable agent about to spawn a sub-agent for a scoped task

  Scenario: Orchestrator supplies purpose when briefing a scoped sub-agent
    When the orchestrator calls get_briefing with a purpose string describing the sub-agent's task
    Then the returned exemplars are drawn toward recipes semantically related to that purpose
    And the sub-agent's briefing still includes the identity, recipe-book, and format sections unchanged

  Scenario: purpose-scoped briefing still carries the standard recipe-check instructions
    # Guards: CLAUDE.md "Sub-agents check too"; design-thinking.md §Agent Fleets
    Given the orchestrator is composing the prompt it will hand to the sub-agent
    When it includes the purpose-scoped briefing in that prompt
    Then the prompt also states which recipe book is in scope, the when-to-check moments, and the voice rules (or points at get_briefing)
    And the sub-agent's report back distinguishes judgment calls it proceeded on from ones it escalated

  Scenario: purpose narrows within clusters rather than replacing corpus-shape clustering
    Given a purpose string that strongly matches only a slice of the user's corpus
    When exemplars are selected for the briefing
    Then the cluster structure (the number and shape of clusters shown) stays representative of the scoped search results
    And purpose affects which recipe represents each cluster before any broader reordering of the result set
