# Google Sign-In (OpenID Connect) for managed organization accounts

Status: research input for [org-accounts-program.md](../org-accounts-program.md) §3.3, §3.4, §3.11. Nothing here is ratified. All sources accessed 2026-09-19; each source's own date is given where the page shows one. Quotes are verbatim, with only line-wrap whitespace and typographic (curly) quotation marks normalized to plain ones.

## 1. Question

How should Soup.net add "Sign in with Google" for a multi-tenant service with managed company accounts? Seven sub-questions: (1) which ID-token claim identifies the user and what `email`, `email_verified`, and `hd` are good for; (2) whether an IdP's `email_verified: true` can verify the email in our system; (3) account-linking risk when a Google login arrives for an email that already has a password account; (4) the 2025 failed-startup-domain issue; (5) OAuth scope categories and Google app verification; (6) enforcing "SSO required"; (7) carrying our own in-flight MCP OAuth authorize request across the Google round trip.

## 2. Findings

### 2.1 Identity claims: `sub`, `email`, `email_verified`, `hd`

Source A: Google, "OpenID Connect" (page dated "Last updated 2026-06-15 UTC"), https://developers.google.com/identity/openid-connect/openid-connect

- On `sub`: "An identifier for the user, unique among all Google Accounts and never reused. A Google Account can have multiple email addresses at different points in time, but the sub value is never changed. Use sub within your application as the unique-identifier key for the user. Maximum length of 255 case-sensitive ASCII characters."
- Warning box: "When implementing your account management system, you shouldn't use the email field in the ID token as a unique identifier for a user. Always use the sub field as it is unique to a Google Account even if the user changes their email address."
- On `email`: "The value of this claim may not be unique to this account and could change over time, therefore you shouldn't use this value as the primary identifier to link to your user record. You also can't rely on the domain of the email claim to identify users of Google Workspace or Cloud organizations; use the hd claim instead."
- On `email_verified`: "True if the user's email address has been verified; otherwise false."
- On the `hd` claim: "The domain associated with the Google Workspace or Cloud organization of the user. Provided only if the user belongs to a Google Cloud organization. You must check this claim when restricting access to a resource to only members of certain domains. The absence of this claim indicates that the account does not belong to a Google hosted domain."
- On the `hd` request parameter (distinct from the claim): "Don't rely on this UI optimization to control who can access your app, as client-side requests can be modified. Be sure to validate that the returned ID token has an hd claim value that matches what you expect (e.g. mycolledge.edu). Unlike the request parameter, the ID token hd claim is contained within a security token from Google, so the value can be trusted."

Source B: Google, "Verify the Google ID token on your server side" (page dated "Last updated 2025-12-22 UTC"), https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

- Token validation: "The value of aud in the ID token is equal to one of your app's client IDs. This check is necessary to prevent ID tokens issued to a malicious app being used to access data about the same user on your app's backend server." and "The value of iss in the ID token is equal to accounts.google.com or https://accounts.google.com."
- When Google is authoritative for an email: "Using the email, email_verified and hd fields, you can determine if Google hosts and is authoritative for an email address. In the cases where Google is authoritative, the user is known to be the legitimate account owner, and you may skip password or other challenge methods."
- The two authoritative cases: "email has a @gmail.com suffix, this is a Gmail account." and "email_verified is true and hd is set, this is a Google Workspace account."
- The non-authoritative case: "Users may register for Google Accounts without using Gmail or Google Workspace. When email does not contain a @gmail.com suffix and hd is absent, Google is not authoritative and password or other challenge methods are recommended to verify the user. email_verified can also be true as Google initially verified the user when the Google account was created, however ownership of the third party email account may have since changed."

Source C: OpenID Connect Core 1.0, §5.7 "Claim Stability and Uniqueness", https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability

- "The sub (subject) and iss (issuer) Claims from the ID Token, used together, are the only Claims that an RP can rely upon as a stable identifier for the End-User, since the sub Claim MUST be locally unique and never reassigned within the Issuer for a particular End-User".
- "Therefore, other Claims such as email, phone_number, preferred_username, and name MUST NOT be used as unique identifiers for the End-User, whether obtained from the ID Token or the UserInfo Endpoint."

