Feature: Sign in with Google, account linking, and require_sso
  # Plan: docs/planning/org-accounts-program.md (§0 settled simplifications,
  # §3.4, §3.11) and docs/planning/org-accounts-round-1.md. Rubric and build
  # notes: docs/planning/org-accounts-build/sso.md (stream SSO). Decision
  # record: docs/adr/0022-oauth-connector-and-google-sign-in.md.
  # User stories: docs/design-thinking.md archetype 6 (The Organization
  # Member) and archetype 7 (The Org Admin).
  # Realized as Layer 3 tests in apps/backend/src/routes/google-auth.test.ts,
  # against a fake Google (apps/backend/src/test-google-issuer.ts).
  #
  # Vocabulary used below:
  #   "Sys"    the site operator (system role)
  #   "Acme"   a company organization whose Workspace domain is acme.example
  #   "Olive"  Acme's owner
  #   "Max"    an Acme member with a verified password account
  #   "Pat"    a personal account outside Acme
  #   "Eve"    registered victim@acme.example with a password, never verified
  #   "Vic"    the real owner of victim@acme.example
  #   "Gil"    signed in with a consumer Google account (no hd) on
  #            victim2@acme.example, never verified
  #   "Val"    the real owner of victim2@acme.example
  #   "Cy"     a consumer Google account on cy@outside.example
  #   "authoritative"  Google can vouch for the address: @gmail.com, or
  #                    email_verified with hd set
  #   "the tab"  the browser tab that started the sign-in, holding its secret

  # ─────────────────────────────────────────────────────────────────────────
  Rule: The round trip is bound to the tab that started it
    # Guards: recipe 49937af3; RFC 9700 §2.1.1 (bound to the user agent).

    @GSI-START-01
    Scenario: Starting stores a pending request and sends the person to Google
      # Requirement: C01-R04
      When the tab starts Google sign-in with the hash of its secret
      Then Google is asked for openid, email and profile, with a state, a nonce and an S256 challenge
      And no offline access is requested

    @GSI-START-02
    Scenario: A return destination the server wouldn't send a person to is refused
      When the tab starts Google sign-in returning to another site, or to a consent request the grant would refuse
      Then the start is refused and nothing is stored

    @GSI-CB-03
    Scenario: A replayed callback ends like one nobody started
      Given a sign-in that already came back from Google
      When the same callback is opened again
      Then it ends in "expired", exactly as an invented state does
      And Google is not asked again

    @GSI-CB-02
    Scenario: The callback repeats nothing it was sent
      When the callback arrives with an error and text of the sender's choosing
      Then the person lands on the completion page with a code from the closed list and none of that text

    @GSI-CSRF-01
    Scenario: A handoff code is useless in a tab that didn't start the sign-in
      Given an attacker completed Google with their own account and sent the victim the handoff link
      When the victim's tab exchanges it
      Then the exchange is refused, exactly as an unknown code is
      And the starting tab can still exchange it once, and only once

  # ─────────────────────────────────────────────────────────────────────────
  Rule: A Google sign-in reaches the account Google can vouch for, and never through an email fallback
    # Guards: settled simplification "Google sign-in proves the email";
    # recipe 3a943b1c (superseding 5219c09d); research §2.1, §2.3, §2.4.

    @GSI-NEW-01
    Scenario: An authoritative sign-up makes a verified account with no password
      # Requirement: C01-R04
      When Pat signs in with Google for the first time with a gmail.com address
      Then an account is created, verified, with no password and the terms accepted
      And Pat's session says it came from Google

    @GSI-ID-01
    Scenario: A linked Google account signs in whatever email it now carries
      Given Olive's Google account is linked
      When she signs in after her Google address changed
      Then she reaches the same account

    @GSI-LINK-01
    Scenario: A verified password account links silently and keeps its password
      When Max signs in with his Workspace account
      Then his Google account is linked and his password still works

    @GSI-LINK-02
    Scenario: A password pre-registration is taken over by the real owner
      # Requirement: C01-R04
      Given Eve holds a session for the unverified victim@acme.example
      When Vic signs in with Google Workspace as victim@acme.example
      Then the account is Vic's, verified, with no password
      And Eve's password no longer signs in and her session has ended
      And the account holds no working key

    @GSI-LINK-05
    Scenario: A consumer-Google pre-registration is taken over by the real owner
      Given Gil holds a session for the unverified victim2@acme.example through a consumer Google account
      When Val signs in with Google Workspace as victim2@acme.example
      Then the account is Val's, Gil's Google account is unlinked, and Gil's session has ended

    @GSI-LINK-03
    Scenario: A non-authoritative Google account links nothing into an existing account
      Given Cy already has a password account
      When Cy signs in with Google
      Then nothing is linked and Cy is told to sign in with the password

    @GSI-NEW-02
    Scenario: A non-authoritative sign-up gets our own verification email
      When someone signs in with a consumer Google account on a third-party address that has no account
      Then an unverified account is created and our verification email is sent

    @GSI-LINK-06
    Scenario: The address's owner verifying ends a stranger's Google sign-up
      Given someone signed up with a consumer Google account on Vic's address
      When Vic opens the verification email in a browser without that sign-up's session
      Then the address is verified, that Google account is unlinked and its session has ended
      And Vic can sign in with Google Workspace on that address

    @GSI-LINK-07
    Scenario: Verifying in the browser that signed up keeps Google sign-in
      Given Cy signed up with a consumer Google account on Cy's own address
      When Cy opens the verification email in the same browser
      Then the address is verified and Cy still signs in with that Google account

    @GSI-LINK-04
    Scenario: A verified account linked to another Google account isn't relinked by email
      Given Max's account is linked to one Google account
      When a different Google account with Max's address signs in
      Then it is refused

    @GSI-STATE-01
    Scenario: A switched-off account gets no session from Google either
      Given Sys has suspended Pat
      When Pat signs in with Google
      Then Pat is told the account is suspended

    @GSI-PWD-01
    Scenario: A password sign-in to a Google-only account looks like a wrong password
      When someone tries a password on an account that has none
      Then the answer is the same as for a wrong password

    @GSI-PWD-02
    Scenario: A Google-only account confirms its own deletion with a fresh Google sign-in
      Given Pat's account has no password and Pat last signed in with Google more than ten minutes ago
      When Pat deletes the account
      Then Pat is asked to sign in with Google again first

  # ─────────────────────────────────────────────────────────────────────────
  Rule: The consent page returns a signed-out person to itself
    # Guards: recipe 607dc974; program §3.11.

    @GSI-MCP-01
    Scenario: Connecting an MCP client is one uninterrupted flow
      # Requirement: C01-R11
      Given Pat is signed out on the consent page of a connector that asked for openid and email
      When Pat continues with Google
      Then Pat lands back on the consent page with every parameter the connector sent, resource and scope included

  # ─────────────────────────────────────────────────────────────────────────
  Rule: An organization can require its members to sign in with Google Workspace
    # Guards: recipe 8b68ea10; settled simplification "No break-glass design
    # for require_sso"; research §2.6.

    @GSI-SSO-01
    Scenario: Only a Workspace Google session can turn the policy on
      # Requirement: C01-R04
      When Olive tries to require SSO from a password session
      Then she is asked to sign in with Google first
      And someone outside Acme gets the uniform 404

    @GSI-SSO-02
    Scenario: Turning it on ends every password session, and turning it off restores them
      Given Acme requires SSO
      Then Max's password session and password sign-in are refused with "Your organization signs in with Google."
      And his Workspace Google session works
      When Acme stops requiring SSO
      Then Max's old password session works again

    @GSI-SSO-03
    Scenario: No password reset for a member
      Given Acme requires SSO
      Then Max gets no reset email, and a reset link he already had is refused

    @GSI-SSO-04
    Scenario: A consumer Google account is not the company's sign-in
      Given Acme requires SSO
      Then a member's consumer-Google session is refused, and so is a new consumer-Google sign-in

    @GSI-SSO-05
    Scenario: Personal accounts are untouched
      # Guests on Acme's books hold no Acme membership, which is what the
      # policy reads, so they are untouched the same way.
      Given Acme requires SSO
      Then Pat's password session works
