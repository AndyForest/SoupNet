Feature: Offboarding through the company's Google Workspace directory
  # Plan: docs/planning/org-accounts-program.md (§0 offboarding ruling
  # 3650aed9 and the settled simplifications, §3.9) and
  # docs/planning/org-accounts-round-1.md. Rubric and build notes:
  # docs/planning/org-accounts-build/offboarding.md (stream Offboarding).
  # User stories: docs/design-thinking.md archetype 6 (The Organization
  # Member) and archetype 7 (The Org Admin).
  # Realized as Layer 3 tests in apps/backend/src/routes/directory.test.ts,
  # against a fake Google Directory (apps/backend/src/test-google-issuer.ts).
  #
  # Vocabulary used below:
  #   "Acme"   a company organization with a verified domain, acme.example
  #   "Olive"  Acme's owner, a Workspace admin
  #   "Max"    an Acme member on max@acme.example
  #   "Rae"    an Acme member the operator added on another address
  #   "Mal"    someone on the domain whom the directory doesn't know
  #   "due"    Max's last successful check is more than an hour old
  #   "stale"  no successful check for a day

  # ─────────────────────────────────────────────────────────────────────────
  Rule: A company connects its directory once
    # Guards: recipe 1a22971a.

    @OFF-CON-01
    Scenario: An owner connects by consenting as a Workspace admin
      # Requirement: C01-R03
      Given Olive has signed in with Google
      When Olive connects Acme's directory for acme.example
      Then Google asks her for read-only access to the directory
      And the connection is stored once a test lookup through it succeeds

    @OFF-CON-02
    Scenario: The consent completes only for the right Google account
      When the consent comes back for another Google account, another domain, or without lasting access
      Then nothing is stored and Olive is told which

    @OFF-CON-03
    Scenario: An owner connects with the company's own service account
      When Olive gives Acme's service-account key and her admin address on acme.example
      Then the connection is stored once a test lookup through it succeeds
      And a malformed key, an address off the domain, or a key Google won't honour is refused without the key being repeated

    @OFF-CON-04
    Scenario: Only the organization's owners and admins see the connection
      Then a member, or anyone outside Acme, gets the uniform 404
      And nobody ever sees the credential

  # ─────────────────────────────────────────────────────────────────────────
  Rule: A member the directory switches off loses access within the hour
    # Guards: recipes 3650aed9, 88b1b328, 6214370b; the account-state join
    # (92b866ee), never a sweep of keys.

    @OFF-DIR-01
    Scenario: Suspended in Google
      # Requirement: C01-R03, C01-R09
      Given Acme's admin suspends Max in Google
      When Max's agent uses his key and Max is due a check
      Then the key is refused, and so is his session, with "Your organization's Google Workspace doesn't list this account as active."
      And none of his keys is changed

    @OFF-DIR-02
    Scenario: Restored in Google
      Given Max was switched off by the directory
      When Acme's admin restores him and he is due a check
      Then the same keys and session work again

    @OFF-DIR-03
    Scenario: Removed from the directory, archived, or renamed
      Then a member the directory doesn't know, by address or by their Google account, is switched off
      And an archived member is switched off
      And a renamed member is not, and the rename is shown to Acme's admins

    @OFF-DIR-04
    Scenario: At most one question an hour
      Given Max was checked a minute ago
      Then twenty more requests ask Google nothing

    @OFF-DIR-05
    Scenario: A burst asks once
      Given Max is due
      When twenty requests arrive together
      Then Google is asked once and every request is answered

    @OFF-DIR-06
    Scenario: Google slow or down
      Then Max is answered from his last status
      And Google isn't asked about him again for thirty seconds

    @OFF-DIR-07
    Scenario: No successful check for a day
      Given Google has been unreachable for a day
      Then Max is switched off with "Soup.net couldn't confirm this account with your organization's Google Workspace."
      And one successful check restores him

    @OFF-DIR-08
    Scenario: Google refuses the connection
      Given the connection's credential stops working
      Then Acme's admins see the error, and six hours after the last success they get one email naming when it was and the hour everyone will be switched off by
      And a successful check means the next outage warns again

    @OFF-DIR-09
    Scenario: Only people on the domain are checked
      Then Rae is never checked, and nor is someone on a subdomain of acme.example
      And Mal is switched off

    @OFF-DIR-11
    Scenario: The domain claim stops being current
      # Requirement: C01-R03, C01-R09
      # Guards: audit F113.
      Given Max was switched off by the directory
      When acme.example's DNS check fails, its TXT record is removed, or its re-check stalls
      Then Google is asked about nobody and nobody goes stale
      And Max stays switched off

    @OFF-DIR-10
    Scenario: Disconnecting
      When Olive disconnects the directory
      Then no one is checked, and anyone the directory switched off works again
