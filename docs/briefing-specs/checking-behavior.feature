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

  Scenario: A rated check uses the rating vocabulary and leaves out a rating it has no view on
    # Guards: MCP_PARAM_DESCRIPTIONS.impact and .uncertainty, and the briefing's "How to check" ratings clause (recipe-guide-content.ts); docs/planning/drafts-and-triage.md §Triage ratings; spec-decision-log.md 2026-09-27 (drafts-and-triage slice 1). Out of @unreleased with drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1): the briefing body now teaches rating.
    When the agent makes a check where it has a view on how much rides on the call but none on how sure it is of the person's position
    Then any rating it sends on check_recipe is one of "low", "medium", or "high"
    And it sends impact and leaves uncertainty out, rather than sending uncertainty "medium" as a default

  Scenario: An agent drafts only a call it cannot stand behind, and a person's call it keeps working on becomes a draft it owns
    # Guards: the briefing's "## Drafts" section (BRIEFING.build, recipe-guide-content.ts); recipes 5d76a576 (a draft is a hypothesis the agent cannot yet stand behind), 31b80b8b (ask when the call is a person's and they are reachable), and 0d63d839 (the recommendation goes in as a draft the asker resolves; operator direction of 2026-10-24); docs/planning/drafts-and-triage-slices-6-7-revision.md §7a. Rewritten and out of @unreleased with drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1); it replaces "An agent drafts only when it cannot ask", whose absence framing the field read literally.
    Given a person whose call it is is reachable in the conversation
    When the agent faces a high-impact, uncertain call about that person's taste and judgment
    Then it settles the call from the context it holds and checks it as an ordinary recipe, or asks that person plainly with its recommendation and reasoning, or presents divergent options
    And if it keeps working while the question is open, it deposits that recommendation as a draft under its intent
    And it does not park a draft for a person to settle later in place of asking
    When the agent cannot settle the call from its context and the call is not one to put to a person now
    Then it checks the recipe with draft set to true
    And the first evidence entry's interpretation says why it is a draft rather than a check, and what would settle it
    And the interpretation does not give a person's absence as the reason for drafting

  Scenario: An agent that deposited drafts hands its person the queue link rather than listing ids
    # Guards: draftDepositNotice (packages/domain/src/drafts.ts), the queue link it carries; docs/planning/drafts-and-triage.md §Verifying a draft ("Links"); spec-decision-log.md 2026-09-27 (drafts-and-triage slice 3). Out of @unreleased with drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1): the briefing body now teaches drafting.
    Given the agent deposited drafts during a session its person was away for
    When the person returns and the agent reports what it left open
    Then it gives the person one review-queue link naming those drafts (/app/drafts?ids=…)
    And it does not ask the person to look the drafts up by id in prose

  Scenario: A briefed agent records a colleague's judgment as a draft on their behalf and hands over their review link
    # Guards: MCP_PARAM_DESCRIPTIONS.onBehalfOf (recipe-guide-content.ts), the on-behalf deposit notice (packages/domain/src/drafts.ts); docs/planning/drafts-and-triage.md §The model; spec-decision-log.md 2026-09-27 (drafts-and-triage slice 4). Out of @unreleased with drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1): the briefing body now teaches drafting.
    Given the agent is reading a colleague's own artifacts that record a decision the colleague made
    When it records that decision
    Then it checks the recipe with on_behalf_of set to the colleague's email, in the colleague's functional role
    And its evidence quotes the colleague's own words from those artifacts
    And it hands its person the colleague's review link from the response, rather than calling the draft verified

  Scenario: An agent resolves a draft once a reply or the work settles it
    # Guards: the briefing's "## Drafts" section, "A draft is yours to resolve"; recipes 200ed4fe (an agent ratifies drafts "in the exact same way that it can make recipe checks autonomously if it's confident in the same ways") and 0d63d839; docs/planning/drafts-and-triage-slices-6-7-revision.md §7a ("A draft is yours to resolve"); drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given an open draft about a person, deposited by this agent or another of that person's agents, whose first evidence entry names what would settle it
    And that settling fact has since reached the agent (the person's reply in another channel, a file, a decision recorded elsewhere, a verified recipe covering the same call)
    When the agent comes back to the draft
    Then it calls verify_draft with an outcome that matches the settling fact (verified, rejected, or not chosen), quoting the person's words or the fact and citing where they were given
    And it does not leave the draft for a person's click

  Scenario: A draft lives while its task does, and an open question named near a call is answered when the agent's context settles it
    # Guards: the briefing's "## Drafts" section ("A draft is a question on a bus: it stays live while your intent is in use, and expires once your task goes quiet."); the dispatch line in check and search responses ("Open question near this call: … If your context settles it, resolve it; otherwise leave it."); docs/planning/drafts-and-triage-slices-6-7-revision.md §A proposed slice 10 (ruled 2026-10-25, recipe 053c9b97); drafts-and-triage slice 10 (build log §Slice 10 rubric, S10-C3; spec-decision-log.md 2026-10-25, slice 10).
    Given an agent that deposits a draft during a task
    Then it carries the intent its briefing or first check returned on its later calls, so the draft stays live while the task runs
    And when a check or search names an open question near its call that its own context settles, it resolves it with verify_draft, quoting what settles it
    And when its context does not settle that question, it leaves it and does not deposit a duplicate

  Scenario: A returned recipe is weighed as a call made in its own context, not applied as a rule
    # Guards: the briefing's "## Reading results" section; docs/planning/drafts-and-triage-slices-6-7-revision.md §7d item 1 and field item 7; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given a check returns a closely matching recipe recorded in a different context from the current task
    When the agent uses it in its reasoning or its reply
    Then it says how that recipe applies to the current situation ("in their context they chose X")
    And it does not call the recipe "the rule", or treat it as settling the current call without weighing the difference in context

  Scenario: A familiar judgment in a new context is logged, not skipped as already recorded
    # Guards: the briefing's "## Reading results" section ("A familiar judgment in a new context is worth logging"); drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given the agent holds a judgment the person has made before, and a check returns that earlier recipe
    When the same judgment comes up in a new context
    Then the agent checks a recipe for the new instance with the new context as evidence
    And it does not skip the check on the ground that a similar recipe already exists

  Scenario: Extending something that already has a default is checked as a call
    # Guards: WORKFLOW_WHEN, the "already has a default" moment; recipe 72f788bf; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given the agent is extending a component whose existing behavior allows (or refuses) everything no rule matches
    When it writes the extension
    Then it checks what should happen when nothing matches before writing that behavior into the extension

  Scenario: Writing for a particular reader is checked before the first version is written
    # Guards: WORKFLOW_WHEN, the "particular reader in a particular place" moment; docs/planning/drafts-and-triage-slices-6-7-revision.md §7d item 2; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given the agent is asked to write a document for a named kind of reader in a named place
    When it begins
    Then it checks or searches for that reader's preferences before producing the first version

  Scenario: An instruction that pulls against the agent's judgment is checked, then followed
    # Guards: WORKFLOW_WHEN, the instruction-versus-judgment moment; docs/planning/drafts-and-triage-slices-6-7-revision.md §7d item 5; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given the person's instruction conflicts with what the agent judges right for the person's goal
    When the agent proceeds
    Then it checks the call it judges right, with the instruction quoted in the evidence
    And it then proceeds with the work rather than stopping to argue

  Scenario: The agent's own open draft is not read as support
    # Guards: the briefing's "## Reading results" section (own open draft); docs/planning/drafts-and-triage-slices-6-7-revision.md §7d item 6; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given a check returns, as its nearest neighbor, an unverified draft the same agent deposited earlier in the session
    When the agent reports what the check found
    Then it names that recipe as its own earlier assumption
    And it does not count it as evidence that the person holds the position

  Scenario: A probe of the corpus is made as a search
    # Guards: the briefing's "Search vs check" paragraph (probing the corpus is a search); docs/planning/drafts-and-triage-slices-6-7-revision.md §7d item 7; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    When the agent wants to see what the corpus holds on a topic, or how a role phrasing clusters
    Then it calls search_recipes (or the check page's filter)
    And it does not call check_recipe with a probe recipe

  Scenario: Thin results lead to more checks, not a stretched match
    # Guards: the check response's empty-result line (check-response-renderer.ts); recipe b7e90f25; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-24, C1).
    Given a check in the current context returns no similar recipes, or only distant ones
    When the agent continues the task
    Then it checks its subsequent calls in that area rather than fewer
    And it does not present a distant result as settling the call

  Scenario: An orchestrator resolves the drafts its own context settles
    # Guards: the briefing's "## Drafts" section, the over-caution example ("An orchestrator once refused to verify drafts its own context settled"); revision commit a7f4d20 (7a and 7d); expanded/slice-7.md chunk slice7.over-caution-example; S7-B6; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-25, C2).
    Given an orchestrator whose sub-agents deposited drafts under its intent during a run
    And the run's own results settle some of those drafts
    When the orchestrator finishes the run
    Then it resolves each settled draft with verify_draft, quoting the result or the person's words and citing where they are
    And it leaves for a person's click only the drafts nothing it holds settles

  Scenario: A refused parameter name is corrected, not read as an outage
    # Guards: "## How to check" ("An MCP tool refuses a parameter name it doesn't take, and the refusal names the ones it does"); stream D, slice 8a (PR #139); S7-B7; drafts-and-triage slice 7 (build log §Slice 7 rubric; spec-decision-log.md 2026-10-25, C2).
    Given an agent calls a tool with a parameter name the tool does not take
    When the tool refuses the call and names the parameters it does take
    Then the agent retries with one of the named parameters
    And it does not report the tool as unavailable
