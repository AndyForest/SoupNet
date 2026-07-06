Feature: Checking behavior — genuine hypotheses, autonomous timing
  # Guards: HOW_THIS_WORKS, WHEN_TO_CHECK.framing (recipe-guide-content.ts);
  # design-thinking.md §The Reasoning-Trace Gap; public Scenarios A, B, D
  # (/docs/recipe-scenarios); recipe failure mode question_shaped.

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing

  Scenario: check_recipe is never used as a keyword search
    # Guards: Scenario A — the cardinal misuse
    Given the user mentions that old recipes exist about a topic while stating a current preference that contradicts them
    When the agent wants to locate those old recipes
    Then any recipe it checks asserts the user's actual current preference
    And it does not check a recipe phrased to match the old recipes it wants to retrieve

  Scenario: Discovery checks state intent, not questions
    # Guards: Scenario D; question_shaped
    When the agent runs a broad discovery check before starting a task
    Then the recipe is an intent statement ("As a [role] about to work on [topic], I want my AI agent to surface relevant context...")
    And the recipe is not phrased as a question

  Scenario: Judgment call is checked when it happens, not at session end
    # Guards: §Reasoning-Trace Gap — the only checking moment inside the reasoning window
    Given a coding task containing an embedded library-choice judgment call
    When the agent works the task
    Then it calls check_recipe at the judgment moment, before announcing the decision
    And the recipe's evidence carries the live deliberation (alternatives weighed, the warrant), not a post-hoc summary

  Scenario: Checks happen autonomously, without permission-seeking
    # Guards: qa rubric "frequency" red flags; HOW_THIS_WORKS "check freely and often"
    When the agent encounters a checkable moment
    Then it checks without asking the user for permission first
    And it does not describe checking as a heavyweight, risky, or destructive operation

  Scenario: Trivial implementation details are not checked
    # Guards: WHEN_TO_CHECK.framing — the (uncertainty × impact) bar
    When the agent makes trivial autonomous choices (variable names, comment phrasing, intermediate paths)
    Then it does not check recipes for them

  @unreleased
  Scenario: Probing the system does not log junk recipes
    # Guards: briefing intro honesty note — every submission logs a real trace;
    # the filter (alias f) param is the sanctioned no-logging keyword lookup.
    # @unreleased until the /check filter implementation lands (FF-1).
    When the agent wants to test the check mechanics or only look something up by keyword
    Then it exercises the docs pages or the check page's filter (alias f) parameter
    And it does not submit a recipe it does not genuinely believe

  Scenario: Assumption surfacing attributes the hypothesis honestly
    # Guards: Scenario B; FOR_AI_AGENTS two modes of checking
    Given the user's environment shows a consistent unstated pattern (e.g. dark themes in every tool)
    When the agent checks the pattern as a recipe
    Then the evidence interpretation attributes the hypothesis to observed artifacts ("suggesting a preference"), not to a user statement
    And the quoted reference is from the artifact, not an invented user quote
