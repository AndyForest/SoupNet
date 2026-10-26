# Stream O: OAuth hardening (OpenAI plugin directory round)

Plan: `docs/planning/openai-plugin-directory.md` (draft PR #148), items 1, 2, 8, 10, 11, 12 and 14. Branch `plugin/oauth-hardening`, worktree `SoupNet-wt/e-read-paths`, agent `a-plugin-oauth-2026-10-26`, Soup.net intent `int_DxY7CUXz00XWoKyLaz0dgDL5`. This file is the stream's append file; the last stream to merge folds it into the shared docs.

Security workflow: the latest audit read first (companion repo, `audit-2026-10-24-drafts-slices-6-9/closing-2026-10-26.md`, plus the OAuth findings of `security-audit-2026-06-11.md`: F38 refresh race, F39 rate limits and sweep, F44 consent phishing and the Cancel open redirect, F50 refresh carries the grant, F51b reuse detection still open). Every auth change below has a test. The auditor is a separate role; this stream does not audit itself.

## Decisions (recipe-checked)

- **The protected resource is the server's origin.** The canonical `resource` is the issuer (`BACKEND_URL`, `https://mcp.soup.net` in production), unchanged from today's protected-resource metadata. ChatGPT sends the metadata's value byte for byte ("ChatGPT sends this exact value as the `resource` query parameter during OAuth", OpenAI auth page), which settles the plan's open question: no `/mcp` path. The MCP endpoint URL (`<origin>/mcp`) is accepted as an alias at authorize and token, because the MCP specification's clients send the endpoint as the canonical URI; any other value is `invalid_target`. Recipe `0cfb2ec7`.
- **Audience is judged where every key is judged.** `authenticateKey` gains one guard: an OAuth key is live only when its stored audience equals the canonical resource now. A key with no audience (minted before this change) fails it, the client gets the 401 that makes it refresh, and the refresh binds the new token to the canonical resource. Daily and scoped keys carry no audience and are unaffected. A refresh may name a resource; it must normalize to the connection's audience.
- **The tool-level challenge rides in the 401.** Every unauthenticated or dead-key request keeps HTTP 401 with the protected-resource challenge (recipe `3dc8c00c`; the MCP specification requires it, and it is the refresh signal). For a `tools/call`, the 401's JSON-RPC body is a tool error result whose text is the shared remediation copy (recipe `4f649472`) and whose `_meta["mcp/www_authenticate"]` carries the challenge with `error` and `error_description`. Each tool's `_meta.securitySchemes` is derived from its `readOnlyHint` (`read`, or `read` and `write`). SDK 1.30 emits `_meta` but not a top-level `securitySchemes`, and OpenAI's reference calls the `_meta` copy the mirror for clients that read only `_meta`. Recipe `3350158d`.
- **Client ID metadata documents are open to any https client.** A `client_id` that is an https URL is fetched (public addresses only, no redirects, 5 s, 5 KB for the document and 20 KB for keys), validated (`client_id` equals the URL, exact redirect URIs, `token_endpoint_auth_method` `none` or `private_key_jwt`, keys from the same origin as the document), and cached briefly in memory. No host allowlist: advertising CIMD tells every client to use it. Recipe `c1c4bbd1`.
- **`openid` and `email` without OpenID Connect conformance.** Both scopes are accepted and recorded on the connection; `GET /oauth/userinfo` returns `sub` always and `email` with `email_verified` only when `email` was granted; `userinfo_endpoint` is in the RFC 8414 metadata. No ID tokens and no `/.well-known/openid-configuration`, because both would claim signing keys the server does not have. Recipe `6ba99331`.
- **One migration, number 0043**, claimed at this branch's first push: the resource and the granted OpenID scopes on `oauth_authorization_codes` and on `api_keys`. The slice 9 follow-up (`check_feedback.user_id`) moves to 0044.

## Rubric

Each row names its proof. "Live" means the integration suite against a running backend (`oauth.test.ts`, `oauth-flow.test.ts`, `mcp-*.test.ts`); "unit" means a service or pure-function test with injected transport.

### O1 Audience-bound tokens (item 1)

- **O1-1** The protected-resource metadata's `resource` and the authorization-server metadata's `issuer` are the same string, and `authorization_servers` is `[issuer]`. Live.
- **O1-2** `resource` normalizes: the canonical value, the canonical value with a trailing slash, and `<canonical>/mcp` all map to the canonical value; anything else (another origin, another path, a fragment, a non-URL) is refused. Unit.
- **O1-3** The grant refuses an unknown `resource` with `invalid_target` and mints no code; an absent `resource` binds the code to the canonical value. Live.
- **O1-4** The token exchange refuses a `resource` that differs from the code's with `invalid_target` (the code is consumed, as for any other code mismatch); the issued token's row carries the canonical audience. Live, with a DB read.
- **O1-5** An OAuth access token whose stored audience differs from the canonical value, or is missing, is refused at `/mcp` with the same 401 and body as any dead key (no oracle), and at the REST surfaces as any dead key. Live, rows planted.
- **O1-6** Refresh carries the audience forward; a refresh naming a different resource is `invalid_target` and does not consume the token; a refresh of a pre-migration row (no audience) binds to the canonical value. Live.
- **O1-7** Daily and scoped keys authenticate exactly as before. The existing key-auth suite passes unchanged.

### O2 Domain challenge file (item 2)

- **O2-1** `GET /.well-known/openai-apps-challenge` returns 200 `text/plain` with exactly the value of `OPENAI_APPS_CHALLENGE_TOKEN` (no JSON, no trailing newline added) when it is set. Unit against the route with the variable set.
- **O2-2** With the variable unset or empty, the path is 404. Live (the CI stack leaves it unset).
- **O2-3** The companion repo's Terraform carries a variable for it (default empty) wired into the task definition's environment, written here and applied by the operator.

### O3 Refresh after idle (item 8)

- **O3-1** The 2026-07 report is settled: an access token past its one-hour life is refused at `/mcp` with 401 `invalid_token`, and a refresh with its refresh token succeeds and the new token works. The existing test (`oauth-flow.test.ts`, "refresh succeeds after the access token's natural expiry", fix `a383fee`, migration 0028) is extended to the ChatGPT sequence: `resource` on authorize and token, idle past expiry, the 401, refresh with `resource`, the new token works with the same audience.

### O4 RFC 9207 `iss` (item 10)

- **O4-1** The metadata says `authorization_response_iss_parameter_supported: true`.
- **O4-2** The success redirect carries `iss` equal to the metadata `issuer`, byte for byte, beside `code` and `state`. Live.
- **O4-3** The access-denied redirect (Cancel) carries `iss` too. It is built by the server (`POST /oauth/authorize/deny`), which validates the client and the exact redirect URI the same way the grant does, so Cancel's F44 check also moves server-side. Live, plus the page's unit test.
- **O4-4** No other authorization response redirects: a request the consent page cannot trust (unknown client, unregistered redirect URI, missing PKCE) renders an error page and never navigates to the client, as today.

### O5 Client ID metadata documents (item 11)

- **O5-1** Metadata: `client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported` lists `client_secret_post`, `client_secret_basic`, `none` and `private_key_jwt`, and `token_endpoint_auth_signing_alg_values_supported` lists the accepted algorithms (RS256, ES256).
- **O5-2** The fetch guard refuses: a non-https URL, credentials or a fragment in the URL, a name that resolves to a loopback, private, link-local, shared, multicast or reserved address (IPv4 and IPv6, mapped forms included), any redirect, a response over the size cap, a non-200, a slow response, and non-JSON. The address check runs on the address the socket connects to, not a separate lookup. Unit.
- **O5-3** Document validation refuses: `client_id` not equal to the URL, missing or invalid `redirect_uris`, an auth method other than `none` or `private_key_jwt`, a `client_secret` in the document, `private_key_jwt` without keys, and a `jwks_uri` on another origin. Unit.
- **O5-4** Consent: `/oauth/client-info` for a CIMD client returns its name, redirect URIs and verified domain; the page shows the domain as the client's identity. An unfetchable or invalid document is the same "unknown client" answer as an unregistered id. Unit and live (an unresolvable CIMD id).
- **O5-5** Grant: a CIMD client's redirect URI must be in its document, exactly. Unit.
- **O5-6** Token, `none`: no secret accepted or required; PKCE is the proof; a client secret presented by a CIMD client is refused. Unit.
- **O5-7** Token, `private_key_jwt`: the assertion is accepted only with `client_assertion_type` `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, an algorithm in the accepted list (never `none` or HMAC), a signature by a key from the document's JWKS matching `kid`, `iss` and `sub` equal to the client id, `aud` naming the token endpoint or the issuer, `exp` in the future and no more than five minutes ahead, and a `jti` not seen before (per process, held until `exp`). Unit, with a generated key pair.
- **O5-8** DCR clients behave exactly as before. The existing suites pass unchanged.

### O6 Per-tool security schemes and the tool-level challenge (item 12)

- **O6-1** Every tool in `tools/list` carries `_meta.securitySchemes`: `[{ type: "oauth2", scopes: ["read"] }]` for a read-only tool and `["read", "write"]` otherwise, derived from its annotations so a later annotation change carries through. Unit (in-process server), and a guard that fails if a tool lacks it.
- **O6-2** An unauthenticated `tools/call` gets HTTP 401 with the existing `WWW-Authenticate` header, and a JSON-RPC body with the request's `id` whose `result` is `isError: true`, the remediation text, and `_meta["mcp/www_authenticate"]` naming the protected-resource metadata with `error` and `error_description`. A dead key gets the same with `error="invalid_token"`, byte-identical across kinds of dead key. Live.
- **O6-3** Every other unauthenticated method keeps today's 401 body. Live (existing tests).

### O7 OpenID scopes and UserInfo (item 14)

- **O7-1** `scopes_supported` lists `read`, `write`, `openid` and `email`; `userinfo_endpoint` is advertised.
- **O7-2** The grant records `openid` and `email` when the request's `scope` asks for them, and ignores scope values it does not know; the token response's `scope` lists what was granted. Live.
- **O7-3** `GET /oauth/userinfo` with an OAuth token granted `openid` returns `sub` (the user id); with `email` also, `email` and `email_verified`. Without `openid`: 403 `insufficient_scope`. A daily or scoped key, a dead token, or no token: 401 with the challenge. Live.
- **O7-4** The consent page says when the client asked to see the email address.

### O8 Gates

- **O8-1** `npm run test:ci` green; `check:authz-seam` fingerprints refreshed with reasons for every changed statement on `claimnet.api_keys`.
- **O8-2** `docs/connectors/openai-plugin.md` is stream T's; this stream writes the OAuth section of the server's connector doc (`docs/connectors/` OAuth paragraph, the `.env.example` line) and nothing in T's or L's files.
- **O8-3** A separate security audit of the branch before merge (the operator launches it; findings go to the companion repo).

## Build notes

(appended as the stream works)
