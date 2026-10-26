Feature: Organization accounts: membership, disable, org-wide books, and joining
  # Plan: docs/planning/org-accounts-program.md (§0 decisions and settled
  # simplifications, §3.1, §3.5, §3.8, §3.10) and
  # docs/planning/org-accounts-round-1.md. Rubric and build notes:
  # docs/planning/org-accounts-build/core.md (stream Core).
  # User stories: docs/design-thinking.md archetype 6 (The Organization
  # Member) and archetype 7 (The Org Admin).
  # Realized as Layer 3 tests in apps/backend/src/routes/org-core.test.ts.
  #
  # Vocabulary used below:
  #   "Sys"    the site operator (system role)
  #   "Acme"   a company organization
  #   "Olive"  Acme's owner, an existing account Sys names
  #   "Ada"    an Acme admin
  #   "Max"    an Acme member who had an account before Acme existed
  #   "Gus"    a personal account outside Acme
  #   "the uniform 404"  the body returned for an organization id that doesn't
  #                      exist; nothing in status or body differs

  # ─────────────────────────────────────────────────────────────────────────
  Rule: The site operator starts an organization, and every arrival goes through one join
    # Guards: design-thinking.md archetype 7 "Starting an organization";
    # settled simplification "same setup path as a new user, plus linking
    # their books"; recipes 42044de1, 4da95a34.

    @ORG-SETUP-01
    Scenario: Creating an organization makes its default book and joins its owner
      # Requirement: C01-R01, C01-R07
      When Sys creates Acme naming Olive as its owner
      Then Acme has a default recipe book that is org-wide
      And Olive owns it, with it included in her daily agent links
      And Olive's own recipe books are now in Acme, with the same ids
      And Olive's GET /auth/me names Acme and her role, owner

    @ORG-JOIN-01
    Scenario: An existing account's own books move under the company; shared books stay put
      # Requirement: C01-R12
      Given Max has a Personal book and is a member of a book Gus shares with him
      And Max holds a scoped key over both
      When Sys adds Max to Acme
      Then Max's Personal book is in Acme, and its slug changes only if Acme already uses it
      And Gus's book is still in Gus's organization
      And Max's key reaches exactly the books it reached before
      And Max holds a membership in every org-wide Acme book

    @ORG-JOIN-02
    Scenario: An account that existed before the join is told
      When Sys adds Max to Acme
      Then the join's audit row records that a notice is owed
      And the email log records the notice as sent or failed

    @ORG-JOIN-03
    Scenario: An account joins one organization once
      Given Max is in Acme
      When Sys adds Max to Acme, or to another organization
      Then the join is refused as already_a_member, or already_in_an_organization

    @ORG-JOIN-04
    Scenario: The join checks its own authority
      # The join moves a person's corpus into the company, so it never fires on a caller's say-so.
      When the join is asked for by an account that is not the site operator
      Or under a domain the organization has not verified
      Or under a domain that is not the account's email domain
      Then it is refused and nothing changes

    @ORG-SEAT-01
    Scenario: Seats count active members
      # Requirement: research plan Q7 (disabled members don't take a seat)
      Given Acme's seat limit is 2 and Olive and Max are members
      When Sys adds a third person
      Then the join is refused: "This organization has no free seats. Ask one of its admins."
      When Max is disabled, the third person can join
      And re-enabling Max is then refused the same way
      And two joins racing for the last seat can't both succeed

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Disable is a join at validation, reversible, and kept apart from site suspension
    # Guards: design-thinking.md archetype 6 "Switched off, and back on",
    # archetype 7 "Switching someone off", "Not mine to set"; recipes
    # 92b866ee, 85a7b2e8.

    @ORG-OFF-01
    Scenario: Disabling a member refuses every credential they hold
      # Requirement: C01-R03, C01-R09
      Given Max holds a daily key, a scoped key and an OAuth connection
      When Ada disables Max
      Then each key gets exactly the response an unknown key gets
      And his OAuth refresh is refused and the refresh token is not consumed
      And his sessions get 403 account_disabled, "Your organization has disabled this account. Ask one of its admins to turn it back on."
      And signing in with his correct password gets the same refusal
      And no key row has changed

    @ORG-OFF-02
    Scenario: Re-enabling restores the same credentials
      Given Ada disabled Max
      When Ada re-enables Max
      Then the same keys, session and refresh token work again, with nothing re-minted

    @ORG-OFF-03
    Scenario: An org admin can't lift a site suspension
      Given Sys has suspended Max
      When Ada re-enables Max in Acme
      Then Max is still refused, with "This account is suspended. Contact Soup.net support."
      When Sys lifts the suspension, Max's keys and sign-in work again

    @ORG-OFF-04
    Scenario: Sessions issued before the account's cut-off are refused
      # For account linking (stream SSO), which discards an unverified password.
      Given a session issued before Gus's sessions_valid_after
      Then it gets 401 session_expired
      And a session issued after it works

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Org owners and admins manage members, and nobody outside learns who is in
    # Guards: design-thinking.md archetype 7 "Roles".

    @ORG-ROLE-01
    Scenario: A role change rewrites org-provenance roles only
      When Olive makes Max an admin
      Then Max holds the admin role on Acme's org-wide books
      And a book role Max was granted directly is unchanged

    @ORG-ROLE-02
    Scenario: The role rules
      Then an admin can't disable or re-role an owner, or make someone an owner
      And nobody disables themselves or changes their own role
      And a disabled admin can't act at all

    @ORG-ROLE-03
    Scenario: Outside callers get the uniform 404
      When Gus asks to disable Max in Acme
      Or anyone names an organization id that doesn't exist, a malformed id, or a user outside Acme
      Then each gets the uniform 404, byte for byte

  # ─────────────────────────────────────────────────────────────────────────
  Rule: A managed account's books stay with the company
    # Guards: design-thinking.md archetype 6 "Private or org-wide", "Mine to
    # delete, or the company's"; recipes 2301b5eb, 2e1e4624, draft 1c7621d2.

    @ORG-BOOK-01
    Scenario: New books land in the account's home organization
      # Requirement: C01-R07
      When Max creates a recipe book without naming an organization
      Then it is in Acme
      And Gus's new book is in Gus's personal organization
      And Max naming Gus's organization, or his own emptied personal one, is refused
      And Gus, a guest of one of Acme's books, naming Acme is refused

    @ORG-BOOK-02
    Scenario: An org-wide book reaches every member
      # Requirement: C01-R06
      When Max creates an org-wide book
      Then Olive and Ada hold it as admins, and later members hold it as members

    @ORG-BOOK-03
    Scenario: Making a book private keeps only direct grants
      Given Gus was invited directly to an org-wide book
      When Ada makes it private
      Then Gus and Max keep their access and Ada's org-provenance row is gone
      And the default book can't be made private, and a personal organization's book can't be org-wide

    @ORG-KEY-01
    Scenario: A managed account's scoped keys last at most 90 days
      When Max asks for a scoped key that lasts 120 days
      Then it is refused as key_lifetime_cap, naming 90 days
      And an 80-day key is minted, and Gus's 120-day key is minted

    @ORG-DEL-01
    Scenario: A managed account can't delete itself
      When Max deletes his account with his correct password
      Then it is refused with 409 managed_account, "Your organization manages this account. Ask one of its admins."
