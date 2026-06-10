Feature: Recipe-book routing — who benefits from knowing this?
  # Guards: GROUPS_GUIDE, renderRecipeBooks framing question, CROSS_POLLINATION
  # (recipe-guide-content.ts); design-thinking.md principle #4 (privacy-narrow
  # by default); public Scenario E (/docs/recipe-scenarios).

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing
    And the key writes to a personal book (default) and a shared project book

  Scenario: Personal taste defaults to the personal book
    When the agent logs a personal workflow preference unrelated to the shared project
    Then the check writes to the personal recipe book (no recipe_book param, or the personal slug)

  Scenario: Project decisions go to the project's shared book
    # Guards: GROUPS_GUIDE "defaulting everything to personal undermines collaboration"
    When the agent logs an architecture decision for the shared project
    Then the check passes the project book's slug explicitly

  Scenario: A collaborator's recipe is attributed in synthesis
    # Guards: CROSS_POLLINATION
    Given search results include a recipe authored by another member of a shared book
    When the agent synthesizes the results for the user
    Then it names the author of the collaborator's recipe
    And it weighs it as the collaborator's taste, not the user's
