# ADR-0022: The OAuth connector flow, and Sign in with Google

**Date:** 2026-10-26
**Status:** Accepted

---

## Context

Soup.net is an OAuth 2.1 authorization server for MCP clients (claude.ai's custom connector, ChatGPT, Codex) and, since organization accounts round 1, an OpenID Connect relying party toward Google. The authorization server shipped in 2026-06 without its rationale written down (`routes/oauth.ts` said "ADR-pending"); the OpenAI plugin directory round (stream O, PR #152, [openai-plugin-build/oauth.md](../planning/openai-plugin-build/oauth.md)) extended it; and stream SSO (PR #155, [org-accounts-build/sso.md](../planning/org-accounts-build/sso.md)) added Google sign-in, which the consent page reuses. This ADR records both halves, because the second runs through the first: a signed-out person on the consent page now signs in with Google and comes back.

## Decision

### 1. The authorization server

- **The access token is an API key.** An OAuth access token is an `api_keys` row with `key_type = 'oauth'`, a one-hour life and a 30-day refresh token, judged by the same `authenticateKey` as every key (the authz module). There is no separate token store, so disabling an account, a membership change or a dead parent reaches OAuth clients the way it reaches every key.
- **Scope is coarse; books are structured.** The OAuth `scope` string carries `read`, `write`, `openid` and `email`. Which recipe books a connection reads and writes is the person's choice on the consent page, stored in the key's `read_group_ids`, `write_group_ids` and `default_write_group_id`, never encoded in `scope`.
- **PKCE S256 is mandatory and redirect URIs match exactly** (audit F44). The consent page refuses up front a redirect URI not registered for the client, and the grant checks again server-side. Cancel is a server-built `access_denied` redirect through the same check.
- **Refresh rotates atomically** (F38). A dedicated `consumed_at` marker (migration 0028) with a compare-and-swap `UPDATE ... WHERE consumed_at IS NULL`, and rotation revokes the old access token by truncating its `expires_at` to the epoch, so a stolen access token dies with its bundle and mixed-version deploys can't mint two families (recipe efeaab7a).
- **After stream O:** the protected resource is the server's origin, which is also the `issuer`. Tokens are bound to it (RFC 8707 `resource`; the `/mcp` endpoint URL is an accepted alias; anything else is `invalid_target`). Every authorization response carries RFC 9207 `iss`. Client ID metadata documents are accepted beside dynamic registration, fetched through a guard that resolves only public addresses. `GET /oauth/userinfo` serves `sub` and, when `email` was granted, `email`, with no ID tokens and no OpenID Provider metadata, since the server holds no signing keys for them (recipes 0cfb2ec7, c1c4bbd1, 6ba99331).

### 2. Sign in with Google

- **Identities are keyed on issuer and `sub`, never email** (`user_identities`). Google and OpenID Connect both say `sub` is the only stable identifier, and a buyer of a lapsed company domain inherits its `hd` and email but not its `sub`.
- **The round trip is bound to the tab that starts it** (recipe 49937af3). The SPA (`soup.net`) and the API (`mcp.soup.net`) are different origins and the session lives in `localStorage`, so a cookie can't bind the flow without credentialed cross-origin requests. Instead the tab keeps a random secret in `sessionStorage` and sends its SHA-256. The backend stores a pending record keyed by the hash of an opaque `state`, holding Google's PKCE verifier, the nonce, the secret's hash and the return target (validated parameters, never a URL). Google's callback consumes the record before calling Google, so a replay ends like an unknown state. It answers with a fixed SPA page whose fragment holds either a single-use 60-second handoff code or a code from a closed list. The SPA exchanges the code only together with the secret. A login-CSRF attacker's handoff link is useless in the victim's tab.
- **Which account** (recipe 3a943b1c). An identity linked by issuer and `sub` signs in. Otherwise an account holding the email is linked only when Google is authoritative for the address: `@gmail.com`, or `email_verified` with `hd` set, per Google's own guidance. Linking is silent (the operator's settled simplification). An unverified account is a pre-registration, so linking takes it over: its password and any other Google identity are discarded, its tokens cleared, it is marked verified, and its sessions are cut through `users.sessions_valid_after`. A verified account already linked to a different `sub` is refused, never relinked by email. A non-authoritative address links nothing; with no account, it creates an unverified one and our verification email goes out.
- **A Google sign-up is a registration.** It meets the same cap, waitlist and invitations, and records the terms through a line beside the button. Stream Domains' auto-join on `hd` runs inside the same transaction through one hook.
- **`openid email profile` only, no offline access.** These scopes need no Google review; offboarding reads the company's directory through a separate, per-organization connection.

### 3. `require_sso`

An organization can require its members to sign in with Google Workspace (recipe 8b68ea10). Each session token says how it was issued: `idp` is `google` for a Workspace identity, `google-consumer` for one without `hd`, and absent for a password. The per-request session lookup refuses any other session for an active member, and password sign-in, password reset and reset email are refused too. Turning the policy on ends every password session at once with nothing swept, and turning it off restores them. An owner or admin can turn it on only from a Workspace Google session of their own. There is no break-glass path; the site operator helps by hand.

## Consequences

- One login page and one consent page serve password and Google sign-in, and the consent page returns a signed-out person to itself either way. Password sign-in returns through the audited same-origin rule, which now allows exactly `/oauth/authorize`.
- `users.password_hash` is nullable. Every reader handles null: login compares a dummy hash and answers like a wrong password, and deleting a password-less account is confirmed by a Google sign-in under ten minutes old.
- The residual lapsed-domain risk of silent linking is accepted: whoever recreates a lapsed company domain's Workspace could link into a dormant verified password account. Asking for the password at that link was proposed and rejected (draft `06f7ff88`): "Password reset would have the exact same problem anyways, this solves no security issue and is just overthinking." (the operator, 2026-10-26). Whoever controls the mailbox can already reset the password by email.
- Self-hosters without a Google client see no Google button and no new routes (the `/auth/google/*` routes answer 404).

## References

- [org-accounts-research/google-sso-oidc.md](../planning/org-accounts-research/google-sso-oidc.md): sources for every Google claim above.
- [product-specs/google-sign-in.feature](../product-specs/google-sign-in.feature): the scenarios, realized in `apps/backend/src/routes/google-auth.test.ts`.
- RFC 9700 (OAuth 2.0 Security BCP), RFC 7636 (PKCE), RFC 8707, RFC 9207.
