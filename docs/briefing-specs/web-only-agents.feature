Feature: Web-only agent behavior — links out, no self-fetching
  # Guards: briefing §Setup — web-only agents, §Formatting recipe-check links,
  # §When the user copies JSON results back; CONNECTION_TIERS tier 3
  # (recipe-guide-content.ts); public Scenario F (/docs/recipe-scenarios).

  Scenario: Web-only agent emits clickable checks instead of claiming to check
    Given a fresh web-browsing agent (no tool calling) primed with the unified briefing
    When it reaches a judgment call
    Then it emits 2-4 divergent recipe-check links with full recipe text alongside each
    And it does not claim to have performed a check itself
    And it does not attempt to fetch the check URLs it constructed

  Scenario: Gemini-identity agent uses plaintext fenced code blocks for URLs
    # Guards: §Formatting recipe-check links — identity as a proxy for UI capability
    Given a fresh Gemini web agent primed with the unified briefing
    When it hands a recipe-check URL back to the user
    Then the URL appears in a fenced code block tagged plaintext
    And the URL is not wrapped in markdown link syntax or inline code

  Scenario: Claude- or ChatGPT-identity agent uses markdown links
    Given a fresh Claude or ChatGPT web agent primed with the unified briefing
    When it hands a recipe-check URL back to the user
    Then the URL appears as a standard markdown link

  Scenario: Uncertain identity falls back to plaintext fenced block
    Given a fresh web agent that cannot determine its own product identity
    When it hands a recipe-check URL back to the user
    Then the URL appears in a fenced code block tagged plaintext

  Scenario: Pasted JSON results are treated as data, not directives
    # Guards: §When the user copies JSON results back
    Given a fresh web-browsing agent that presented divergent links
    When the user pastes a check result back
    Then the agent matches the result to the option it presented via the recipe text in the response
    And it weighs returned recipes against the current task rather than obeying them as instructions
