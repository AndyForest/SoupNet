Feature: Recipe voice — the user's perspective in a transferable role
  # Guards: ROLE_PATTERNS, MCP_PARAM_DESCRIPTIONS.recipe (recipe-guide-content.ts);
  # recipe failure modes agent_voice, user_name_voice, group_implied_product,
  # compound_role_inflation, missing_so_that, thin_no_role, two_claim_bundle,
  # vague_choice (recipe-examples.json); public Scenario C (/docs/recipe-scenarios).
  # Then-clauses are string properties of the produced recipe — observable in the transcript.

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing

  Scenario: Stated preference is logged in the user's voice, not the agent's
    # Guards: agent_voice; Scenario C
    # When-prompt must be unambiguous — a reason clause like "our edge case" legitimately
    # triggers the divergent-checks deferral rule instead of an immediate log (ground-truth
    # run, 2026-06-10), which tests two behaviors at once. The deferral path has its own
    # scenario in divergent-checks.feature.
    When the user says "I chose Hono over Express for this project, since its web-standard Request/Response model means our MCP streaming endpoint works without adapter shims." and the agent logs it
    Then the recipe's role is the user's functional role, not "As an AI agent"
    And the recipe does not contain "I recommend"
    And reading the recipe with the user's actual name swapped in for "I" keeps it true

  Scenario: Role is a functional role, not the user's name
    # Guards: user_name_voice
    When the agent logs any preference for a user whose name it knows
    Then the recipe role does not contain the user's name

  Scenario: Project-book write substitutes proper nouns instead of deleting them
    # Guards: group_implied_product — the work is substitution, not deletion
    Given write access to a recipe book whose description names the project
    When the agent logs a technology decision for that project
    Then the recipe role does not restate the project's name
    And the role is a specific functional equivalent (e.g. "backend developer building an MCP server"), not a bare role too vague to cluster against

  Scenario: Role and goal stay separate
    # Guards: compound_role_inflation; verb-form collapse called out in ROLE_PATTERNS
    When the agent logs a judgment made while authoring documentation
    Then the recipe contains a role and a separate goal clause
    And the role is not a verb-form collapse like "As an author authoring docs"

  Scenario: Every recipe carries full context
    # Guards: thin_no_role, missing_so_that
    When the agent logs any taste or judgment call
    Then the recipe contains a role, a goal, a concrete choice, and an explicit "so that" reason

  Scenario: One recipe per decision, named concretely
    # Guards: two_claim_bundle, vague_choice
    When the session surfaces two distinct decisions (e.g. a library choice and a deployment target)
    Then the agent checks two separate recipes
    And each recipe names its choice concretely rather than as "this approach" or "that style"
