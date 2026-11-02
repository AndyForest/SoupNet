Feature: Verified domains, automatic joining, and existing accounts on a claimed domain
  # Design: docs/planning/org-accounts-program.md §3.2, §3.3, §3.10; research
  # docs/planning/org-accounts-research/domain-verification-and-claiming.md.
  # Rubric and build log: docs/planning/org-accounts-build/domains.md (stream
  # Domains, organization accounts round 1). Joins go through Core's one join
  # routine (docs/planning/org-accounts-build/core.md, OC-J1).
  # User stories: docs/design-thinking.md archetype 6 (the managed employee:
  # "Already had an account") and archetype 7 (the org admin: "Prove the
  # company owns its domains. Decide whether people on those domains join
  # automatically.").
  #
  # Vocabulary used below:
  #   "Acme"      a company organization claiming acme.example
  #   "Ada"       an active admin of Acme
  #   "Max"       an account on max@acme.example, verified before Acme's claim
  #   "Nia"       a new employee signing up as nia@acme.example
  #   "Globex"    another company organization; "Rex" is its admin
  #   "captured"  Acme's claim on acme.example is verified, checked within 48
  #               hours, not failing, and has automatic joining on
  #   "the record" a TXT record at _soupnet-challenge.acme.example whose value
  #               is soupnet-domain-verification=<Acme's token>

  Background:
    Given the site operator has created Acme with Ada as an admin and a seat limit of 10

  # ─────────────────────────────────────────────────────────────────────────
  Rule: A domain is verified only by its DNS record, and only for one organization
    # Requirement: C01-R05
    # Guards: research §5 items 1 and 3; recipes 4d5b5b81, ddb90531.

    @ORG-DOM-01
    Scenario: Adding a domain returns the record to publish
      When Ada adds "Acme.Example." to Acme
      Then the response is 201 with domain "acme.example" and status "pending"
      And recordName is "_soupnet-challenge.acme.example"
      And recordValue starts with "soupnet-domain-verification="
      And tokenExpiresAt is seven days from now

    @ORG-DOM-02
    Scenario Outline: Domains that can't be claimed are refused at the form
      When Ada adds "<domain>" to Acme
      Then the response is 400 with error "<reason>"
      And no claim is stored

      Examples:
        | domain       | reason                |
        | gmail.com    | public_email_domain   |
        | 192.0.2.1    | invalid_domain        |
        | localhost    | invalid_domain        |
        | exa mple.com | invalid_domain        |

    @ORG-DOM-02
    Scenario: A domain verified by another organization is refused without naming it
      Given Globex's claim on acme.example is verified
      When Ada adds "acme.example" to Acme
      Then the response is 409 with error "domain_taken"
      And the response body does not contain "Globex"

    @ORG-DOM-03
    Scenario: Check now verifies when the exact record is published
      Given Ada has added acme.example
      And the record is published
      When Ada checks acme.example now
      Then its status is "verified"

    @ORG-DOM-03
    Scenario Outline: Check now leaves the claim pending without the exact record
      Given Ada has added acme.example
      And the DNS answer at _soupnet-challenge.acme.example is <answer>
      When Ada checks acme.example now
      Then its status is "pending"
      And the response does not echo any TXT value

      Examples:
        | answer                                              |
        | no record                                           |
        | a resolver error                                    |
        | "soupnet-domain-verification=<another token>"       |
        | "x soupnet-domain-verification=<Acme's token> y"    |

    @ORG-DOM-03
    Scenario: An unverified claim expires after seven days
      Given Ada added acme.example eight days ago and it was never verified
      When Ada checks acme.example now
      Then the response is 409 with error "challenge_expired"

  # ─────────────────────────────────────────────────────────────────────────
  Rule: The record must stay; a missing record freezes joining and never touches members
    # Requirement: C01-R05
    # Guards: research §5 item 2; program §3.2 "freeze auto-join and alert,
    # never dissolve the org"; recipe b79cc790.

    @ORG-DOM-04
    Scenario: A failed daily check freezes joining and tells the admins
      Given acme.example is captured
      And the record has been removed
      When the daily re-check runs
      Then acme.example's status is "failing" with lapsesAt fourteen days after the failed check
      And each active owner and admin of Acme has one email about it
      And a new verification click by Nia joins nothing

    @ORG-DOM-05
    Scenario: The record coming back resumes joining
      Given acme.example is failing
      And the record is published again
      When the daily re-check runs
      Then acme.example is captured

    @ORG-DOM-06
    Scenario: Fourteen days of failure lapses the claim and leaves every member in place
      Given acme.example has been failing for fourteen days
      And Max and Nia are members of Acme
      When the daily re-check runs
      Then acme.example's status is "pending" with a new token
      And Max and Nia are members of Acme with the same roles and books

    @ORG-DOM-07
    Scenario Outline: The join's domain authority holds only for a captured domain
      Given acme.example is captured
      And <change>
      When Core's join is called for Nia with the domain authority acme.example
      Then the join is refused with "not_authorized"

      Examples:
        | change                                        |
        | automatic joining is off                      |
        | the claim is failing                          |
        | the last successful check was 49 hours ago    |
        | the claim is Globex's, not Acme's             |

    @ORG-DOM-08
    Scenario: Another organization verifying a lapsed domain inherits nobody
      Given Acme's claim on acme.example has lapsed
      And Max is a member of Acme
      When Globex verifies acme.example with automatic joining on
      Then Max is still a member of Acme
      And Globex has no members on acme.example

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Joining is imposed only behind domain proof and mailbox proof
    # Requirement: C01-R02
    # Guards: design-thinking.md archetype 6 "Deliberate exception to 'no
    # auto-accept'"; research §5 item 5; recipes f653c2f1, 58eb66f7, 43b6aac9.

    @ORG-JOIN-D01
    Scenario: A password sign-up joins on its verification click
      Given acme.example is captured
      When Nia registers with a password
      Then the register response is byte-identical to the one for gus@personal.example
      And her verification email says the account will belong to Acme
      When she clicks the verification link
      Then she is a member of Acme joined via "domain"
      And her daily links include Acme's default book
      And clicking the link again succeeds and changes nothing

    @ORG-JOIN-D02
    Scenario: With automatic joining off, verification joins nothing
      Given Acme's claim on acme.example is verified with automatic joining off
      When Nia registers and clicks her verification link
      Then her address is verified
      And she is in no company organization

    @ORG-JOIN-D03
    # Realized through onGoogleSignIn and through SSO's afterGoogleSignIn
    # hook; the callback's rollback on "full" is SSO's own test (rubric OD-J3).
    Scenario Outline: A Google sign-in joins only on a matching hd claim
      Given acme.example is captured
      When a Google sign-in creates Nia's account with email "<email>" and hd "<hd>"
      Then the sign-in hook returns "<result>"

      Examples:
        | email              | hd                | result |
        | nia@acme.example   | acme.example      | joined |
        | nia@acme.example   |                   | none   |
        | nia@acme.example   | acme-corp.example | none   |
        | nia@other.example  | acme.example      | none   |

    @ORG-JOIN-D04
    Scenario: The site operator's own account is never joined automatically
      Given acme.example is captured
      And the site operator's account is ops@acme.example
      When the daily re-check runs
      Then the site operator's account is in no company organization

    @ORG-JOIN-D05
    Scenario: An account already in another organization stays there
      Given acme.example is captured
      And the site operator added nia@acme.example to Globex before she verified
      When she clicks her verification link
      Then her address is verified
      And she is a member of Globex, not Acme

    @ORG-JOIN-D06
    Scenario: A claim covers its exact domain, never its subdomains
      # Guards: research §2.3 (scope must be explicit; most products don't
      # inherit); audit and verification coordinators, rubric stage.
      Given acme.example is captured and mail.acme.example is not claimed
      When nia@mail.acme.example registers and clicks her verification link
      Then she is in no company organization
      And a Google sign-in for nia@mail.acme.example with hd "acme.example" returns "none"
      And the next migration of acme.example leaves her account as it is

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Existing accounts on a captured domain are moved in and told
    # Requirement: C01-R12
    # Guards: program Settled simplifications "migrated into the org
    # automatically"; Core OC-J2, OC-J4; recipe 061a7926.

    @ORG-MIG-01
    Scenario: Turning on automatic joining migrates existing verified accounts
      Given Acme's claim on acme.example is verified with automatic joining off
      And Max owns a book "Personal" in his personal organization
      When Ada turns automatic joining on
      Then the response reports joined 1 and awaitingSeat 0
      And Max is a member of Acme joined via "migrated"
      And his book "Personal" is a private book in Acme
      And Max has an email saying he joined Acme

    @ORG-MIG-02
    Scenario: An account with an unverified email is not migrated
      Given an account on dee@acme.example that never verified its email
      When acme.example becomes captured
      Then that account is in no company organization

    @ORG-MIG-03
    Scenario: The daily job continues a migration the request didn't finish
      Given more accounts on acme.example than one request migrates
      When acme.example becomes captured and the daily re-check then runs
      Then every eligible account on acme.example is a member of Acme

    @ORG-MIG-04
    Scenario: Admins see a count of accounts waiting, never a list, and only after proof
      Given Ada has added acme.example and not yet published the record
      When Ada lists Acme's domains
      Then acme.example has no accountsAwaitingJoin field
      When the claim is verified with automatic joining off
      Then acme.example's accountsAwaitingJoin is the number of verified accounts on it in no company organization
      And no field names any of those accounts

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Out of seats blocks the proof step; seats sit outside the public cap
    # Requirement: C01-R02
    # Guards: round plan "Seat exhaustion: block with a clear message in round
    # 1"; Core OC-J5; recipes 5406ed04, 15b767de.

    @ORG-SEAT-D05
    Scenario: A click refused at the seat limit leaves a stranger's Google sign-up in place
      Given acme.example is captured
      And Acme has no free seat
      And a stranger holds a Google session for an unverified account on nia@acme.example
      When Nia clicks her verification link
      Then she is asked to confirm, and nothing has changed
      When she confirms
      Then the response is 409 with error "organization_full"
      And the Google identity and the stranger's session are still there
      When a seat frees
      And Nia clicks the same link again and confirms
      Then the address is verified and she joins Acme
      And the Google identity and the stranger's session are gone

    @ORG-JOIN-D05
    Scenario: A password reset joins the captured domain's organization
      Given acme.example is captured
      And nia@acme.example is registered and unverified
      When she resets the password from the emailed link
      Then the address is verified and she joins Acme

    @ORG-SEAT-D06
    Scenario: A password reset at the seat limit keeps the new password
      Given acme.example is captured
      And Acme has no free seat
      And nia@acme.example is registered and unverified
      When she resets the password from the emailed link
      Then the new password stands and every session is signed out
      And the page says there is no free seat
      And her address is still unverified
      When a seat frees
      And she verifies with the new password
      Then she joins Acme

    @ORG-SEAT-D01
    Scenario: A verification click at the seat limit is refused and can be retried
      Given acme.example is captured
      And Acme has 10 active members
      When Nia clicks her verification link
      Then the response is 409 with error "organization_full"
      And her address is still unverified
      When Ada disables one member
      And Nia clicks the same link again
      Then she is a member of Acme

    @ORG-SEAT-D02
    Scenario: A Google sign-in at the seat limit reports full
      Given acme.example is captured
      And Acme has 10 active members
      When a Google sign-in for nia@acme.example with hd "acme.example" calls the sign-in hook
      Then the hook returns "full"

    @ORG-SEAT-D03
    Scenario: An existing account the migration can't seat is left as it is
      Given Acme has 10 active members
      When acme.example becomes captured
      Then Max is in no company organization and keeps every book and key
      And acme.example's accountsAwaitingJoin counts him
      When a seat frees and the daily re-check runs
      Then Max is a member of Acme

    @ORG-SEAT-D04
    Scenario: A domain join doesn't wait on, or use up, the public signup cap
      Given the public signup cap is reached
      And acme.example is captured
      When Nia registers and clicks her verification link
      Then she is a member of Acme and not waitlisted
      And the public cap's verified-user count is unchanged

  # ─────────────────────────────────────────────────────────────────────────
  Rule: Only Acme's active owners and admins manage Acme's domains
    # Requirement: C01-R05
    # Guards: Core OC-R1 (uniform 404).

    @ORG-DOM-09
    Scenario Outline: Anyone else gets the same 404 as for a missing organization
      Given <caller>
      When they list, add, check, change or delete Acme's domains
      Then each response is byte-identical to the one for a random organization id

      Examples:
        | caller                                        |
        | Rex, an admin of Globex                       |
        | an ordinary member of Acme                    |

    @ORG-DOM-09
    Scenario: A disabled admin is refused before the domain routes
      # Guards: Core OC-A1 (a disabled account's sessions are refused on every JWT route).
      Given Ada has been disabled by Acme's owner
      When Ada lists Acme's domains
      Then the response is 403 with error "account_disabled"

    @ORG-DOM-10
    Scenario: Deleting a claim stops joining and keeps every member
      Given acme.example is captured and Max is a member of Acme
      When Ada deletes the acme.example claim
      Then a new verification click by Nia joins nothing
      And Max is a member of Acme
