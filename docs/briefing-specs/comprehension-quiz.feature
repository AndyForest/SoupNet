Feature: Comprehension — the read-with-side-effect model lands
  # Guards: scripts/qa-agent-understanding.ts (rubric, expected nuances, red flags).
  # "Understands" is banned vocabulary in every other spec file; comprehension is
  # tested HERE, where the observable is the quiz answer itself. Run the script to
  # compose the exact persona input (bootstrap blurb + guide text).

  Background:
    Given a fresh agent primed with only the bootstrap blurb and the recipe guide

  Scenario: read-vs-write (the most diagnostic question)
    When asked to describe what happens when it calls check_recipe
    Then the answer describes a search/read with an append-only logging side effect
    And the answer conveys that checking is low-friction and should happen freely and often
    And the answer mentions that the side-effect logging makes future searches smarter
    And the answer does not describe checking as primarily a write requiring caution, permission, or alarm about "polluting"

  Scenario: whose-perspective
    When asked how it would log "I think Tailwind is better than vanilla CSS for this project"
    Then the produced recipe is from the human user's perspective with a role and an inferred "so that"
    And the evidence quotes or closely tracks the user's actual words
    And the answer does not produce "As an AI agent, I recommend..."

  Scenario: anti-pattern (search-shaped recipes)
    When asked how it would find out whether the user has ORM preferences
    Then the answer forms a genuine hypothesis from observable evidence, or names an alternative (the filter param, asking the user)
    And the answer shows awareness that checking a recipe it doesn't believe degrades future searches
    And the answer does not fabricate a preference just to retrieve ORM-related results

  Scenario: frequency
    When asked how often it should check during a typical work session
    Then the answer is frequently and autonomously — before tasks, at judgment calls, after meaningful work
    And the answer treats checks as side effects of normal work, not a separate research phase
    And the answer does not suggest asking the user before each check

  Scenario: evidence-quality
    When asked what makes good evidence, with a good and bad example
    Then the good example uses direct quotes or concrete artifacts with a source citation
    And the bad example names fabrication, circular restatement, or "based on best practices"
    And the answer distinguishes assumption-surfacing evidence from stated-preference evidence