Can a consumer Google account carry a company-domain email without being in the company's Workspace? Yes.

- Google Account Help, "Create a Google Account", https://support.google.com/accounts/answer/27441: "You don't need to have a Gmail address to create a Google Account. You can also use a non-Gmail email address to create one instead."
- Google Workspace Admin Help, "Use the transfer tool to migrate unmanaged personal accounts", https://support.google.com/a/answer/6178640, shows that Workspace admins routinely find such accounts on their own domain: "If you have unmanaged personal accounts, ask the users to convert them to Google Workspace accounts." and "If a user accepts your request to transfer their account, you can manage that account and data. If the user ignores the request, they will need to rename their personal account."

### 2.2 Is `email_verified: true` from the IdP enough to verify the email in our system?

- OpenID Connect Core 1.0, §5.1 (same URL as Source C), defines the claim with a built-in caveat: "When this Claim Value is true, this means that the OP took affirmative steps to ensure that this e-mail address was controlled by the End-User at the time the verification was performed. The means by which an e-mail address is verified is context specific, and dependent upon the trust framework or contractual agreements within which the parties are operating."
- Google narrows it further (Source B, quoted above): with `hd` absent and a non-gmail.com address, "Google is not authoritative" and "email_verified can also be true as Google initially verified the user when the Google account was created, however ownership of the third party email account may have since changed."
- The pre-hijacking research (Source D below) puts the duty on the relying party: "If the service uses an IdP, it should check whether the IdP performs this verification or perform its own additional verification."

### 2.3 Account linking and the pre-hijacking attack class

Source D: Microsoft Security Response Center, "New Research Paper: Pre-hijacking Attacks on Web User Accounts", Andrew Paverd (MSRC) and Avinash Sudhodanan, May 23, 2022, https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks (the original msrc-blog.microsoft.com URL now redirects). Paper: Sudhodanan and Paverd, "Pre-hijacked accounts: An Empirical Study of Security Failures in User Account Creation on the Web", USENIX Security 2022, https://arxiv.org/abs/2205.10174

- Prevalence, from the paper's abstract: "we analyzed 75 popular services and found that at least 35 of these were vulnerable to one or more account pre-hijacking attacks."
- The attack that matches our case: "Classic-Federated Merge Attack: This exploits a potential weakness in the interaction between the classic and federated routes for account creation. The attacker uses the victim's email address to create an account via the classic route, and the victim subsequently creates an account via the federated route, using the same email address. If the service merges these two accounts insecurely, this could result in both the victim and the attacker having access to the same account."
- The session variant: "Unexpired Session Identifier Attack: This exploits a vulnerability in which authenticated users are not signed out of an account when the user resets the password. The attacker creates an account using the victim's email address and then maintains a long-running active session. When the victim recovers the account, the attacker might still have access if the password reset did not invalidate the attacker's session."
- The mirror image, relevant when a second IdP is added later: "Non-Verifying IdP Attack: This attack is the mirror image of the Classic-Federated Merge Attack. The attacker leverages an IdP that does not verify ownership of an email address when creating a federated identity."
- Root cause: "Fundamentally, the root cause of account pre-hijacking vulnerabilities is that the service fails to verify that the user actually owns the supplied identifier (e.g. email address or phone number) before allowing use of the account."
- Primary mitigation: "All the attacks described above could be mitigated if the service sent a verification email to the user-provided email address and required the verification to be completed before allowing any further actions on the account."
- Merge rule: "Merging accounts: When a service merges an account created via the classic route with one created via the federated route (or vice-versa), the service must ensure that the user currently controls both accounts. For example, when the user attempts to create an account via the federated route but a classic account already exists for the same email address, the user should be required to provide or reset the password for the classic account."
- Password reset rule: "Sign out all other sessions and invalidate all other authentication tokens for that account to mitigate the Unexpired Session attack." and "Cancel all pending email change actions for that account to mitigate the Unexpired Email Change attack."
- Pruning: "Unverified account pruning: Regularly deleting unverified accounts would reduce the window of vulnerability for most pre-hijacking attacks (except the Non-verifying IdP Attack)."

