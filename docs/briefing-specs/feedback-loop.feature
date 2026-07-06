Feature: Feedback ingestion — chained on the next check, or via log_feedback
  # Shipped 2026-07-05 (WT-4 merge: check_feedback table + service, log_feedback
  # tool, check_recipe feedback param, POST /feedback REST twin) — @unreleased
  # tag dropped by the first briefing-copy PR under the declared-intent rule.
  # Design: docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md §WT-4
  # ("Server-side feedback ingestion") and §Validating the UVP (server-stamped
  # fields, echo detection — all computed server-side, not self-reported).
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
    And the row is recorded with the schema's real vocabulary — kind "outcome", plus impact (none/new/subtle/big) and disposition (proceeded/corrected/asked-human/charted-new/deferred) — even though no new recipe was checked

  Scenario: Feedback does not require the agent to specify a recipe-book
    When the agent submits feedback (chained or standalone) about a prior check
    Then it does not pass a recipe-book parameter for the feedback
    And the feedback is routed to the book the original recipe lives in, resolved server-side

  Scenario: Ignored, contradicted, or empty results still earn a feedback row
    # Guards: briefing §Closing the loop — "results that didn't help are worth a
    # row too"; cold-reader question from the 2026-07-05 qualitative evals.
    Given an earlier check whose results the agent ignored, that contradicted its direction, or that surfaced nothing similar
    When the agent reaches its next feedback moment
    Then it logs a row for that check rather than skipping it as not worth reporting
    And the row's vocabulary reflects the miss (e.g. story_fulfilled "no", disposition "corrected") rather than defaulting to success values

  Scenario: Web/REST agent closes the loop via POST /feedback
    # Guards: briefing §Closing the loop — the REST twin of log_feedback
    # (apps/backend/src/routes/feedback.ts; same service, same ACL path).
    Given a fresh URL-constructing web agent (no MCP tools) primed with the unified briefing
    And it holds the recipe UUID from an earlier check
    When it has feedback on that check to report
    Then it issues POST /feedback with Bearer API-key auth
    And the body is a single row object carrying trace_id (or {"feedback": [rows]}) with the same fields the MCP feedback parameter uses
