# Derived API keys: an orchestrator mints scoped-down keys for its sub-agents

Status: **design direction decided by the operator 2026-09-19** (recipe [eb4b77eb](https://www.soup.net/traces/eb4b77eb-8ec7-469a-a059-ac0cccc8251c)), superseding the same-day "session as scoped auth" lean ([7835c60d](https://www.soup.net/traces/7835c60d-7c0e-41f2-b9d6-82427351760a)) and the four-option analysis that preceded it (kept in git history). Optional track, separate from the [organization accounts program](org-accounts-program.md). Sourced research: [org-accounts-research/credential-attenuation.md](org-accounts-research/credential-attenuation.md).

## The decision

> "Note the default case: a sub agent gets the parent agent's mcp credentials. So all we're doing is giving it a scoped down credential instead."

> "Let's just keep the term as api key and make the mechanism exactly the same as our existing api keys so we're actually not inventing anything at all to add to all the other intent / recipe check / search / feedback etc endpoints. Then all we're doing is adding a new field to the api key database with an optional parent api key."

An orchestrating agent asks for a new API key derived from its own. The new key is an ordinary API key in every respect: same table, same hashing, same validation, same behavior on every existing surface. It has a narrower book scope, a short lifetime, and a pointer to its parent.

- **Schema:** one nullable `parent_key_id` on `api_keys`. Nothing else.
- **Lifetime:** one-hour default, matching the convention the research found (AWS STS, GitHub installation tokens). Never longer than the parent's remaining life.
- **Revocation:** a derived key is dead whenever its parent is, enforced by a join at validation, consistent with the disable-user ruling (`92b866ee`). No sweep over child rows.
- **Human UI:** derived keys appear nested under their parent on the API keys page, with the same controls.
- **OAuth parity:** an OAuth-connected MCP client can derive keys too. OAuth-issued keys should also appear in the API keys list (see open points).
- **Intents, checks, search, feedback:** unchanged. Many intents per key already works, because an intent records the key that registered it (`intents.api_key_id`).
- **Authorship:** unchanged. A derived key has its parent's `user_id`, so recipes remain the human's taste and judgment, with the sub-agent visible through the key label and `agent_id`.

No new concept, no new noun. "Session" stays retired as the legacy dedup token, on its existing deprecation path.

## What keeps it safe

The operator's standing rule is that key scope only ever narrows (`2f9c5fdd`), and every system in the research states the same invariant in its own words (AWS: "You cannot use session policies to grant more permissions than those allowed"; Vault: policies "must be a subset of the policies belonging to the token making the request").

- `read_books` must be a subset of the parent's, `write_books` likewise, the default write book must be in the write set, and expiry can't exceed the parent's. Enforced on the server, rejected loudly otherwise.
- Reuse the validation the human key-creation path already has. That path checks requested books against the user's memberships; the derive path runs the same checks against the parent key's arrays instead. The OAuth consent screen and the key form once drifted apart on the write-subset-of-read invariant (`3cc5b92e`), which is the argument for one shared function with two allowlist sources.
- A derived key can't derive further (depth of one) until orchestrator trees need it.
- Derived keys can't create ephemeral workspaces, since that is the one path where a key's scope grows, and can't hold OAuth refresh tokens.
- A per-parent mint budget and a cap on live children, counted in their own table or column following the intent-registration precedent rather than in `audit_log`. A `key.derived` audit event recording parent and child ids.
- Default label in the existing house format (`cf8973f7`): parent label, agent id, date.

## Things the operator should know

1. **This needs a named exception to a standing, CI-enforced ruling.** Recipe `f1543441` (2026-07-06) established that raw API keys never appear in any response outside human-only JWT auth. A derive call authenticated by an API key returns a raw key to an agent. The argument for the exception is the operator's own framing: the caller already holds a strictly stronger credential than the one being returned, so the response discloses nothing the caller couldn't already do. The exception should be written down as exactly that (a response may carry a key only when it is strictly weaker than the credential that authenticated the request), allowlisted for the one route in the CI check, and covered by a test.
2. **OAuth parents rotate hourly.** An OAuth access token's row is consumed at every refresh and replaced by a new row. If a child's validity is chained to its parent row, every child of an OAuth key dies at the parent's next refresh, which could be minutes after minting. Two ways out: accept it and cap a child's life at the parent row's remaining life (simple, sometimes very short), or re-point live children to the successor row inside the existing refresh transaction (one UPDATE in a transaction that is already rewriting key rows, so children follow the grant rather than the hour). Recommend the second. Daily keys don't have this problem, since a one-hour child fits inside a day.
3. **Scoping is exactly what a person gets on the key form.** Read and write are chosen separately, per recipe book. The agent's workflow is the person's workflow: it is making a key for its own agent. The only difference is the parent key, which sets the outer boundary; the new key can narrow inside it and never widen. So a research sub-agent can be given read on several books and write on one, or write nowhere it shouldn't. One shared constraint worth knowing: the key form today requires at least one write book, because the default write book must be in the write set (`routes/keys.ts:135`) and the column is NOT NULL. That applies to people and agents alike. A key with no write book at all (what an unattended PR reviewer should hold) means relaxing that one rule once, for both. Expiry works the same way: choose any lifetime up to the parent's.
4. **Handing the key to the sub-agent.** The research found that a Claude Code custom sub-agent definition can declare its own MCP connection with its own headers, so the sub-agent connects with the derived key and the secret never appears in a prompt (prompts persist in sub-agent transcripts for 30 days by default). Built-in sub-agent types inherit the parent's connection instead, as this program's own research fleet showed. Whether an orchestrator can set those headers per spawn needs a short prototype. The universal fallback is the REST surface with the key as a Bearer header.
5. **Keys in URLs stay a problem of their own.** RFC 9700, the current MCP spec, and OWASP all reject credentials in query strings, and OWASP rejects the short-lifetime defence explicitly. Derived keys shrink the exposure on `/check?key=` but the backlog's Bearer-on-`/check` item still stands.
6. **This is auth code.** `docs/workflows/security.md` applies: latest audit read first, audit and implementation kept separate, a test per rule. The research doc ends with an invariant list and a test checklist for the mint path. One missed subset check is a privilege escalation.
7. **Surface weight.** The operator prefers general, minimal agent-surface changes (`ded7f5ed`). This adds one agent-callable operation, the twin of the human `POST /keys`, exposed on the agent host as REST plus one MCP tool. It is agent-only by consumer (`74b88762`); humans keep using the dashboard.

## Open points

Settled 2026-09-19: the `f1543441` exception as worded above; OAuth parents re-point their children inside the refresh transaction; lifetime defaults to one hour and can be set to anything up to the parent's remaining life (the caller just scopes it down, like everything else).

1. OAuth keys in the API keys list: `listKeys` doesn't filter by key type, so the rows may already be returned and simply not presented as connections. Needs a look at the page. Rotation means a raw list would show a new row every hour, so the UI should probably show one entry per connected client (grouped by `oauth_client_id`) with its derived keys nested beneath. Parked in the backlog's web UI list.
2. When scope is omitted on a derive call, inherit the parent's scope (GitHub's precedent) or require explicit books? Recommendation: require explicit books, so narrowing is a deliberate act.