Codebase facts that bear on this (not web sources): unverified users can log in and receive a JWT, but every JWT-authed router other than the verify-pending endpoints applies `requireVerifiedEmail` (`apps/backend/src/routes/auth.ts` comment at lines 359-362); API key use also requires `email_verified_at IS NOT NULL` (program doc §1). Human sessions are stateless JWTs with `JWT_EXPIRY = "7d"` (`apps/backend/src/auth.ts` line 18), stored by the SPA in `localStorage` (`apps/frontend/src/auth.ts`). `/register` returns one generic response regardless of whether the email exists (recipe `b0d728f7`, F30).

### 2.4 The 2025 failed-startup-domain issue

Source E: Dylan Ayrey, Truffle Security, "Millions of Accounts Vulnerable due to Google's OAuth Flaw", January 13, 2025, https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw

- What went wrong: "Google's OAuth login doesn't protect against someone purchasing a failed startup's domain and using it to re-create email accounts for former employees. And while you can't access old email data, you can use those accounts to log into all the different SaaS products that the organization used."
- Why services were exposed: "If a service (e.g., Slack) relies solely on these two claims, ownership changes to the domain won't look any different to Slack. When someone buys the domain of a defunct company, they inherit the same claims, granting them access to old employee accounts." (The two claims are `hd` and `email`.)
- The auto-join amplifier: "Many providers, which allow you to join the overall workspace if the domain matches, regardless of your email, will then return the full list of users."
- Truffle's objection to `sub`, reported second-hand from an unnamed engineer: "The sub claim changes in about 0.04% of logins from Log in with Google. For us, that's hundreds of users last week".
- Truffle's conclusion at time of writing: "To the best of our knowledge, downstream providers (e.g. Slack) cannot protect against this vulnerability unless Google adds the two proposed OIDC claims." The two proposed claims were "A unique user ID that doesn't change over time." and "A unique workspace ID tied to the domain."
- On the password path: "Startups should disable password-based authentication and enforce SSO with 2FA." and "Service providers should require additional verification (e.g., SMS codes or credit card verification) for password resets."
- Timeline as given by Truffle: "Reported to Google - Sep 30, 2024", "Google marks as won't fix - Oct 2, 2024", "Google re-opens issue - Dec 19, 2024".

Google's response, as quoted by the press (Google published no standalone post that I could find):

- SecurityWeek, "Google OAuth Flaw Leads to Account Takeover When Domain Ownership Changes", https://www.securityweek.com/google-oauth-flaw-leads-to-account-takeover-when-domain-ownership-changes/ quotes the spokesperson: "As a best practice, we recommend customers properly close out domains following these instructions to make this type of issue impossible. Additionally, we encourage third-party apps to follow best-practices by using the unique account identifiers (sub) to mitigate this risk," and a Google representative: "The 'sub field' is the immutable identifier that the researcher is calling for – we strongly urge developers to use it to provide extra protection,". SecurityWeek adds: "The spokesperson also noted that the internet giant has no evidence to support the claim that "the sub field is not an immutable and unique identifier.""
- The Hacker News, https://thehackernews.com/2025/01/google-oauth-vulnerability-exposes.html: "As of January 15, the company has updated its documentation with the warning: "When implementing your account management system, you shouldn't use the email field in the ID token as a unique identifier for a user. Always use the sub field as it is unique to a Google Account even if the user changes their email address."" That warning is the one quoted from Source A in §2.1.

### 2.5 Scopes and Google app verification

Source F: Google Cloud Console Help, "OAuth App Verification Help Center", https://support.google.com/cloud/answer/13463073

- "Apps that request access to scopes categorized as sensitive or restricted must complete Google's OAuth app verification before being granted access." and "When you add scopes to your project, scope categories (non-sensitive, sensitive, or restricted) are indicated automatically in the Google Cloud Console."
- "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process. However, if you want your app to display an app name and logo on the OAuth consent screen, you will need to complete a lighter-weight verification process known as "brand-verification"."
- "Apps requesting restricted scopes data need to complete "re-verification" annually."

Source G: Google, "Sensitive scope verification" (page dated "Last updated 2026-08-19 UTC"), https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification

