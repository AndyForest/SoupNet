Feature: Proving a mailbox
  Someone can register a password on another person's address. Verifying an account takes the sign-up's own session or the account's password, so that person can't keep access once the real owner proves the mailbox. The owner's route is forgot-password.
  # Guards: recipe 450a107b; realized in apps/backend/src/routes/auth-verify.test.ts.

  Rule: A verification link alone verifies nothing

    @ACC-VERIFY-01
    Scenario: The sign-up's own session verifies with no password
      Given Pat signed in after signing up
      When Pat opens the verification link in that browser
      Then the address is verified with no password asked

    @ACC-VERIFY-02
    Scenario: With no session, the link asks for the password and changes nothing
      When a mail scanner or a person opens the link with no session
      Then the account stays unverified
      And the page asks for the account's password

    @ACC-VERIFY-03
    Scenario: With no session, the right password verifies and signs the person in
      When Pat opens the link with no session and enters the password
      Then the address is verified and the response carries a working session
      And Pat doesn't type the password again to sign in

    @ACC-VERIFY-04
    Scenario: The wrong password is refused
      When someone enters the wrong password at the link
      Then they are told so and the account stays unverified

    @ACC-VERIFY-05
    Scenario: Another account's session, or a dead one, is not proof
      When the link is opened with another account's session, an invalid one, or one a reset ended
      Then the password is asked for as if there were no session

    @ACC-VERIFY-09
    Scenario: A repeat click on a verified account needs no password
      When the link of a verified account is opened again
      Then it reports success and the verification time doesn't change
      And a password sent with it isn't judged and signs nobody in

    @ACC-VERIFY-10
    Scenario: A waitlisted account verifies with its password
      Given Wes is on the waitlist, so sign-in gives Wes no session
      When Wes opens the link and enters the password
      Then the address is verified and Wes's place on the waitlist is held
      And the response carries no session

    @ACC-VERIFY-13
    Scenario: A switched-off account verifies with its password and gets no session
      Given Sam's account is suspended, or disabled by its organization
      When Sam opens the link and enters the password
      Then the address is verified and the response carries no session
      And signing in says why, as it always does

    @ACC-VERIFY-12
    Scenario: Password attempts at the link are limited
      When five wrong passwords come from one address within 15 minutes
      Then further attempts from it are refused as too many, under the same limit as sign-in
      And opening the link still shows the prompt

  Rule: A password reset proves the mailbox

    @ACC-VERIFY-06
    Scenario: The address's owner takes it back from whoever registered it
      Given Sal registered a password on Olive's address and holds a session
      When Olive, who doesn't know that password, resets it from the emailed link
      Then the address is verified
      And Sal's password and session no longer work
      And Olive can sign in with the new password

    @ACC-VERIFY-07
    Scenario: Every reset ends the account's sessions
      Given Pat's verified account has a session on another device
      When Pat resets the password
      Then that session is ended, and the verification time doesn't change
      And Pat's API keys and connected apps keep working

    @ACC-VERIFY-08
    Scenario: A reset token that doesn't match changes nothing
      When someone sends a reset with an unknown token
      Then it is refused, and no session or verification changes

    @ACC-VERIFY-11
    Scenario: A reset on a waitlisted account leaves the waitlist place
      When a waitlisted owner resets the password
      Then the address is verified and the account stays on the waitlist
