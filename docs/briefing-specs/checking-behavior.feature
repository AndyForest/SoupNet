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

  @unreleased
  Scenario: A rated check uses the rating vocabulary and leaves out a rating it has no view on
    # Guards: MCP_PARAM_DESCRIPTIONS.impact and .uncertainty (recipe-guide-content.ts); docs/planning/drafts-and-triage.md §Triage ratings; spec-decision-log.md 2026-09-27 (drafts-and-triage slice 1). The parameters ship in slice 1; the scenario stays @unreleased until the briefing body teaches rating (slice 7) and the harness can run it.
    When the agent makes a check where it has a view on how much rides on the call but none on how sure it is of the person's position
    Then any rating it sends on check_recipe is one of "low", "medium", or "high"
    And it sends impact and leaves uncertainty out, rather than sending uncertainty "medium" as a default

  @unreleased
  Scenario: An agent drafts only when it cannot ask, and says why in the first evidence entry
    # Guards: MCP_PARAM_DESCRIPTIONS.draft (recipe-guide-content.ts); docs/planning/drafts-and-triage.md §When to draft, and when to ask instead; spec-decision-log.md 2026-09-27 (drafts-and-triage slice 2). The parameter ships in slice 2; the scenario stays @unreleased until the briefing body teaches when to draft (slice 7) and the harness can run it.
    Given the person is reachable in the conversation
    When the agent faces a high-impact, uncertain call about the person's taste and judgment
    Then it asks the person, or presents divergent options, rather than depositing a draft
    When the person cannot be asked now and the agent has to proceed
    Then it checks the recipe with draft set to true
    And the first evidence entry's interpretation says why the person could not be asked and what would settle it

  @unreleased
  Scenario: An agent that deposited drafts hands its person the queue link rather than listing ids
    # Guards: draftDepositNotice (packages/domain/src/drafts.ts), the queue link it carries; docs/planning/drafts-and-triage.md §Verifying a draft ("Links"); spec-decision-log.md 2026-09-27 (drafts-and-triage slice 3). The link ships in slice 3; the scenario stays @unreleased until the briefing body teaches drafting (slice 7) and the harness can run it.
    Given the agent deposited drafts during a session its person was away for
    When the person returns and the agent reports what it left open
    Then it gives the person one review-queue link naming those drafts (/app/drafts?ids=…)
    And it does not ask the person to look the drafts up by id in prose

  @unreleased
  Scenario: A briefed agent records a colleague's judgment as a draft on their behalf and hands over their review link
    # Guards: MCP_PARAM_DESCRIPTIONS.onBehalfOf (recipe-guide-content.ts), the on-behalf deposit notice (packages/domain/src/drafts.ts); docs/planning/drafts-and-triage.md §The model; spec-decision-log.md 2026-09-27 (drafts-and-triage slice 4). The parameter ships in slice 4; the scenario stays @unreleased until the briefing body teaches drafting (slice 7) and the harness can run it.
    Given the agent is reading a colleague's own artifacts that record a decision the colleague made
    When it records that decision
    Then it checks the recipe with on_behalf_of set to the colleague's email, in the colleague's functional role
    And its evidence quotes the colleague's own words from those artifacts
    And it hands its person the colleague's review link from the response, rather than calling the draft verified
