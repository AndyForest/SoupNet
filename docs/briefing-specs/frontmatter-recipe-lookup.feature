@unreleased
Feature: Frontmatter-briefed lookup — resolving soupnet_recipes ids before editing
  # Not yet implemented — gated on WT-3's by-id lookup surface (get_recipes MCP
  # tool + GET /recipes?ids=..., and recipe_ids on get_briefing). See
  # docs/rough-notes/2026-07-05/next-improvements-worktree-plan.md §WT-3
  # (lines 106-122) and §WT-5 item (b) ("a live frontmatter test bed exists").
  # The soupnet_recipes YAML frontmatter convention itself already exists and
  # is exercised by this plan doc's own frontmatter (a list of recipe UUIDs);
  # it is "inert by design" until a lookup tool can resolve the ids (plan doc
  # §What you need to know first, item 3).
  #
  # Guards: docs/design-thinking.md:229 (known_recipes / by-id retrieval user
  # story, currently dangling per docs/backlog.md's "Restore the known_recipes
  # context-bloat item" entry); design-thinking.md §Agent Fleets (a sub-agent
  # scoped to a document should onboard on that document's declared context).

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing
    And a markdown document whose YAML frontmatter contains a soupnet_recipes list of recipe ids

  Scenario: Frontmatter-briefed agent resolves the declared recipes before editing
    When the agent begins editing that document
    Then it calls the recipe-lookup tool with the frontmatter's ids before making any edit
    And the edit does not proceed on assumptions about those recipes' content without the lookup call having returned

  Scenario: Onboarding via get_briefing recipe_ids skips a second lookup call
    Given the agent's first call in the session is get_briefing with a recipe_ids param set to the frontmatter's ids
    When the response returns
    Then the response includes the full text of exactly those named recipes alongside the identity/books/format sections
    And the agent does not make a separate recipe-lookup call for the same ids afterward

  Scenario: An unreadable or unknown id degrades to a marker, not a hard failure
    Given the frontmatter list includes one id the agent's key cannot read and one id that does not exist
    When the agent resolves the frontmatter's ids
    Then the response for each of those two ids is a marker entry, not recipe content
    And the request as a whole still succeeds and returns content for the remaining valid ids
