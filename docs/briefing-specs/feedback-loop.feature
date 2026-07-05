@unreleased
Feature: Feedback ingestion — chained on the next check, or via log_feedback
  # Not yet implemented — gated on WT-4's server-side feedback ingestion
  # (check_feedback table + service). See
  # docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md §WT-4
  # ("Server-side feedback ingestion", lines 137-142) and §Validating the UVP
  # (server-stamped fields, echo detection — all computed server-side, not
  # self-reported).
  #
  # Guards: plan doc's explicit rejections that shape these scenarios —
  # "Feedback chained-only (no standalone tool) — rejected" and "Feedback
  # standalone-only (no chaining) — rejected" (§WT-4 Rejected). Both surfaces
  # exist because different feedback moments need different carriers.

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing
    And the agent checked a recipe earlier in the session and later observed whether it held up

  Scenario: Mid-flow feedback rides on the next check_recipe call
    Given the agent is about to make another check_recipe call later in the same session
    When it has feedback on the earlier check to report
    Then it attaches the feedback to that check_recipe call via the feedback field, rather than making a separate call
    And the feedback identifies which prior recipe it concerns

  Scenario: End-of-session feedback with no next check uses log_feedback
    Given the session is ending and no further check_recipe call is planned
    When the agent has an outcome to report on an earlier check
    Then it calls the standalone log_feedback tool
    And the outcome kind (e.g. confirmed, corrected, contradicted) is recorded even though no new recipe was checked

  Scenario: Feedback does not require the agent to specify a recipe-book
    When the agent submits feedback (chained or standalone) about a prior check
    Then it does not pass a recipe-book parameter for the feedback
    And the feedback is routed to the book the original recipe lives in, resolved server-side