- The sign-in scopes are non-sensitive: "An initial set of scopes that are necessary for Google Sign-In are pre-filled in the Non-sensitive scopes section."
- "Sensitive scopes require review by Google before any Google Account can grant access. Google Workspace organization administrators might restrict access to sensitive scopes to prevent access by OAuth client IDs that the organization doesn't explicitly mark as trusted."
- "The sensitive scope verification process typically takes 3-5 business days to complete."
- Requirements: "providing detailed justification and a video demonstration for sensitive scopes."

Source H: Google Cloud Console Help, "Manage App Audience", https://support.google.com/cloud/answer/15549945

- In Testing status: "Projects configured with a publishing status of Testing are limited to up to 100 test users listed in the OAuth consent screen." and "Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an offline access type and receives a refresh token, that token will also expire."
- The sign-in exception: "The only exception to this behavior is if your app requests a subset of the following: name, email address, and user profile (through the userinfo.email, userinfo.profile, openid scopes or their OpenID Connect equivalents). For such requests, your users do not need to be in the trusted user list, they will not see a warning message, and their authorizations will not expire after 7 days. If your app uses Sign in with Google to authenticate users then this exception also applies. If your app requests any other OAuth scopes, then this exception does not apply."

Offline access (refresh tokens). Offline access is a request parameter (`access_type=offline`), not a scope, so it does not change the scope category. Source I: Google, "Using OAuth 2.0 to Access Google APIs" (page dated "Last updated 2026-05-26 UTC"), https://developers.google.com/identity/protocols/oauth2#expiration

- "You must write your code to anticipate the possibility that a granted refresh token might no longer work." Listed reasons include "The user has revoked your app's access.", "The refresh token has not been used for six months.", and "If an admin set any of the services requested in your app's scopes to Restricted (the error is admin_policy_enforced)."
- "There is currently a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID. If the limit is reached, creating a new refresh token automatically invalidates the oldest refresh token without warning."
- Source A adds: "Be sure to store the refresh token safely and permanently, because you can only obtain a refresh token the first time that you perform the code exchange flow."

Admin SDK Directory read-only user scope. Source J: Google, "Choose Directory API scopes" (page dated "Last updated 2026-09-03 UTC"), https://developers.google.com/workspace/admin/directory/v1/guides/authorizing

- The scope: "https://www.googleapis.com/auth/admin.directory.user.readonly" with meaning "Scope for only retrieving users or user aliases."
- "If your public application uses scopes that permit access to certain user data, it must complete a verification process."
- The page does not print a sensitive or restricted label per scope. Google's scope index (https://developers.google.com/identity/protocols/oauth2/scopes) says only: "Sensitive scopes, indicated in the Google Cloud Console, require review by Google." The category of this specific scope is therefore listed under §7 as unconfirmed.

### 2.6 Enforcing "SSO required" and disabling passwords on managed accounts

No standards body prescribes this; the evidence is vendor practice.

Source K: Notion Help, "SAML SSO configuration", https://www.notion.com/help/saml-sso-configuration

- Domain verification gates the feature: "At least one domain must be verified by a workspace owner." and "We ask that the email domain ownership is validated to ensure that only the owner of the domain can customize how their users log into Notion."
- Enforcement is a separate switch from enablement: "Once you have completed your configuration of SAML SSO for a workspace, members will be able to log in via SAML SSO in addition to other login methods, like username and password or Google authentication." then "If you want to ensure that members can log in using only SAML SSO and no other method, go to your SAML SSO settings and update the Login method to Only SAML SSO. Once this happens, workspace users will be logged out and required to log back in using SAML SSO. SAML SSO will only be enforced for members who use your verified domain."
- Guests are outside it: "Guests invited to pages in a SAML-enabled Notion workspace can't log in with SAML SSO. Instead, they'll need to use another login method".
- Break-glass: "In the event of IdP or SAML failure, certain users will be able to bypass SAML SSO by using their email and password credentials. They'll be able to log in and disable or update their configuration." and "If a SAML configuration is managed at the workspace level, only workspace owners will be able to bypass SSO."

Source L: Atlassian Support, "Understand authentication policies", https://support.atlassian.com/security-and-access-policies/docs/understand-authentication-policies/

