Feature: Drafts, triage ratings, and deciding by building both
  # Design: docs/planning/drafts-and-triage.md. Build log, slice plan, and
  # rubrics: docs/planning/drafts-and-triage-build.md. Read-path checklist:
  # docs/planning/drafts-and-triage-read-paths.md.
  # User stories: docs/design-thinking.md §Agent Type A, §Agent Type D
  # (headless keys), §Reviewing drafts, §Divergent Recipe Checks (When the
  # person can't be asked), §Decision Archaeology.
  #
  # Vocabulary used below:
  #   "Pat"      the person a recipe is about; owns the key "Pat's agent"
  #   "Sam"      a collaborator: a member of the same recipe book with read access
  #   "Dana"     another person whose agent deposits a draft about Pat (slice 4)
  #   "the book" a shared recipe book all three belong to, readable and writable
  #   "uniformly absent"  the response is the one returned for an id that never
  #                       existed; nothing in status, body shape, timing-free
  #                       fields, counts, or error text differs

  Background:
    Given Pat, Sam, and Dana are members of the book with read and write access
    And each has an ordinary API key scoped to read and write the book

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Triage ratings are recorded and returned, and never touch ranking
    # Guards: drafts-and-triage.md §Triage ratings; Decisions row "Impact and
    # uncertainty are recorded as two separate optional ratings"; recipe
    # ff54eafd (self-reports are unsafe as a relevance signal); the standing
    # "context shapes rendering, never ranking" rule.

    @DT-RAT-01 @slice-1
    Scenario: A check records impact and uncertainty
      When Pat's agent checks a recipe with impact "high" and uncertainty "medium"
      Then the check succeeds
      And the response echoes impact "high" and uncertainty "medium" for the deposited recipe
      And the stored recipe carries impact "high" and uncertainty "medium"

    @DT-RAT-02 @slice-1
    Scenario: Omitted ratings mean not rated
      When Pat's agent checks a recipe without impact or uncertainty
      Then the check succeeds
      And the stored recipe's impact and uncertainty are both not rated (null), not "medium"
      And the response reports both as not rated

    @DT-RAT-03 @slice-1
    Scenario: Ratings are independent of each other and of draft
      When Pat's agent checks a recipe with impact "high", uncertainty "low", and no draft flag
      Then the recipe is stored as not a draft with impact "high" and uncertainty "low"
      And no rating value, alone or combined, changes whether the recipe is a draft

    @DT-RAT-04 @slice-1
    Scenario: An unrecognized rating value never costs the check
      # Guards: capture-only leniency, recipes abddb65d and 4cfd166e.
      When Pat's agent checks a recipe with impact "urgent"
      Then the check succeeds and the recipe is deposited
      And the stored impact is not rated
      And the response carries a notice naming the accepted values "low | medium | high"

    @DT-RAT-05 @slice-1
    Scenario Outline: Ratings are accepted on every check surface
      When Pat's agent checks a recipe with impact "low" through <surface>
      Then the stored recipe carries impact "low"
      Examples:
        | surface                                   |
        | the remote MCP check_recipe tool          |
        | GET /check with format=json               |
        | POST /check with a JSON body              |
        | the /check HTML form                      |
        | the stdio MCP server's check_recipe proxy |

    @DT-RAT-06 @slice-1
    Scenario: Ratings never change ranking for the checking agent
      Given a fixed corpus in the book
      When Pat's agent makes two checks that differ only in their impact and uncertainty values, from two different keys so neither hits idempotency
      Then both responses list the same result ids in the same order with the same similarity scores

    @DT-RAT-07 @slice-1
    Scenario: Ratings on corpus recipes never change how they rank for others
      Given two otherwise-identical recipes in the book, one rated impact "high" and uncertainty "high" and one not rated
      When Sam's agent checks or searches with a query equidistant from both
      Then their relative order is the order an unrated pair would get
      And no ranking, clustering, or MMR code path reads the impact or uncertainty columns

    @DT-RAT-08 @slice-1
    Scenario: A repeat of an identical check keeps the first ratings
      # Decided: build log §Orchestrator rulings, open question 4 (first write wins; the repeat gets a notice).
      Given Pat's agent checked a recipe with impact "low"
      When the same key checks the identical recipe text in the same book with impact "high"
      Then the response returns the existing recipe id and reports it as an existing recipe
      And the stored impact is still "low"
      And the response carries a notice that the repeat's ratings were not applied

    @DT-RAT-10 @slice-1
    Scenario: The check's impact rating and a feedback row's impact never cross
      # Guards: feedback rows already carry an `impact` field with a different
      # vocabulary (none | new | subtle | big | operational). See build log
      # §Open design questions, "Two fields named impact".
      When Pat's agent checks a recipe with impact "high" and a ride-along feedback row with impact "new"
      Then the deposited recipe's impact is "high"
      And the feedback row's impact is "new"
      When a web agent calls GET /check with impact=high and feedback_impact=new
      Then the same two values are stored in the same two places

    @DT-RAT-09 @slice-1
    Scenario: The person sees ratings on the recipe's detail page
      Given Pat's agent checked a recipe with impact "high" and uncertainty "high"
      When Pat opens the recipe's detail page
      Then the impact and uncertainty are shown as the agent's ratings, with no claim that they are the person's own assessment

  # ─────────────────────────────────────────────────────────────────────────
  Rule: The tool roster gets smaller while gaining the ratings
    # Guards: drafts-and-triage.md §Parameters and tool-description size;
    # recipes a4a67850 (affordance-sized descriptions) and 8dd573b4 (the
    # budget test is raised or lowered deliberately, never silently);
    # 5c55327d (deprecated-but-honored posture).

    @DT-TOOL-01 @slice-1
    Scenario: The served tools/list payload shrinks net
      Given the baseline tools/list byte size recorded in the build log's slice-1 rubric
      When a client calls tools/list on the remote MCP endpoint after slice 1
      Then the payload, serialized as served, is at or below the slice-1 target in bytes
      And check_recipe's input schema lists impact and uncertainty

    @DT-TOOL-02 @slice-1
    Scenario Outline: A deprecated parameter shrinks to a pointer and is still honored
      # Decided: build log §Orchestrator rulings, open question 1 (keep the
      # parameter declared; recipe cee8fb2d). The MCP SDK strips keys a tool's
      # schema doesn't declare, so a parameter absent from the schema is
      # silently ignored, not honored (mcp.ts comment on clusters/max_chars;
      # mcp-tool-descriptions.test.ts asserts both stay declared). The
      # recommended form keeps the property with a one-line deprecation
      # pointer as its whole description.
      When a client calls tools/list on <server>
      Then <param>'s description on check_recipe is at most one line naming its replacement, verbosity
      When a client calls check_recipe on <server> with <param> set to a valid value
      Then the call succeeds and <param> has the same effect it had before slice 1
      Examples:
        | server             | param     |
        | the remote server  | clusters  |
        | the remote server  | max_chars |
        | the stdio server   | clusters  |
        | the stdio server   | max_chars |

    @DT-TOOL-03 @slice-1
    Scenario: Ride-along feedback keeps every field while its schema shrinks to a pointer
      When a client calls tools/list
      Then the feedback parameter on check_recipe and search_recipes no longer repeats log_feedback's per-field schema
      And its description points to log_feedback for the row fields
      When a client sends a feedback row with every field log_feedback accepts on check_recipe, and again on search_recipes
      Then every field is stored exactly as it would be through log_feedback
      # This is the guard for the pointer's item schema: a bare object item
      # schema would let the SDK strip every row field before the handler sees it.

    @DT-TOOL-04 @slice-1
    Scenario: The shared-copy budget test moves down, not up
      Then the character budget asserted in the MCP tool-description budget test is lower than before slice 1
      And the stdio MCP server's tool descriptions come from the same shared constants as the remote server's

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: A draft is visible only to the person it is about, their agents, and its depositor
    # Guards: drafts-and-triage.md §The model ("One visibility rule covers
    # every draft"); recipes 94e0e682 and 84e6bc9f; engineering-principles.md
    # §7 (one condition in the authz module). Checklist of surfaces:
    # drafts-and-triage-read-paths.md.

    @DT-VIS-01 @slice-2
    Scenario: A check can deposit a draft
      When Pat's agent checks a recipe with draft true
      Then the check succeeds and the recipe is stored as a draft about Pat, deposited by Pat's key
      And the response labels the deposited recipe as a draft and says who can see it until it is verified

    @DT-VIS-02 @slice-2
    Scenario: A draft never appears in a collaborator's check or search results
      Given Pat's agent deposited a draft in the book
      When Sam's agent checks a recipe with the draft's exact text, or searches with that text, a quoted phrase from its evidence, or author:<Pat's email>
      Then the draft's id appears nowhere in the response: not in results, exemplars, cluster member lists, related evidence, or id stubs
      And every count in the response (total results, cluster sizes, "represents N similar") is the count the corpus would give without the draft

    @DT-VIS-03 @slice-2
    Scenario: A draft's evidence never surfaces as related evidence for others
      Given Pat's agent deposited a draft whose evidence is distinctive
      When Sam's agent checks a recipe whose text matches that evidence closely
      Then no related-evidence entry quotes or cites the draft's evidence or names the draft's id

    @DT-VIS-04 @slice-2
    Scenario Outline: A draft is uniformly absent by id for a collaborator
      Given Pat's agent deposited a draft
      When Sam uses <surface> with the draft's id
      Then the response is uniformly absent
      Examples:
        | surface                                                   |
        | get_recipes (MCP) with the full id                        |
        | GET /recipes?ids= with the full id                        |
        | get_recipes with an 8-character prefix of the id          |
        | GET /traces/:id in the SPA                                |
        | GET /traces/:id/feedback                                  |
        | PUT /traces/:id/reaction                                  |
        | log_feedback with trace_id set to the draft's id          |
        | get_briefing with recipe_ids naming the draft             |

    @DT-VIS-05 @slice-2
    Scenario: An ambiguous short-id prefix never names a hidden draft
      # Guards: recipe 507d3c9c (the prefix resolver mirrors the by-id posture).
      Given Pat's draft and a visible recipe share an 8-character id prefix
      When Sam's agent resolves that prefix through get_recipes or feedback
      Then the prefix resolves to the visible recipe alone, as if the draft did not exist
      And no candidate list includes the draft's id

    @DT-VIS-06 @slice-2
    Scenario: The person's own agents see their drafts, labelled
      Given Pat's agent deposited a draft
      When any of Pat's keys with read scope on the book checks near the draft, or searches near it with author:me or author:anyone (search excludes the caller's own recipes by default)
      Then the draft can appear in results, ranked exactly as it would be if it were not a draft
      And each appearance is labelled as a draft in both the markdown and structured formats

    @DT-VIS-07 @slice-2
    Scenario: Drafts never widen a key's scope
      Given Pat's agent deposited a draft in the book
      And Pat holds a second key with no read scope on the book
      When that second key checks or searches near the draft
      Then the draft is uniformly absent

    @DT-VIS-08 @slice-2
    Scenario Outline: Aggregate surfaces exclude drafts
      Given Pat's agent deposited a draft in the book
      When <viewer> loads <surface>
      Then the draft contributes nothing to it: no point, no cluster membership, no count, no exemplar
      Examples:
        | viewer        | surface                                                    |
        | Sam's agent   | get_briefing, including the per-book Index line and exemplars |
        | Sam           | the recipe map and its clusters for the book               |
        | Pat           | the recipe map and its clusters for the book               |
        | Sam           | the SPA recipe list and dashboard counts for the book      |
        | Sam's agent   | /health/integrity                                          |

    @DT-VIS-09 @slice-2
    Scenario: The person's own briefing counts drafts separately
      # Pending decision: see build log §Open design questions, "Counts, dates, and exemplars".
      Given Pat's agent deposited two drafts in the book
      When Pat's agent calls get_briefing
      Then the book's Index count equals the count of non-draft recipes
      And a separate line tells Pat's agent that two drafts await Pat's review

    @DT-VIS-10 @slice-2
    Scenario: The person's data export includes their drafts, marked
      Given Pat's agent deposited a draft
      When Pat exports their data
      Then the export contains the draft with its draft state
      When Sam exports their data
      Then Sam's export does not contain Pat's draft

    @DT-VIS-11 @slice-2
    Scenario: Drafts are embedded but every vector query filters them
      Given Pat's agent deposited a draft
      Then the draft's trace and evidence embeddings are created as for any recipe, so verification needs no re-embedding
      And every statement that reads embeddings for results, clusters, related evidence, or the map applies the draft visibility condition from the authz module
      And the count, the approximate-nearest-neighbour query, and the exhaustive fallback in semantic search apply the same condition, so a collaborator's totalResults never counts the draft

    @DT-VIS-12 @slice-2
    Scenario: Re-checking a draft's text as a non-draft from the same key does not publish it
      # Pending decision: see build log §Open design questions, "Idempotency and drafts".
      Given Pat's agent deposited a draft
      When the same key checks the identical text in the same book without the draft flag
      Then the response returns the existing recipe's id, reports it as existing and still a draft
      And the response says how to verify it
      And the recipe is still a draft, visible to no collaborator

    @DT-VIS-13 @slice-2
    Scenario: Moving a draft to another book keeps it a draft
      Given Pat's agent deposited a draft in the book
      When Pat moves it to another book Pat can write to
      Then it is still a draft, and Sam cannot see it in either book

    @DT-VIS-15 @slice-2
    Scenario: Move and delete reveal nothing about a draft to anyone else
      # Guards: read-path inventory RP-23 (today: 403 for "exists, not yours",
      # and a book owner or admin passes the delete gate for others' recipes).
      Given Pat's agent deposited a draft in the book, and Sam is the book's owner
      When Sam, or any non-member holding the id, tries to move or delete the draft
      Then the response is the 404 returned for an id that never existed
      And the draft is unchanged

    @DT-VIS-16 @slice-2
    Scenario: Export and import keep a draft a draft
      Given Pat exported data containing a draft
      When Pat imports that export
      Then the imported recipe is still a draft, with its ratings

    @DT-VIS-17 @slice-2
    Scenario: A person's own drafts are not briefing exemplars
      Given Pat's agent deposited a draft
      When Pat's agent calls get_briefing with exemplars opted in
      Then the draft is not an exemplar and not counted in any exemplar's cluster size

    @DT-VIS-18 @slice-2
    Scenario: Book index dates don't move for a collaborator's draft
      Given the book's Index line for Sam's agent shows a newest-judgment date and a last-logged date
      When Pat's agent deposits a draft in the book
      Then the Index line Sam's agent receives is unchanged, dates included

    @DT-VIS-14 @slice-2
    Scenario: The visibility rule lives in one place and is statically guarded
      Then the draft visibility condition is defined once in apps/backend/src/authz/
      And the authz seam guard fails when a source file outside the module reads the traces table in a statement that neither uses the module's condition nor is registered with a reason

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: A draft is verified by its person, or by their agent with the person's own words
    # Guards: drafts-and-triage.md §Verifying a draft; recipe 94e0e682 (agents
    # may update some surfaces; verification by the person or an agent under
    # their control).

    @DT-VER-01 @slice-2
    Scenario: The person confirms a draft with still true
      Given Pat's agent deposited a draft
      When Pat reacts still_true on the draft
      Then the draft is verified, recording when and that Pat verified it through a reaction
      And Sam's agent can now find it in check and search results like any recipe

    @DT-VER-02 @slice-2
    Scenario: The person rejects a draft with wrong
      Given Pat's agent deposited a draft
      When Pat reacts wrong on the draft
      Then the draft is rejected: it stays invisible to collaborators and leaves Pat's review queue
      And Pat's own agents no longer see it in results

    @DT-VER-03 @slice-2
    Scenario: Verification is an event, not a live reaction
      Given Pat verified a draft by reacting still_true
      When Pat clears or changes that reaction
      Then the recipe stays verified
      And the reaction change is recorded like any other reaction

    @DT-VER-04 @slice-2
    Scenario: The person's agent verifies with the person's answer quoted
      Given Pat's agent deposited a draft
      When one of Pat's keys verifies it with a new evidence entry: an interpretation, a verbatim quote of Pat's answer, and a citation
      Then the draft is verified, recording when, which key, and that it was verified by an agent
      And the new evidence entry is attached to the recipe
      And Sam's agent can now find it

    @DT-VER-05 @slice-2
    Scenario: Agent verification without new evidence is refused
      Given Pat's agent deposited a draft
      When one of Pat's keys verifies it with no evidence, or with evidence that lacks a quote or a citation
      Then the verification is refused with an error that says what evidence is needed
      And the recipe is still a draft

    @DT-VER-06 @slice-2
    Scenario: The depositing agent cannot verify its own draft with nothing new
      Given Pat's agent deposited a draft with evidence E
      When the same key verifies it with evidence identical to an entry of E
      Then the verification is refused and the recipe is still a draft

    @DT-VER-07 @slice-2
    Scenario Outline: Only the person's side can verify
      Given Pat's agent deposited a draft
      When <actor> attempts to verify it
      Then the response is uniformly absent and the recipe is still a draft
      Examples:
        | actor                                  |
        | Sam reacting still_true                |
        | Sam's agent calling the verify operation |

    @DT-VER-08 @slice-2
    Scenario: Verifying a recipe that is not a draft changes nothing
      Given a recipe of Pat's that is not a draft
      When one of Pat's keys calls the verify operation on it
      Then the call reports that the recipe is not a draft and stores nothing

    @DT-VER-09 @slice-2
    Scenario: Verification leaves ratings and ranking inputs untouched
      Given Pat's agent deposited a draft rated impact "high"
      When the draft is verified
      Then its impact is still "high"
      And the recipe's text, embeddings, and judgment date are unchanged

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: The review queue is the human search page, sorted for triage
    # Guards: drafts-and-triage.md §Build notes; design-thinking.md §Reviewing
    # drafts, §Dashboard as a Feed.
    # Requirement: C01-R15 ("The review experience should share the human search page")

    @DT-QUE-01 @slice-3
    Scenario: The drafts filter shows only drafts the viewer may see
      Given drafts about Pat, drafts Dana deposited about Pat, and drafts about Sam exist in the book
      When Pat opens the search page with the drafts filter
      Then Pat sees the drafts about Pat and none about Sam

    @DT-QUE-02 @slice-3
    Scenario: The queue sorts by impact, then uncertainty, unrated as medium
      Given Pat has drafts rated (high, high), (high, low), (low, high), and one not rated
      When Pat opens the drafts filter without another sort
      Then the order is (high, high), (high, low), the not-rated draft, (low, high)
      And ties are broken newest first

    @DT-QUE-03 @slice-3
    Scenario: impact: and uncertainty: narrow the queue
      When Pat searches drafts with impact:high
      Then only drafts rated impact "high" are listed; not-rated drafts are excluded

    @DT-QUE-04 @slice-3
    Scenario: The id-list link shows exactly the named drafts the viewer may see
      Given Pat's agent hands Pat /app/drafts?ids=<a>,<b>,<c> where c is Sam's draft
      When Pat opens it
      Then drafts a and b are listed and nothing indicates that c exists

    @DT-QUE-05 @slice-3
    Scenario: The queue shows why the agent couldn't ask
      Given a draft whose first evidence interpretation says why Pat couldn't be asked and what would settle it
      When Pat views the draft in the queue
      Then that interpretation is shown without opening the detail page

    @DT-QUE-06 @slice-3
    Scenario Outline: Queue actions
      When Pat chooses <action> on a draft in the queue
      Then the draft becomes <state> and leaves the queue
      Examples:
        | action      | state       |
        | confirm     | verified    |
        | reject      | rejected    |
        | not chosen  | not chosen  |

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: A draft may be deposited on behalf of another person, and is always a draft
    # Guards: drafts-and-triage.md §The model (table); recipe 94e0e682;
    # design-thinking.md §6 The Organization Member ("Drafts written about me"),
    # §Decision Archaeology.
    # Requirement: C01-R15

    @DT-OBO-01 @slice-4
    Scenario: On behalf of someone else forces draft
      When Dana's agent checks a recipe with on_behalf_of set to Pat's email and draft false
      Then the recipe is stored as a draft about Pat, deposited by Dana's key
      And the response says draft was forced because the recipe is on Pat's behalf

    @DT-OBO-02 @slice-4
    Scenario: The target must hold write access to the book
      When Dana's agent checks a recipe on behalf of an email that is not a member with write access to the target book
      Then the check is refused with one error that reads the same whether or not that email has an account

    @DT-OBO-03 @slice-4
    Scenario: A draft on someone's behalf is visible to them, their agents, and the depositor only
      Given Dana's agent deposited a draft on Pat's behalf
      Then Pat, Pat's agents, Dana, and Dana's agents can see it
      And Sam and Sam's agents find it uniformly absent

    @DT-OBO-04 @slice-4
    Scenario: The depositor cannot verify a draft about someone else
      Given Dana's agent deposited a draft on Pat's behalf
      When Dana reacts still_true, or Dana's agent calls the verify operation with evidence
      Then the recipe is still a draft

    @DT-OBO-05 @slice-4
    Scenario: On behalf of yourself is an ordinary check
      When Pat's agent checks a recipe with on_behalf_of set to Pat's own email
      Then the recipe is stored exactly as a check without on_behalf_of

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: A headless key deposits only drafts, and its derived keys inherit that
    # Guards: drafts-and-triage.md §Headless keys; recipe e263dc40;
    # design-thinking.md §Agent Type D (headless keys), §Orchestrators;
    # docs/planning/derived-agent-keys.md (derived keys only narrow).
    # Requirement: C01-R13 (drafts-only as one candidate write level for autonomous agents)

    @DT-HDL-01 @slice-5
    Scenario: Every deposit through a headless key is a draft
      Given Pat made a key marked headless
      When that key checks a recipe with draft false
      Then the recipe is stored as a draft
      And the response says draft was forced by the key's setting

    @DT-HDL-02 @slice-5
    Scenario: A derived key of a headless key cannot deposit a non-draft
      Given Pat made a key marked headless
      When that key derives a key for a sub-agent, asking for it not to be headless
      Then the derived key is headless
      And a check through the derived key with draft false is stored as a draft

    @DT-HDL-03 @slice-5
    Scenario: The headless setting is fixed when the key is made
      Given Pat made a key marked headless
      Then no API-key-authenticated operation can clear the setting
      And no JWT key-management operation clears it on the existing key; Pat makes a new key instead

    @DT-HDL-04 @slice-5
    Scenario: A headless key cannot verify drafts
      # Pending decision: see build log §Open design questions, "Headless verification".
      Given a draft about Pat
      When Pat's headless key calls the verify operation with evidence
      Then the verification is refused and the recipe is still a draft

    @DT-HDL-05 @slice-5
    Scenario: A headless key gets the headless briefing profile
      When Pat's headless key calls get_briefing
      Then the briefing is the headless profile, which covers drafting well, saying what would settle a draft, the triage ratings, and building both
      # Copy behavior belongs to docs/briefing-specs/ under the regression rule; this scenario pins only that the profile is selected.

    @DT-HDL-06 @slice-5
    Scenario: Headless keeps every other agent surface
      Given Pat made a key marked headless
      Then that key can declare intents, search, fetch recipes by id, and log feedback exactly as an ordinary key

  # ─────────────────────────────────────────────────────────────────────────
  @unreleased
  Rule: Option sets decide by building both against a rubric set in advance
    # Guards: drafts-and-triage.md §Deciding by building both; recipe ea930c3d;
    # docs/architecture/agent-context-seams.md gap 2 (recipe-to-intent link).

    @DT-OPT-01 @slice-6
    Scenario: Drafts deposited under one intent form a set
      Given Pat's agent declared an intent whose story names the choice and the rubric
      When it deposits two drafts carrying that intent
      Then both drafts are linked to that intent and listed together in Pat's queue

    @DT-OPT-02 @slice-6
    Scenario: Resolving a set verifies the winner and marks the rest not chosen
      Given an option set of two drafts under Pat's intent
      When the set is resolved in favour of option A, with evidence citing the rubric and the measurement
      Then A is verified and B is marked not chosen
      And not chosen is stored distinctly from wrong and from a still_true or wrong reaction

    @DT-OPT-03 @slice-6
    Scenario: A not-chosen option stays hidden like any draft
      Given option B was marked not chosen
      Then Sam finds B uniformly absent, including through the id cited in A's evidence
      And Pat and Pat's agents can still open B

    @DT-OPT-04 @slice-6
    Scenario: An agent may resolve a set only by citing a rubric the person gave
      Given an option set whose rubric appears only in the agent's own words
      When Pat's agent tries to resolve the set
      Then the set stays in Pat's queue with the measurements attached
      # How the server tells "the person's rubric" from "the agent's rubric" is
      # an open design question; see the build log.
