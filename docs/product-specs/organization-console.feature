Feature: Organization accounts: the org admin console, sharing policy, and what admins can see
  # Plan: docs/planning/org-accounts-program.md (§2, §3.6, §3.7, §3.12) and
  # docs/planning/org-accounts-round-1.md. Rubric and build notes:
  # docs/planning/org-accounts-build/console.md (stream Console).
  # User stories: docs/design-thinking.md archetype 6 (The Organization
  # Member) and archetype 7 (The Org Admin).
  # Realized as Layer 3 tests in apps/backend/src/routes/org-console.test.ts,
  # with the rules as Layer 1 in packages/domain (admin-columns, sharing-policy,
  # org-activity).
  #
  # Vocabulary, as in organizations.feature:
  #   "Sys", "Acme", "Olive" (owner), "Ada" (admin), "Max" (member), "Gus" (outside)
  #   "Bea"    the admin of a second organization, Beta
  #   "the uniform 404"  Core's body for an organization id that doesn't exist

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Only an organization's active owners and admins can read its console
    # Guards: archetype 7 "Seeing my users"; recipes 57fc1eee, 1fa21e31.

    @ORG-CON-01
    Scenario: Everyone else gets the uniform 404
      # Requirement: C01-R12
      When Max, Gus, Bea and Sys each ask for Acme's members, books or activity
      Then each gets the uniform 404, byte for byte
      And so does a malformed organization id
      And Olive and Ada get Acme's answer

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Admins see aggregates, never private book names or contents
    # Guards: archetype 6 "Private by default"; archetype 7 "Seeing my users";
    # recipes 57fc1eee, 2738f7a9, e36bbef8.

    @ORG-CON-02
    Scenario: The member list carries the org column set and nothing else
      # Requirement: C01-R12
      Given Max has a private book named "max-secret-plans"
      And Max has one recipe in Acme's default book and one in a book Gus shares with him
      When Olive lists Acme's members
      Then every row has exactly the org column set
      And Max's recipe count is 1, counting only Acme's books
      And "max-secret-plans" appears nowhere in the response
      And filtering or sorting by a site-only column changes nothing

    @ORG-CON-04
    Scenario: Books show org-wide books by name and private ones only as totals
      When Olive opens Acme's books
      Then the default book is listed with its members and outsiders
      And private books appear only as a count, with no name or id

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Sharing outside the company is two settings, outbound and inbound
    # Guards: archetype 7 "Sharing policy"; archetype 6 (a personal book shared
    # into a work account); program §2; recipe 5c76b5ff.

    @ORG-SHARE-01
    Scenario: An owner or admin sets the policy
      When Ada sets outbound sharing to admins only
      Then Acme's policy is outbound admins only and inbound allowed
      And a value outside each setting's list is refused

    @ORG-SHARE-02
    Scenario: Outbound blocked stops everyone bringing outsiders in
      Given Acme's outbound sharing is blocked
      When Max or Ada invites Gus, or adds him directly, to a private or org-wide Acme book
      Then it is refused as sharing_blocked
      And an invitation Max sent Gus before the change can't be accepted, and stays pending
      And Ada can still add Max, a colleague, to her book

    @ORG-SHARE-03
    Scenario: Outbound admins only lets owners and admins share
      Given Acme's outbound sharing is admins only
      When Max invites Gus
      Then it is refused as sharing_blocked
      And when Ada invites Gus, the invitation is created

    @ORG-SHARE-04
    Scenario: Inbound blocked keeps Max out of outside books without telling Gus
      Given Acme's inbound sharing is blocked
      When Gus invites Max to Gus's book
      Then the invitation is created exactly as it would be otherwise
      And Max's accept is refused, telling him his organization doesn't allow it
      And Gus adding Max directly gets the same answer as for an email with no account

    @ORG-SHARE-05
    Scenario: Re-filing a recipe out of the company follows outbound
      Given Acme's outbound sharing is admins only
      When Max moves one of his recipes into Gus's book
      Then it is refused as sharing_blocked
      And once sharing is allowed again, the move goes through

    @ORG-SHARE-06
    Scenario: Tightening the policy removes nobody
      Given Gus belongs to Max's private book and to Acme's default book
      When Olive blocks both directions
      Then Gus still belongs to both
      And Acme's books show one outsider in the default book and one in private books

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Every admin action on an account is visible to the person it touched
    # Guards: archetype 7 "What the admin deliberately can't do"; program §3.6
    # (observability both ways); recipes e36bbef8, 6c5c04e8 (draft).

    @ORG-CON-05
    Scenario: Activity lists admin actions only, and never metadata
      Given Sys added Max, Max checked a recipe, Ada disabled Max, and Olive made Ada a member
      When Olive opens Acme's activity
      Then she sees the join by "Soup.net", the disable by Ada and the role change by Olive
      And Sys's email, Max's checks, and the moved books' names appear nowhere

    @ORG-CON-06
    Scenario: The member's own page names their organization and what was done to them
      Given Ada disabled and re-enabled Max
      When Max opens "What your organization's admins can see"
      Then it names Acme, his role and the sharing policy
      And it lists his join, the disable and the re-enable
      And Gus, a personal account, has no organization there

    @ORG-CON-07
    Scenario: Sign-ins are the person's own
      When Max signs in twice
      Then his page lists both, with the time and "password" only
      And neither Acme's member list nor its activity carries a sign-in