- Policy is per set of users, not per product: "An authentication policy allows you to specify authentication settings for different sets of users and configurations in your organization."
- The policy carries SSO, social login, and API tokens together: "Single sign-on (SSO) – Indicates whether SSO is enforced through an identity provider.", "Third-party login – Indicates whether users can sign in using third-party accounts such as Google or Microsoft.", "API tokens - Specifies whether members can create new API tokens or use existing ones to authenticate.", "API token expiration - How long user API tokens remain valid before expiring."
- Staged rollout: "When you test settings on a small set of users, you avoid rolling out a policy that may not work for your entire organization."

Source E (Truffle) gives the security argument for enforcement: "Startups should disable password-based authentication and enforce SSO with 2FA."

### 2.7 Carrying our own in-flight authorize request across the Google round trip

Source M: RFC 9700, "Best Current Practice for OAuth 2.0 Security", January 2025, https://www.rfc-editor.org/rfc/rfc9700

- Open redirectors, §2.1: "Clients and authorization servers MUST NOT expose URLs that forward the user's browser to arbitrary URIs obtained from a query parameter (open redirectors) as described in Section 4.11. Open redirectors can enable exfiltration of authorization codes and access tokens." §4.11.1: "In order to prevent open redirection, clients should only redirect if the target URLs are allowed or if the origin and integrity of a request can be authenticated."
- Redirect URI matching, §2.1: "When comparing client redirection URIs against pre-registered URIs, authorization servers MUST utilize exact string matching except for port numbers in localhost redirection URIs of native apps".
- CSRF, §2.1: "Clients MUST prevent Cross-Site Request Forgery (CSRF)." and "Clients that have ensured that the authorization server supports Proof Key for Code Exchange (PKCE) [RFC7636] MAY rely on the CSRF protection provided by PKCE. In OpenID Connect flows, the nonce parameter provides CSRF protection. Otherwise, one-time use CSRF tokens carried in the state parameter that are securely bound to the user agent MUST be used for CSRF protection".
- PKCE for confidential clients, §2.1.1: "For confidential clients, the use of PKCE [RFC7636] is RECOMMENDED, as it provides strong protection against misuse and injection of authorization codes". Binding: "In any case, the PKCE challenge or OpenID Connect nonce MUST be transaction-specific and securely bound to the client and the user agent in which the transaction was started."
- When `state` carries application state, §4.7.1: "If state is used for carrying application state, and the integrity of its contents is a concern, clients MUST protect state against tampering and swapping. This can be achieved by binding the contents of state to the browser session and/or by signing/encrypting state values."
- Nonce handling, §4.5.3.2: a client "MUST validate the nonce in the ID Token obtained from the token endpoint" and "MUST ensure that, unless and until that check succeeds, all tokens (ID Tokens and the access token) are disregarded and not used for any other purpose."
- Tokens in URLs, §4.3.2: "An access token may end up in the browser history if a client or a website that already has a token deliberately navigates to a page like provider.com/get_user_profile?access_token=abcdef. [RFC6750] discourages this practice and advises transferring tokens via a header".

Google's side (Source A): "You must protect the security of your users by preventing request forgery attacks. The first step is creating a unique session token that holds state between your app and the user's client." and "state should include the value of the anti-forgery unique session token, as well as any other information needed to recover the context when the user returns to your application, e.g., the starting URL." and "nonce is a random value generated by your app that enables replay protection when present." Google's discovery document (https://accounts.google.com/.well-known/openid-configuration) lists `"code_challenge_methods_supported": ["plain", "S256"]`, so PKCE is available for our client role toward Google.

Codebase facts: our authorization endpoint is the SPA page `/oauth/authorize`; the grant itself is validated server-side at `POST /oauth/authorize/grant`, including exact-match `redirect_uri` (F44, `apps/frontend/src/lib/oauth-redirect.ts`). The page's header comment says a logged-out user is sent to `/auth/login` and relies on the connector retrying; a `?next=` return path is mentioned in that comment, but `LoginPage.tsx` contains no `next` handling today. So there is currently no return-path mechanism to extend, and none to exploit.

## 3. What this means for Soup.net (interpretation)

