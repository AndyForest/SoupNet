Feature: Divergent recipe checks — the user's selection is the signal
  # Guards: briefing §Divergent recipe checks (recipe-guide-content.ts BRIEFING);
  # design-thinking.md §Divergent Recipe Checks; WORKFLOW_ANNOTATION
  # (plan-annotation pattern vs option-list replacement).

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing

  Scenario: MCP agent waits for the choice before checking
    Given thin, ambiguous evidence about the user's preference with multiple plausible framings
    When the agent presents divergent options
    Then it presents 2-4 framings, each with full recipe text and per-framing evidence (what makes THAT framing a candidate)
    And it calls check_recipe only after the user picks, and only on the chosen framing
    And the chosen recipe's warrant records that N framings were presented and this one was chosen

  Scenario: No framing fits — clarify, don't settle
    Given the user rejects all presented framings
    When the agent continues
    Then it asks the user to clarify and forms new hypotheses
    And it does not check the closest miss

  Scenario: Creative output is annotated, not replaced
    # Guards: WORKFLOW_ANNOTATION — the plan is the primary output
    Given the user asked for a creative plan containing several real taste calls
    When the agent delivers
    Then the plan itself is the primary output, with recipe-check links tagging the taste calls within it
    And the plan is not replaced by a bare list of divergent options
