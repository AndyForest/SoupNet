# Guards: MCP_PARAM_DESCRIPTIONS.intent, intentEchoLine (intent.service.ts), briefing intentLine
# (recipe-guide-content.ts), always-new registration ruling (soupnet-oss recipe 363e3e0c),
# session-supersession direction (recipe 5c55327d), rendering-only ledger (recipes 9067ca1b/4d25aec9).
Feature: Declared intents — forward-declared task stories that link briefing, retrieval, and feedback

  An agent states its intent once (user-story-shaped text); the returned
  int_… id joins every later call into one lineage: declared intent →
  deliveries → fulfillment. Registration is ALWAYS-NEW — identical wording
  from two sessions must never merge their delivery ledgers. The ledger is
  rendering-only: delivered recipes collapse to id-stubs, ranking never
  changes.

  Scenario: Cold-starting agent declares its intent at briefing time
    Given a fresh MCP-capable agent starting a task
    When it calls get_briefing with its task story as the intent param
    Then the briefing acknowledges "Intent registered: int_…"
    And the agent passes that id on its subsequent checks, searches, and feedback

  Scenario: Delivered recipes stop costing tokens against the same intent
    Given an agent carrying an intent id whose earlier check delivered recipes in full
    When a later check or search would surface those same recipes
    Then they render as id-stubs (or yield their display slot) — never full text again
    And the display budget walks down to unseen recipes instead

  Scenario: Context compaction recovers safely
    Given an agent that lost its intent id to context compaction
    When it re-sends its intent story text
    Then a FRESH intent registers (new id, empty ledger) and full recipe text returns
    And nothing from the lost intent's ledger suppresses or stubs its results

  Scenario: Sub-agents isolate by default
    Given an orchestrator holding an intent id, spawning a sub-agent with its own goal
    When the orchestrator writes the sub-agent's brief
    Then it does not pass its own intent id; the sub-agent states its own intent text
    And the two ledgers never cross-stub

  Scenario: Feedback closes the declared loop
    Given an agent whose intent-joined check shaped a decision
    When it logs feedback about that check
    Then the row carries the intent_id (inherited on ride-along rows, explicit on log_feedback)
    And the feedback surface never registers an intent from text

  Scenario: An unrecognized intent id degrades honestly
    Given an agent presenting an intent id that is unknown or belongs to another user
    When it makes a check or search with that id
    Then the call succeeds untracked with a notice that the id was not recognized (unknown and not-yours indistinguishable)
    And the agent re-registers by sending its story text