Everything in this section is my reading of the sources above, not sourced fact.

1. Key identities on `(iss, sub)`. Google and OIDC Core agree, and Google's public answer to the Truffle report was exactly this. Store `email` and `hd` as attributes refreshed at each login, never as lookup keys for an existing identity.
2. `hd` is the membership signal, and the email suffix is not. The planning doc's §3.3 claim holds: a consumer Google account can carry a company address, and Workspace admins have a whole tool for chasing those accounts. Auto-join and `require_sso` matching must test `hd` against the org's verified domains and treat an absent `hd` as "not a member of any Workspace", whatever the email says.
3. `email_verified: true` is sufficient only in Google's two authoritative cases: `hd` present, or an `@gmail.com` address. For a Google account with a third-party address and no `hd`, Google itself says it is not authoritative and the address may have changed hands. For those logins we should run our own verification email before setting `email_verified_at`. This is a refinement of the planning doc's "operator's instinct holds": it holds for Workspace and Gmail accounts, not for every Google login.
4. Our pre-hijack exposure is the Classic-Federated Merge attack in pure form. An attacker can register `victim@customer.com` with a password today and hold a valid 7-day JWT for the unverified account. If a later Google login by the real owner attached to that row and set `email_verified_at`, the attacker's password and JWT would become fully privileged. Because unverified accounts cannot do anything behind `requireVerifiedEmail`, the cleanest fix is to never merge into an unverified row at all.
5. Linking into a verified password account still needs proof of control of both sides. MSRC's rule is "provide or reset the password". In Google's authoritative cases one could argue Google has proven email control, which is equivalent to what a password reset proves. That argument is sound only if we then apply the password-reset hygiene too: invalidate sessions and pending email changes. We have no server-side session revocation today (stateless JWT), so silent auto-linking would leave any attacker session alive for up to seven days.
6. The Truffle scenario maps onto our design in two places. First, an existing identity row keyed on `sub` is safe: a re-created mailbox under a new domain owner gets a new `sub` and will not match. The danger is any fallback that says "same email and `hd`, different `sub`, so link it anyway". Second, `hd`-based auto-join would hand a new domain owner a fresh member seat in the old org with access to every org-scoped book. `sub` does nothing for that case. The defenses there are ours: DNS re-verification that freezes auto-join on failure (the old TXT record disappears when a lapsed domain is re-registered), seat caps, and admin notification on every auto-join. Note that Truffle itself does not propose domain re-verification; that is our inference, so the planning doc's "[verify: Truffle Security 2025 write-up]" tag on that sentence should be read as "not supported by that source, but consistent with it".
7. Sign-in needs no Google verification beyond optional brand verification for the name and logo on the consent screen. Requesting `access_type=offline` with only sign-in scopes stays in the non-sensitive category, which keeps program option C (liveness probe) cheap from a verification standpoint. The Directory scope is a different class of project: Google review with written justification and a demo video, plus the customer's Workspace admin possibly needing to mark our client as trusted.
8. `require_sso` should be a per-org policy applied to users on the org's verified domains, separate from "Google sign-in is available", with guests exempt and an owner break-glass. Both Notion and Atlassian are shaped this way. Atlassian's bundling of API-token rules into the same policy object is a useful precedent for program option B (key lifetime caps) living beside `require_sso`.
9. For the MCP authorize round trip, the safest shape is to not carry a URL at all. The backend starts the Google flow, stores the pending context server-side (or in a signed, HttpOnly, short-lived cookie), and puts only an opaque random `state` on the wire. On return, the destination is rebuilt from stored data and must be a same-origin SPA path; the third-party `redirect_uri` inside it is still checked by the existing exact-match logic at grant time. This satisfies the RFC 9700 open-redirect rule by construction rather than by validation.
10. Our JWT lives in `localStorage`, so the backend callback has to hand the session to the SPA somehow. Putting the JWT in the redirect URL is the pattern RFC 9700 §4.3.2 warns about. A single-use, short-lived handoff code that the SPA exchanges by POST avoids it.

## 4. Options with tradeoffs

### 4.1 Identity storage

