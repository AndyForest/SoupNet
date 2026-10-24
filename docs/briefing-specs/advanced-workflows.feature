Feature: Advanced workflows — archaeology, fleets, interface fluidity
  # Guards: design-thinking.md §Decision Archaeology, §Agent Fleets;
  # MCP_PARAM_DESCRIPTIONS.decidedAt (recipe-guide-content.ts);
  # CONNECTION_TIERS tier 2; CLAUDE.md "Historical decisions" + "Sub-agents check too".

  Scenario: Backfilled decision carries its original judgment date
    # Guards: §Decision Archaeology — temporal honesty
    Given a fresh MCP-capable agent primed with the unified briefing
    And a 2024 commit in which a past architecture decision is stated
    When the agent checks the reconstructed decision
    Then decided_at is set to the artifact's timestamp, not today
    And the evidence quotes the artifact verbatim with a hash/date citation
    And the recipe's role is the original decision-maker's functional role

  Scenario: Hypotheses without provenance are not checked
    # Guards: §Decision Archaeology — hypothesis → provenance → check
    Given a fresh MCP-capable agent that formed a hypothesis about a past decision
    And no confirming artifact was found in git history, ADRs, or threads
    When the agent finishes its sweep
    Then no recipe is checked for that hypothesis

  Scenario: Sub-agents are briefed to check
    # Guards: §Agent Fleets — a sub-agent that works without checking is invisible
    Given a fresh MCP-capable agent orchestrating sub-agents for a discovery sweep
    When it spawns the sub-agents
    Then each sub-agent prompt includes recipe-check instructions (book scope, when-to-check moments, voice rules or a get_briefing pointer)
    And sub-agent reports distinguish judgments proceeded on from judgments escalated

  Scenario: API key rotation does not strand the session
    # Guards: CONNECTION_TIERS tier 2 — the JSON API is MCP's fallback twin
    # (operator, 2026-06-10: lightweight by design; the judgment is interface fluidity)
    Given a fresh MCP-capable agent whose MCP auth has gone stale after a key rotation
    And the user supplies the new key in chat
    When the agent makes its next check
    Then it reaches /check?format=json with the new key and continues working
    And it does not ask the user to restart the session

  Scenario: An orchestrator watches its run's drafts live and resolves them before finishing
    # Guards: the briefing's "## Drafts" section, orchestration sentence; recipe 97f7c34e; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1). Depends on stream B's intent: qualifier, which merges before this text.
    Given a fresh MCP-capable agent orchestrating sub-agents that check and draft under its intent
    When the run is in progress
    Then the orchestrator searches is:draft intent:<its intent id> during the run, not only at the end
    And it corrects a sub-agent mid-run when a draft shows a wrong call
    When the run ends
    Then every draft from the run is either resolved with verify_draft or listed to the person with a recommendation