- Option A, keep `users.provider` + `users.external_id`. No migration beyond making `password_hash` nullable. One identity per user, so a password account cannot add Google without losing the meaning of `provider`, and a second IdP is a rewrite.
- Option B, a `user_identities` table. Supported by OIDC Core's `(iss, sub)` rule. Shape the sources support:

| Column | Notes |
|---|---|
| `id` uuid pk | |
| `user_id` uuid fk → users, cascade | |
| `provider` text | `'google'` for now; human-readable discriminator |
| `issuer` text | the validated `iss`, normalized to `https://accounts.google.com` |
| `subject` text | `sub`; Google states a maximum of 255 case-sensitive ASCII characters, so compare byte-exact, no case folding |
| `email_at_link` / `last_email` text | snapshot only, never a lookup key for an existing identity |
| `last_email_verified` boolean | as asserted at last login |
| `hosted_domain` text null | `hd` at last login; null means consumer account |
| `linked_at`, `last_login_at` timestamptz | |
| `link_method` text | `signup`, `password_confirmed`, `email_challenge`, `admin` for audit |
| unique (`issuer`, `subject`) | the identity key |
| unique (`user_id`, `provider`) | one Google identity per user for the first release |

  Password becomes one credential among several: `users.password_hash` goes nullable. If option C of the program (liveness probe) proceeds, the encrypted Google refresh token belongs in a separate table with its own access path, not on this row, so that reading identities never touches a credential.

### 4.2 Google login arrives and the email matches an existing password account with no linked identity

- Option A, auto-link when Google is authoritative (`hd` set or gmail.com) and the existing account is verified. Lowest friction. Requires real session invalidation to be safe, which we lack; without it an attacker session survives the link.
- Option B, require proof of the classic side: the user enters the existing password, or completes an emailed one-time link, then the identity is linked. Matches the MSRC text directly. One extra step, once per user.
- Option C, never link by email; create a separate account. Collides with `users_email_unique` and confuses users. Not viable without dropping the unique constraint.
- For an existing unverified account, under any option: delete or tombstone the unverified row and create a fresh user for the Google login, so no attacker-set password, token, or pending verification survives. If the row must be kept, null the password hash and verification token and make sure JWTs issued before the link are rejected.

### 4.3 Email verification on Google signup

- Option A, trust `email_verified: true` always. Simple; contradicts Google's own guidance for the non-authoritative case.
- Option B, set `email_verified_at` only when `email_verified` is true AND (`hd` is present OR the address ends in `@gmail.com`); otherwise send our normal verification email. Follows Source B exactly. Slight friction for a small population.

### 4.4 `sub` mismatch for a known email and `hd` (the Truffle case, or the disputed `sub` drift)

- Option A, treat as a new person: refuse to attach to the existing account, surface "this Google account is not linked to the existing Soup.net account" and route to recovery. Safe; if `sub` drift is real it costs a support interaction.
- Option B, fall back to email + `hd`. Reintroduces the exact vulnerability.
- Option C, as A, with an org-admin re-link action (audit-logged, member-visible) as the recovery path for managed accounts. Fits the program's observability principle.

### 4.5 Carrying the authorize request

- Option A, `?next=` query parameter through login, validated as a same-origin relative path. Common, but it is a validation-based defense and the RFC's wording is to avoid forwarding to URIs from query parameters.
- Option B, SPA stashes the pending authorize URL in `sessionStorage` before leaving, reads it back after login. No redirector on the server. Breaks if Google's flow completes in a different tab or browser context, and ties correctness to frontend state.
- Option C, server-side pending-request record keyed by the opaque `state` (or an integrity-protected cookie), with the return target restricted to a fixed set of SPA routes plus stored parameters. Most robust; one small table or signed cookie.

## 5. Recommendation

1. Add `user_identities` as in §4.1 option B, keyed unique on (`issuer`, `subject`). Make `users.password_hash` nullable. Leave `users.provider` / `external_id` unused and drop them in a later migration.
2. Validate every ID token server-side with a maintained library: signature, `aud` equals our client ID, `iss` is Google, `exp`, and our `nonce`. Use the authorization code flow from the backend as a confidential client with PKCE S256, a one-time `state` bound to the browser, and a `nonce`. Request `openid email profile` only.
3. Use `hd`, never the email suffix, for org matching, auto-join, and `require_sso`. Treat absent `hd` as a consumer account even when the address is on a customer's domain; such a login must not join the org and should be told to sign in with the company's Workspace account.
4. Set `email_verified_at` from Google only under §4.3 option B.
5. Linking: §4.2 option B for verified accounts (password or emailed link, once), and replace rather than merge for unverified accounts. Keep the `/register` no-enumeration property (recipe `b0d728f7`): the "an account already exists" prompt is shown only after a successful Google authentication, to a party Google has authenticated for that address, which is a smaller oracle than a public endpoint but should still be reviewed in the security workflow.
6. `sub` mismatch: §4.4 option C. Never fall back to email.
7. Build a session-invalidation primitive before shipping linking or `require_sso`: a per-user "tokens not valid before" timestamp checked in the per-request user lookup that the disable feature already needs (program §3.8). Linking, password reset, `require_sso` activation, and disable all bump it.
8. `require_sso`: per-org policy over verified domains. When on, password login, password reset, and email change away from the domain are refused for matching users; guests are unaffected; org owners keep a break-glass path (decision needed on its form, see §6). Turning it on logs affected users out, as Notion does. Pair with auto-join safeguards from §3 point 6: DNS re-verification that freezes auto-join, and an admin-visible event per auto-join.
9. MCP authorize round trip: §4.5 option C, plus a single-use handoff code from the backend Google callback to the SPA instead of a JWT in the URL. Document it in ADR-0022.
10. Google Cloud project: External audience, In production, brand verification for name and logo. Defer the Directory scope until a customer asks for authoritative sync; budget for Google's sensitive-scope review if that day comes.

## 6. Open questions for the operator

1. Break-glass under `require_sso`: do org owners keep a password (Notion's model), or is recovery a site-admin concierge action? A retained owner password is the one credential the company's Google admin cannot revoke.
2. Linking friction: is a one-time "confirm your existing password or click the emailed link" step acceptable for existing users adding Google, or do you want silent linking once session invalidation exists?
3. Consumer Google accounts on a customer domain (no `hd`): refuse outright when the domain belongs to an org with `require_sso`, or allow them as personal accounts? The managed-account recommendation in the program doc implies refuse.
4. Should Google sign-in be offered to non-org users at launch (gmail.com and unmanaged domains), or only to users whose `hd` matches an org? The narrower launch has a much smaller linking surface.
5. Is a server-side pending-authorize record acceptable, given the current design keeps the authorize page purely in the SPA?
6. Whether to request `access_type=offline` from day one. Google only returns the refresh token on first consent, so adding it later means re-prompting every user with `prompt=consent`.

## 7. Unverified / could not confirm

- The sensitive/restricted category of `https://www.googleapis.com/auth/admin.directory.user.readonly`. Google's public pages defer to the label shown in the Cloud Console. I expect "sensitive" but found no primary page stating it. Check in the Console before planning around it.
- Truffle's "0.04% of logins" `sub` instability figure is a second-hand quote from an unnamed engineer, and Google says it has "no evidence" for it. Treat as disputed.
- Whether Google shipped any product change after re-opening the Truffle ticket, beyond the documentation warning. I found no Google statement describing one.
- Whether suspending or deleting a Workspace user revokes that user's refresh tokens for third-party apps (program §3.9 option C). Source I's list of refresh-token failure reasons does not mention account suspension. This needs its own source before option C is relied on.
- Whether a customer's Workspace admin can block plain "Sign in with Google" to an app that requests only sign-in scopes, and what the user sees. Source H says only "A Google Workspace may control which third-party apps access its data". Worth confirming with the first customer's admin.
- Microsoft Entra's handling of unverified `email` claims (the "nOAuth" class), relevant when a second IdP is added. The Microsoft Learn page did not load for me, so nothing is quoted here.
- The MSRC author order and affiliations are from the blog byline and a search snippet; the paper lists Avinash Sudhodanan (independent researcher) and Andrew Paverd (MSRC).
- Whether registration of an unverified account creates rows (personal org, default book) that a "replace, don't merge" rule must also clean up. This is a codebase check, not web research, and I did not trace it.
