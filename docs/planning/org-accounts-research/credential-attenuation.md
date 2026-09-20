# Credential attenuation: scoped-down credentials an orchestrator mints for its sub-agents

Status: research pass for [derived-agent-keys.md](../derived-agent-keys.md). All sources accessed 2026-09-19. Quotes are verbatim; page dates are given where the page shows one. Internet-Drafts are flagged as drafts wherever they appear. Sections 3 to 6 are interpretation and are labelled as such.

## 1. Question

An orchestrating agent holds the user's API key. Can it mint a strictly weaker, short-lived credential for each sub-agent without involving the human, and what does the prior art say about (a) the invariant that the derived credential never exceeds the parent, (b) revocation cascades, (c) lifetimes, (d) credentials in URLs, (e) emerging AI-agent and MCP authorization guidance, (f) what Claude Code sub-agents can actually reach, and (g) what to call the derived thing?

## 2. Findings

### 2.1 Prior art and the "never exceeds the parent" invariant

**Macaroons** (Birgisson, Politz, Erlingsson, Taly, Vrable, Lentczner; NDSS 2014). [Google Research publication page](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/), [paper PDF](https://theory.stanford.edu/~ataly/Papers/macaroons.pdf).

- "Although macaroons are bearer credentials, like Web cookies, macaroons embed caveats that attenuate and contextually confine when, where, by who, and for what purpose a target service should authorize requests." (abstract)
- The narrowing-only rule is expressed as conjunction of caveats: "A macaroon may have multiple caveats on the same attribute, such as time, in which case all the caveats' predicates must hold true in the context of requests." (Section II)
- The paper names server re-minting as one of three legitimate patterns. Figure 2 caption: "Three ways for an intermediary service IS to give a client C limited access to a target service TS: by proxying requests, by having TS mint new, restricted credentials for C, or by IS deriving new macaroons for C."
- What offline derivation buys: "by adding caveats, new, more restricted authorization credentials can be directly derived from macaroons, without proxying requests to the target service, or re-minting new credentials from it." (Section II)
- What opaque server-side identifiers buy: "Such identifiers have the nice property of being completely opaque and allowing revocation to be simply done by deleting a database row; however, the downside is that the target must maintain a database, either centralized or replicated across the servers operating the service." (Section V)
- The target may still apply its own checks beyond the token: "upon use of a macaroon, target services need not only check that all caveats are discharged, but may also perform additional access control, for example, to check continued ownership of the accessed resource." (Section VIII)

**Biscuit.** [Biscuit documentation, Introduction](https://doc.biscuitsec.org/getting-started/introduction).

- "Biscuit also supports offline attenuation (like Macaroons). Meaning that from a Biscuit token, you can create a new one with more restrictions, without communicating with the service that created the token. The token can only be restricted, it will never gain more rights."
- "Only the authority block can be created by the token emitter, while the other blocks can be freely added by intermediate parties (offline attenuation)."
- "This is the main mechanism for attenuation: take an existing token, add a check for the current date (expiration) or the operation (restrict to read only)."

**OAuth 2.0 Token Exchange, RFC 8693** (January 2020). [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html).

- Downscoping is a named use: "The new token might be an access token that is more narrowly scoped for the downstream service or it could be an entirely different kind of token." (Section 1)
- Impersonation: "When principal A impersonates principal B, A is given all the rights that B has within some defined rights context and is indistinguishable from B in that context." (Section 1.1)
- Delegation: "With delegation semantics, principal A still has its own identity separate from B, and it is explicitly understood that while B may have delegated some of its rights to A, any actions taken are being taken by A representing B. In a sense, A is an agent for B." (Section 1.1)
- The `act` claim: "The \"act\" (actor) claim provides a means within a JWT to express that delegation has occurred and identify the acting party to whom authority has been delegated." (Section 4.1)
- Chains: "A chain of delegation can be expressed by nesting one \"act\" claim within another. The outermost \"act\" claim represents the current actor while nested \"act\" claims represent prior actors." (Section 4.1)
- RFC 8693 does not itself state a subset rule. It leaves policy to the deployment: "the specific syntax, semantics, and security characteristics of the tokens themselves (both those presented to the authorization server and those obtained by the client) are explicitly out of scope, and no requirements are placed on the trust model in which an implementation might be deployed." (Section 1) The "never exceeds" language has to come from the implementing system, as it does in the AWS, Google, GitHub and Vault quotes below.

**AWS STS session policies.** [AssumeRole API reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html), [IAM User Guide, Policies and permissions, Session policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session).

- "The resulting session's permissions are the intersection of the role's identity-based policy and the session policies." (AssumeRole)
- "You cannot use session policies to grant more permissions than those allowed by the identity-based policy of the role that is being assumed." (AssumeRole)
- "Session policies limit permissions for a created session, but do not grant permissions." (IAM User Guide)

**Google Cloud Credential Access Boundaries.** [Credential Access Boundaries for Cloud Storage](https://cloud.google.com/iam/docs/downscoping-short-lived-credentials) (page shows "Last updated 2026-09-16 UTC"), [Create a downscoped credential](https://cloud.google.com/iam/docs/create-downscoped-short-lived-credentials).

- "You can use Credential Access Boundaries to generate OAuth 2.0 access tokens that represent a service account but have fewer permissions than the service account."
- "To downscope permissions, you define a Credential Access Boundary that specifies which resources the short-lived credential can access, as well as an upper bound on the permissions that are available on each resource."
- The broker pattern matches the orchestrator pattern: "The token broker is responsible for defining the Credential Access Boundary and exchanging an access token for a downscoped token." and "The token consumer requests a downscoped access token from the token broker, then uses the downscoped access token to perform another action."
- Scope limit of the feature: "Credential Access Boundaries are only available for Cloud Storage. Other Google Cloud services don't support this feature."

**GitHub App installation access tokens.** [Generating an installation access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [REST: Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).

- "The installation access token cannot be granted access to repositories that the installation was not granted access to."
- "The installation access token cannot be granted permissions that the app was not granted."
- Default when the caller does not narrow: "If `permissions` is not specified, the installation access token will have all of the permissions that were granted to the app."

**GitHub fine-grained personal access tokens.** [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

- "Each token can be further limited to only access specific repositories for that user or organization."
- "You should choose the minimal repository access that meets your needs." and "You should choose the minimal permissions necessary for your needs."
- These are minted by a human in the UI, not derived by a credential holder. They are prior art for the scoping vocabulary (resource subset plus permission subset), not for agent-side derivation.

**HashiCorp Vault child tokens.** [Tokens concept page](https://developer.hashicorp.com/vault/docs/concepts/tokens), [Token auth method API](https://developer.hashicorp.com/vault/api-docs/auth/token).

- On the `policies` parameter of token create: "A list of policies for the token. This must be a subset of the policies belonging to the token making the request, unless the calling token is root or contains sudo capabilities to auth/token/create."
- "Normally, when a token holder creates new tokens, these tokens will be created as children of the original token; tokens they create will be children of them; and so on."

**Internet-Draft, individual submission, not adopted: Attenuating Authorization Tokens for Agentic Delegation Chains** (draft-niyikiza-oauth-attenuating-agent-tokens-01, 15 June 2026, expires 17 December 2026). [Datatracker](https://datatracker.ietf.org/doc/draft-niyikiza-oauth-attenuating-agent-tokens/), [text](https://www.ietf.org/archive/id/draft-niyikiza-oauth-attenuating-agent-tokens-01.txt). This is the closest published statement of the exact invariant list the design notes want. It is a draft from a single author and carries no standards weight.

- "Any holder can derive a more restrictive token offline that narrows or maintains scope but cannot expand it." (abstract)
- "Every derived token in a chain MUST satisfy all of the following invariants." (Section 4)
- TTL: "A derived token cannot outlive its parent. Authority cannot extend beyond the lifetime of the token that granted it." (Section 4.4)
- Capability: "A derived token MUST NOT authorize tools that the parent did not authorize." (Section 4.5)
- Depth: "Intermediate token holders can only lower del_max_depth, never raise it (I2), so the root issuer's depth bound is enforced by chain verification across the entire chain." (Section 4.3)

### 2.2 Revocation cascades and documented pitfalls

**Vault.** [Tokens concept page](https://developer.hashicorp.com/vault/docs/concepts/tokens).

- "When a parent token is revoked, all of its child tokens -- and all of their leases -- are revoked as well. This ensures that a user cannot escape revocation by simply generating a never-ending tree of child tokens."
- Orphans are the documented escape hatch and are privilege-gated: "Often this behavior is not desired, so users with appropriate access can create orphan tokens. These tokens have no parent -- they are the root of their own token tree."
- The documented pitfall: "Users with appropriate permissions can also use the auth/token/revoke-orphan endpoint, which revokes the given token but rather than revoke the rest of the tree, it instead sets the tokens' immediate children to be orphans. Use with caution!"
- Batch tokens show the same chained-validity idea the design notes propose: batch-token leases "are revoked when the batch token's TTL expires, or when the batch token's parent is revoked (at which point the batch token is also denied access".

**AWS.** A pitfall in the intersection rule, from the [IAM User Guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session): "A resource-based policy can specify the ARN of the session as a principal. In that case, the permissions from the resource-based policy are added after the session is created. The resource-based policy permissions are not limited by the session policy." A grant made directly to the derived credential sits outside the attenuation.

**AWS chaining limit.** [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html): "Role chaining limits your AWS CLI or AWS API role session to a maximum of one hour."

**Offline tokens give up per-token revocation.** The AAT Internet-Draft (draft, see above) says so directly: "Revocation of individual AATs, including derived tokens, is outside the scope of this specification. The offline delegation model trades per-token revocation granularity for verifiability without authorization server availability." (Section 8.9) The macaroons paper lists the general strategies: "this challenge has been addressed by (i) using very short-lived credentials, (ii) allowing the addition of freshness constraints, (iii) relying on external, authoritative state (such as revocation lists, or epoch counters), and (iv) splitting credentials" (Section II).

**Long-lived broad tokens are the failure the macaroons authors were designing against.** On OAuth2 practice: "it is common to sacrifice fidelity to the OAuth2 flows, e.g., by granting longer-lived, more broadly-scoped access tokens. In this case, this might mean that the Ed image editor would receive a hard-to-revoke credential for read access to all of the user's photos FS, which might last for an hour, or more." (Section VII)

### 2.3 Lifetimes: quoted defaults

| System | Quote | Source |
| --- | --- | --- |
| AWS STS AssumeRole | "The value specified can range from 900 seconds (15 minutes) up to the maximum session duration set for the role. The maximum session duration setting can have a value from 1 hour to 12 hours." and "By default, the value is set to 3600 seconds." | [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) |
| AWS STS GetFederationToken | "federation sessions range from 900 seconds (15 minutes) to 129,600 seconds (36 hours), with 43,200 seconds (12 hours) as the default." | [GetFederationToken](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetFederationToken.html) |
| Google downscoped token | On `expires_in`: "This field is included only if the original access token represents a service account. When this field is not included, the downscoped token has the same time to expire as the original access token." The page's sample response shows `"expires_in": 3600`. | [Create a downscoped credential](https://cloud.google.com/iam/docs/create-downscoped-short-lived-credentials) |
| GitHub installation token | "The installation access token will expire after 1 hour." and "Installation tokens expire one hour from the time you create them." | [Guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [REST](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app) |
| GitHub fine-grained PAT (human-minted, for contrast) | "If not provided, the default is 30 days, or less if the target has a token lifetime policy set." | [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) |
| Vault | "The system max TTL, which is 32 days but can be changed in Vault's configuration file." | [Tokens concept page](https://developer.hashicorp.com/vault/docs/concepts/tokens) |
| Vault agent delegation tutorial | "Token lifetime is reduced from days or weeks to minutes" | [Secure agent permissions with Vault](https://developer.hashicorp.com/vault/tutorials/enterprise/secure-agent-permissions-with-vault) |
| MCP spec | "Authorization servers **SHOULD** issue short-lived access tokens to reduce the impact of leaked tokens." (no number given) | [MCP 2026-07-28, Authorization, Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) |
| AAT Internet-Draft (draft) | "Leaf tokens should be scoped to the expected duration of a single tool invocation." and "A root token with a 24-hour TTL effectively grants the holder 24 hours of authority regardless of how narrowly the capability scope is defined." | [draft -01, Appendix B.7](https://www.ietf.org/archive/id/draft-niyikiza-oauth-attenuating-agent-tokens-01.txt) |

### 2.4 Credentials in URLs and query strings

**RFC 6750** (October 2012). [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html).

- Section 2.3: "Because of the security weaknesses associated with the URI method (see Section 5), including the high likelihood that the URL containing the access token will be logged, it SHOULD NOT be used unless it is impossible to transport the access token in the \"Authorization\" request header field or the HTTP request entity-body."
- Section 2.3: "This method is included to document current use; its use is not recommended, due to its security deficiencies".
- Section 5.3: "Don't pass bearer tokens in page URLs: Bearer tokens SHOULD NOT be passed in page URLs (for example, as query string parameters). Instead, bearer tokens SHOULD be passed in HTTP message headers or message bodies for which confidentiality measures are taken. Browsers, web servers, and other software may not adequately secure URLs in the browser history, web server logs, and other data structures."

**RFC 9700, OAuth 2.0 Security Best Current Practice** (January 2025). [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). Section 4.3.2: "Clients MUST NOT pass access tokens in a URI query parameter in the way described in Section 2.3 of [RFC6750]."

**MCP specification, current revision 2026-07-28.** [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): "Access tokens **MUST NOT** be included in the URI query string".

**OWASP.**

- [Information exposure through query strings in URL](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url): "Simply using HTTPS does not resolve this vulnerability." The page's example is pointed for the short-lived-key argument: "Even if the OTP is short-lived, the exposure window creates a security risk and violates secure session management practices."
- [REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html): "Passwords, security tokens, and API keys should not appear in the URL, as this can be captured in web server logs, which makes them intrinsically valuable." and "In GET requests sensitive data should be transferred in an HTTP Header." Its "NOT OK" example is `https://example.com/controller/123/action?apiKey=a53f435643de32`.

### 2.5 Emerging guidance on AI-agent and MCP authorization

**MCP specification.** The current protocol revision is stated on the [Versioning page](https://modelcontextprotocol.io/specification/versioning): "The **current** protocol version is [**2026-07-28**]".

- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): "MCP clients **SHOULD** follow the principle of least privilege by requesting only the scopes necessary for their intended operations."
- [Security Best Practices, Scope Minimization](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices#scope-minimization): risks listed include "Expanded blast radius: stolen broad token enables unrelated tool/resource access" and "Audit noise: single omnibus scope masks user intent per operation". Mitigations include "Down-scoping tolerance: server should accept reduced scope tokens". Common mistakes include "Using wildcard or omnibus scopes (`*`, `all`, `full-access`)" and "Treating claimed scopes in token as sufficient without server-side authorization logic".
- The MCP spec covers client-to-server authorization. I found nothing in it about an agent minting credentials for sub-agents.

**IETF Internet-Drafts. All are individual drafts, none adopted by the OAuth working group as of the versions read.**

- draft-niyikiza-oauth-attenuating-agent-tokens-01 (active, 15 June 2026). Quoted in 2.1. It targets this exact problem: "An AAT encodes which tools an agent may invoke and with what argument constraints."
- [draft-oauth-ai-agents-on-behalf-of-user-02](https://datatracker.ietf.org/doc/draft-oauth-ai-agents-on-behalf-of-user/) (Senarath, Dissanayaka; WSO2; 26 August 2025; header shows "Expires: 27 February 2026", so it has lapsed). Title: "OAuth 2.0 Extension: On-Behalf-Of User Authorization for AI Agents". It concerns a user consenting to an agent, not an agent attenuating for a sub-agent.
- [draft-mcguinness-oauth-actor-profile-00](https://datatracker.ietf.org/doc/html/draft-mcguinness-oauth-actor-profile-00) exists and profiles the `act` claim. Not read in depth; listed so the operator knows it exists.

**OWASP AI Agent Security Cheat Sheet.** [Cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html).

- "Grant agents the minimum tools required for their specific task." and "Implement per-tool permission scoping (read-only vs. write, specific resources)."
- Multi-agent: "Prevent privilege escalation through agent chains."
- "Use short-lived authorization artifacts and replay protection for irreversible operations."
- Listed risk: "Sensitive Data Exposure: PII, credentials, or confidential data inadvertently included in agent context or logs."

**Anthropic, Securely deploying AI agents.** [Claude Code docs, Agent SDK, secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment).

- "The recommended approach is to run a proxy outside the agent's security boundary that injects credentials into outgoing requests. The agent sends requests without credentials, the proxy adds them, and forwards the request to its destination."
- "For example, rather than giving an agent direct access to an API key, you could run a proxy outside the agent's environment that injects the key into requests. The agent can make API calls, but it never sees the credential itself."

**Microsoft.** [Least privilege for AI agents with Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/security/zero-trust/sfi/least-privilege-for-ai-agents), [Best practices for Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/best-practices-agent-id).

- "A practical approach is to maintain a stable, lifecycle-managed agent identity while making privileges time-limited through just-in-time (JIT) entitlements (temporary role activation, short-lived tokens, or approvals) so higher privilege exists only for the duration of a specific workflow."
- "Test revocation paths, including disabling the agent, rotating credentials, invalidating tokens, and removing stale permissions."
- "For interactive agents acting on behalf of a user, use the on-behalf-of (OBO) flow so user access policies and consent apply."

**Okta.** [How to implement least privilege for AI agents](https://www.okta.com/identity-101/how-to-implement-least-privilege-for-ai-agents/).

- "Ephemeral tokens over standing credentials: Short-lived, time-bound tokens expire automatically when the task completes. This reduces reliance on manual revocation, though mechanisms to revoke active sessions remain necessary for security."
- "Human delegation chains: Where applicable, agent actions should be traceable to a human initiator or an authorized system-level policy. The audit log records who delegated the task, which agent executed it, what resources were accessed, and when."
- One point cuts against the design notes' "authorship unchanged" stance and should be read knowingly: "Separation from human credentials: Agents that impersonate users or operate under human credentials can obscure accountability and compromise forensic investigation."

**HashiCorp, Secure agent permissions with Vault** (Vault Enterprise / HCP Vault Dedicated tutorial). [Tutorial](https://developer.hashicorp.com/vault/tutorials/enterprise/secure-agent-permissions-with-vault).

- "The agent acts on behalf of a human developer and receives an effective permission set that is the intersection of three independent controls".
- "Agents can do some of what the human can do, but never all or more".
- "Every agent action is auditable and attributable to both the human and agent".

### 2.6 Claude Code specifics

Source for all quotes: [Create custom subagents](https://code.claude.com/docs/en/sub-agents) and [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp), official Claude Code docs.

**The current docs say sub-agents inherit MCP tools by default.** "Subagents inherit the built-in tools and MCP tools available in the main conversation, narrowed by two filters: the first removes a short list of tools from every subagent, and the second reduces the built-in tool set for subagents that run in the background". On the background filter: "a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, ...".

**Built-in types.** Explore: "**Tools**: read-only tools; Write and Edit are denied". Plan: "**Tools**: read-only tools; Write and Edit are denied". General-purpose: "**Tools**: every tool available to subagents". The docs do not enumerate "read-only tools", so they do not say in so many words whether Explore and Plan keep MCP tools. See section 7.

**How a custom sub-agent controls tool and MCP access.**

- Allowlist that drops MCP entirely: "This example uses `tools` to allow only Read, Grep, Glob, and Bash. The subagent can't edit files, write files, or use any MCP tools".
- Server-level patterns: "Both fields accept MCP server-level patterns in addition to exact tool names: `mcp__<server>` or `mcp__<server>__*` grants or removes every tool from the named server. In `disallowedTools`, `mcp__*` also removes every MCP tool from any server."
- Per-sub-agent MCP servers: "Use the `mcpServers` field to give a subagent access to MCP servers that aren't available in the main conversation. Inline servers defined here are connected when the subagent starts, subject to the trust rule for the agent file's folder, and disconnected when it finishes. String references share the parent session's connection."
- "To keep an MCP server out of the main conversation entirely and avoid its tool descriptions consuming context there, define it inline here rather than in `.mcp.json`. The subagent gets the tools; the parent conversation doesn't."
- "Inline definitions use the same schema as `.mcp.json` server entries, keyed by the server name, and support the `stdio`, `http`, `sse`, and `ws` types."
- Plugin restriction: "For security reasons, plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields."
- Short-lived MCP credentials have a documented hook: "If your MCP server uses an authentication scheme other than OAuth, such as Kerberos, short-lived tokens, or an internal SSO, use `headersHelper` to generate request headers at connection time."

**Credentials in a sub-agent prompt.** The sub-agent docs describe what reaches a sub-agent ("**Task message**: the delegation prompt Claude writes when it hands off the work") and do not mention passing credentials that way, either as a pattern or as a warning. What they do document is that the prompt is persisted: "find IDs in the transcript files at `~/.claude/projects/{project}/{sessionId}/subagents/`. Each transcript is stored as `agent-{agentId}.jsonl`." and "Claude Code deletes subagent transcripts after the `cleanupPeriodDays` retention period, 30 days by default". Anthropic's general stance is the proxy pattern quoted in 2.5: keep the credential out of the agent's view.

### 2.7 Terminology in the prior art

| System | Name of the derived thing | Name of the constraint | Source quote |
| --- | --- | --- | --- |
| AWS STS | "session", "role session", "temporary credentials" | "session policy" | "Passing policies to this operation returns new temporary credentials. The resulting session's permissions are the intersection..." |
| Google Cloud | "downscoped token", "short-lived credential" | "Credential Access Boundary" | "exchange an OAuth 2.0 access token for a downscoped token" |
| Vault | "child token" (parent, orphan, token tree) | policies, TTL | "these tokens will be created as children of the original token" |
| GitHub | "installation access token" | `repositories`, `permissions` | see 2.1 |
| Macaroons | "derived macaroon", "attenuated" | "caveat" | "deriving new macaroons that both attenuate the accessible aspects of the target service..." |
| Biscuit | attenuated token | "block", "check" | "create a new one with more restrictions" |
| RFC 8693 | "issued token"; "delegation" vs "impersonation"; "actor" | `scope`, `audience`, `resource` | see 2.1 |
| AAT draft (draft) | "derived token", "root token", "leaf token" | "constraints" | see 2.1 |

Codebase facts that bear on the name. `session_shown.session_id` is a plain text column (`packages/db/src/schema/session-shown.ts`), `intents.id` is a client-carried text primary key (`packages/db/src/schema/intents.ts`), and every agent tool schema still advertises `session_id` as "Session token from any check response". The operator's 2026-08-23 ruling (recipe 5c55327d) marked that session mechanism "intended for deprecation" while keeping it honored. `/check` reads the credential from the query string (`apps/backend/src/routes/check.ts`: `c.req.query("key")`).

## 3. What this means for Soup.net (interpretation)

Everything in this section is my reading, not sourced fact.

1. **The design notes' core claim holds.** Every system surveyed states the same rule in its own words: intersection (AWS), upper bound (Google), "cannot be granted" (GitHub), "must be a subset" (Vault), "will never gain more rights" (Biscuit). The **[verify]** sentence in derived-agent-keys.md ("a derived credential is never more powerful than its parent on any axis") is supported, with one correction: RFC 8693 does not state that invariant. It supplies the vocabulary (delegation, impersonation, `act`) and leaves the subset rule to the implementer.
2. **Server-minted is a recognized pattern, not a compromise.** The macaroons paper lists re-minting by the target service as one of three ways to hand out limited access, and notes that opaque database-backed identifiers make revocation "simply done by deleting a database row". Soup.net keys are already opaque hashed lookups, so the design notes' preference for server-minted keys with chained validity by join matches the trade the paper describes. Offline derivation (macaroons, Biscuit, the AAT draft) buys latency and availability that a single extra HTTP call per sub-agent does not need, and the AAT draft concedes it gives up per-token revocation.
3. **In RFC 8693 terms the design notes describe impersonation, limited in scope and time.** "Same `user_id` as its parent", with the sub-agent visible only through `agent_id` and the label, is what the RFC calls impersonation: the recipient "is B within the context of the rights authorized by the token". Delegation would mean the audit record structurally carries both the human and the actor. Okta and Microsoft guidance lean toward making the actor explicit. The design can keep authorship with the human (recipes are the human's taste and judgment) and still record the derived key id and its parent on every audit row, which gets the delegation-style audit trail without changing authorship.
4. **One hour is the convention.** STS defaults to 3600 seconds, GitHub installation tokens are fixed at one hour, Google's sample shows 3600, and AWS caps chained role sessions at one hour. The design notes' suggested one-hour default sits squarely on precedent. Google's rule that a downscoped token never outlives the source, and the AAT draft's `derived.exp <= parent.exp`, both support "capped by the parent's remaining life".
5. **Short lifetime mitigates a URL-borne key but does not excuse it.** RFC 9700 and the MCP spec both say MUST NOT for access tokens in query strings, and OWASP explicitly rejects the "it is short-lived" defence. Derived keys make `/check?key=` less dangerous. They are not a reason to stop pursuing Bearer on `/check`, and the operator has already moved one endpoint off URL keys for this reason (recipe 58d3741d).
6. **The "MCP-less sub-agent" motivation needs re-testing.** The current Claude Code docs say sub-agents inherit MCP tools and that background sub-agents keep every MCP tool. The design notes call MCP-less sub-agents "the sharpest motivation" based on past observation. That observation may predate the current behavior, or may apply to Explore and Plan, whose "read-only tools" list the docs do not spell out. Least privilege remains a sufficient motivation on its own, and the URL path still matters for non-Claude-Code agents that can only browse.
7. **Claude Code offers a documented handoff that avoids prompt-borne secrets.** A custom sub-agent definition can carry an inline `mcpServers` entry with its own headers, and `headersHelper` exists for short-lived tokens. An orchestrator could point a sub-agent type at Soup.net with a derived key without the key ever appearing in a prompt or transcript. A key in the delegation prompt is persisted in `agent-{agentId}.jsonl` for 30 days by default, which is longer than the key should live and is the concrete form of the design notes' "prompt-borne secrets are a leak surface".
8. **A standing operator ruling conflicts with the mint endpoint as drafted.** Recipe f1543441 (2026-07-06) set a CI-enforced invariant: "raw API keys never appear in any response outside human-only JWT auth". `POST /keys/derive` authenticated by an API key and returning a secret is a response outside JWT auth that contains a raw key. The mint endpoint needs either a deliberate, named exception to that invariant (with the CI test updated to allow exactly this route and the MCP tool) or a different delivery mechanism. This is the operator's call and is listed in section 6.
9. **The AWS resource-policy pitfall has a direct Soup.net analogue.** The ephemeral-books self-binding (recipe 2f9c5fdd) appends a new book id to the calling key's scope arrays. If a derived key could call it, the derived key would gain scope its parent never had, which is a grant made directly to the derived credential and therefore outside the attenuation. The design notes' suggestion that derived keys never create ephemeral books is the right closure.
10. **Naming.** "Session" is the single most recognizable prior-art word for "a scoped, short-lived credential minted from a stronger one", because of AWS STS, and an LLM agent will have seen "session token" and "session policy" many times. The cost is local: every Soup.net tool schema currently defines `session_id` as a non-secret dedup token that agents are told to share with sub-agents. Two meanings of "session" in one tool schema, one shareable and one secret, is the confusion the operator's own 2026-08-23 ruling was trying to remove. Prior art gives two collision-free alternatives that read well to both audiences: Google's "downscoped" and Vault's "child".

## 4. Options with tradeoffs

**A. Mint mechanism**

- A1. Server-minted opaque child key, validity chained by join to the parent (the design notes' shape). Matches Vault child tokens and GitHub installation tokens. Instant cascade revocation, reuses hashed-at-rest storage, one network call per sub-agent. Requires resolving the f1543441 invariant conflict.
- A2. Offline attenuation (macaroon or Biscuit style). No round trip, works when the server is unreachable. Requires a new token format and verifier, exposes scope in the token, and per the AAT draft "trades per-token revocation granularity" away. Poor fit for a system whose keys are opaque lookups.
- A3. No new credential; narrow per call only (today's `read_recipe_books` narrowing). Zero new auth surface. The sub-agent still holds the full key, so nothing is actually attenuated.

**B. Delivery to the sub-agent**

- B1. Key in the delegation prompt. Works everywhere, including URL-only agents. Lands in transcripts that persist 30 days by default.
- B2. Key in a custom sub-agent's inline `mcpServers` headers or via `headersHelper`. Documented, keeps the secret out of prompts. Claude Code only, needs a project-level agent definition, and plugin sub-agents cannot use `mcpServers`.
- B3. Both: document B2 as the preferred Claude Code recipe and B1 as the fallback, with the aggressive default lifetime as the mitigation for B1.

**C. Delegation semantics in the audit trail**

- C1. Impersonation only: same `user_id`, sub-agent visible through `agent_id` and label (design notes as written).
- C2. Impersonation for authorship plus delegation-style audit: every audit row and trace made with a derived key records `key_id` and `parent_key_id`, so the chain is structural rather than dependent on the agent passing `agent_id`. Cheap, and it answers the Okta and Microsoft accountability guidance.

**D. Name**

- D1. "Session" containing intents. Most recognizable externally. Collides with the live `session_id` parameter until that parameter is actually removed, not just deprecated.
- D2. "Scoped session" as the human-facing phrase, with a distinct token prefix and parameter name that never reuses `session_id` (for example the secret is never passed as a parameter at all, only as the Bearer or `key`). Keeps the operator's preferred human vocabulary, relies on surrounding words to disambiguate.
- D3. "Derived key" or "child key" in schema, API and tool descriptions, with "scoped session" allowed in human-facing prose. Vault's "child token" and Google's "downscoped token" make this immediately legible to LLM agents, and `key_type = 'derived'` already reads naturally next to `daily` and `scoped`.

## 5. Recommendation

Interpretation, for the operator to accept or overrule.

Build A1 with C2, document B3, and name it per D3 until `session_id` is removed from the agent surfaces, at which point "session" becomes free to reuse if the operator still wants it. Keep the design notes' direction of binding (the key carries the lineage; the intent stays a harmless identifier). That also delivers the operator's "multiple intents per auth scope" requirement from recipe 7835c60d without making any identifier a secret: one derived key, many intents registered under it.

### Recommended invariants for an attenuation-only mint endpoint

1. **Book subset.** `child.read_books ⊆ parent.read_books` and `child.write_books ⊆ parent.write_books`, evaluated against the parent's scope at mint time. (AWS intersection; GitHub "cannot be granted access to repositories that the installation was not granted access to".)
2. **Write within read, default within write.** `child.default_write_book ∈ child.write_books`, or null when the child has no deposit capability.
3. **Capability subset.** `child.capabilities ⊆ parent.capabilities`. `derive` is never granted to a child while depth is one. (Vault "must be a subset of the policies belonging to the token making the request".)
4. **Expiry monotonic.** `child.expires_at <= parent.expires_at`, `child.expires_at <= now + SYSTEM_MAX`, and `child.expires_at > now`. A parent with no expiry still yields a child bounded by `SYSTEM_MAX`. (Google "same time to expire as the original access token"; AAT draft "A derived token cannot outlive its parent.")
5. **Omission never widens.** An omitted field means "inherit the parent's value, then apply the system default for children", never "all". Explicitly decide whether omission of `capabilities` inherits deposit or defaults to no-deposit (open question 2 in the design notes); GitHub's inherit-everything default is the permissive precedent, and the MCP spec's warning against omnibus scopes argues for the restrictive one.
6. **Chained validity evaluated at use, not at mint.** `validateKey` on a child requires the parent row to be unrevoked, unexpired, and owned by an enabled user, in the same query. No sweep job is part of correctness. (Vault: parent revocation revokes children.)
7. **No orphans.** No API path creates a derived key without a parent or detaches one from its parent. Vault gates orphan creation behind sudo and warns "Use with caution!" on `revoke-orphan`.
8. **No grants addressed to the child.** No endpoint may widen a derived key's scope after mint. Specifically, derived keys are excluded from the ephemeral-book self-binding and from OAuth refresh. (AWS: resource-policy grants to the session "are not limited by the session policy".)
9. **Depth one.** A request authenticated with a derived key to the mint endpoint is rejected. (AWS caps chained sessions; AAT draft makes depth a first-class bounded claim.)
10. **Identity fixed.** `child.user_id == parent.user_id`, never caller-supplied. The mint request cannot name a user, an org, or a parent other than the presenting key.
11. **Secret hygiene.** The secret is returned exactly once, hashed at rest like every other key, absent from `audit_log` metadata and from every other response. The lineage identifier bound to the key is not a secret and may appear anywhere.
12. **Bounded fan-out.** Per-parent mint rate budget and a cap on live children, held outside `audit_log`. (Vault: "a user cannot escape revocation by simply generating a never-ending tree of child tokens".)
13. **Audit carries the chain.** `key.derived` event on mint; every subsequent audit row made with a child records the child key id, and the parent is reachable by join.
14. **Frozen scope is a ceiling, not a guarantee.** If the parent later loses a book, the child loses it too. Either evaluate effective scope as `child ∩ parent-now` at use time, or document that parent scope edits must revoke children. Pick one and test it.

### Test checklist

Attenuation, one test per axis, each asserting a 4xx with a specific error code and that no row was written:

- [ ] read book not in parent's read set
- [ ] write book not in parent's write set
- [ ] write book in parent's write set but absent from the child's requested read set (decide and pin the rule)
- [ ] `default_write_book` outside the child's write set
- [ ] capability the parent lacks
- [ ] `derive` capability requested for a child
- [ ] `expires_in` beyond the parent's remaining life
- [ ] `expires_in` beyond the system maximum when the parent has no expiry
- [ ] `expires_in` zero, negative, non-numeric, or absurdly large (overflow)
- [ ] unknown book slug or id, and a book id the user can access but the parent key cannot (same uniform error, no enumeration)
- [ ] omitted `read_books` yields exactly the parent's set, never more; same for each other field
- [ ] empty arrays are treated as "no access", not as "omitted"
- [ ] duplicate and differently-cased slugs normalize before the subset check
- [ ] body attempts to set `user_id`, `parent_key_id`, `key_type`, or `org_id` are ignored or rejected
- [ ] property-based test: for random parent scopes and random requests, any minted child satisfies every invariant above

Chain and lifecycle:

- [ ] child works while parent is valid
- [ ] revoke parent, child fails on the very next request with no sweep having run
- [ ] parent expires naturally, child fails
- [ ] parent's user disabled (org offboarding path), child fails
- [ ] child revoked alone, parent and sibling children unaffected
- [ ] daily-key rotation: decide whether children of yesterday's daily key die with it, and pin the behavior
- [ ] derived key calling the mint endpoint is rejected (REST and MCP)
- [ ] derived key calling create-ephemeral-book is rejected
- [ ] derived key cannot obtain or use an OAuth refresh token
- [ ] parent loses a book after mint: child's effective access matches the rule chosen in invariant 14
- [ ] no API path produces a derived row with a null parent

Surface parity (the same attenuation failures must fail identically on each):

- [ ] `POST /keys/derive` with Bearer
- [ ] remote MCP `derive_key`
- [ ] stdio MCP proxy `derive_key`
- [ ] child key accepted on `/check?key=`, on Bearer surfaces, and on `/mcp`, with identical effective scope on each
- [ ] no-deposit child: `check_recipe` and `/check` submission rejected; `search_recipes`, `get_recipes`, `log_feedback` succeed
- [ ] per-call `read_recipe_books` narrowing still only narrows under a child key

Secret hygiene and abuse:

- [ ] secret appears in exactly one response body; absent from audit metadata, logs, briefing output, error messages
- [ ] the raw-key-never-in-responses CI test is updated to allow exactly the mint route and tool, and still fails for any other route
- [ ] stored value is a hash; lookup by raw secret is constant-time comparable to existing keys
- [ ] mint rate budget enforced per parent; live-children cap enforced; both return a clear, agent-readable error
- [ ] lineage binding: calls made with a child key are attributed to its bound intent without the caller passing `intent`
- [ ] several intents can be registered under one child key, and none of their ids grants access on its own
- [ ] dashboard lists children under their parent, and deleting the parent in the UI shows the cascade

## 6. Open questions for the operator

1. **Invariant conflict.** Recipe f1543441 says raw API keys never appear in any response outside human-only JWT auth, enforced in CI. Does the mint endpoint get a named exception, or should delivery work differently?
2. **Impersonation or delegation in the record.** Is `agent_id` plus label enough, or should every trace and audit row made with a derived key structurally record the key chain (option C2)?
3. **Default for omitted capabilities.** Inherit the parent's deposit right (GitHub's default) or default to no-deposit?
4. **Name.** D1, D2 or D3, and does the answer change once `session_id` is actually removed rather than deprecated?
5. **Is MCP-less still true?** The current Claude Code docs say sub-agents inherit MCP tools. Is the observed gap specific to Explore and Plan, to an older version, or to another harness? This changes how much weight the `/check?key=` handoff recipe deserves.
6. **Preferred Claude Code handoff.** Should the "Sub-agents check too" guidance recommend a custom sub-agent definition with inline `mcpServers` (no secret in the prompt) over a key pasted into the delegation prompt?
7. **Daily keys as parents.** A child of a daily key dies at rotation. Acceptable, or should children of daily keys be capped to the remaining day explicitly so the behavior is visible at mint time?
8. **Invariant 14.** Evaluate `child ∩ parent-now` at use time, or revoke children when a parent's scope is edited?

## 7. Unverified / could not confirm

- **Whether the built-in Explore and Plan sub-agents receive MCP tools.** The docs say "read-only tools; Write and Edit are denied" without listing them, and separately say sub-agents inherit MCP tools. I could not find a sentence that settles it for those two types. Needs an empirical test in the operator's Claude Code version.
- **Whether passing a credential in a sub-agent prompt is documented as supported or discouraged.** I found no statement either way in the sub-agents page or the MCP page. The proxy-pattern guidance is about SDK deployments, not about orchestrator-to-sub-agent handoff.
- **OpenAI guidance.** I did not locate a primary OpenAI document on least privilege for sub-agents or tool credentials in this pass. Nothing from OpenAI is asserted here.
- **Auth0 "Auth for GenAI" / Token Vault.** The [Token Vault page](https://auth0.com/ai/docs/intro/token-vault) was fetched, but it concerns storing third-party OAuth tokens for an agent, not attenuation for sub-agents, and I did not extract a quote that bears on this design. Marketing-page claims surfaced by search were not verified against the docs and are omitted.
- **Vault default token TTL.** The concept page gives the system max TTL ("32 days"). I did not confirm a quoted default TTL for a child token created without an explicit `ttl`.
- **Google downscoped token lifetime as a stated number.** The docs state the rule (same expiry as the source token, or an `expires_in` when the source is a service account) and show 3600 in a sample response. I did not find a sentence that states a default lifetime as such.
- **Working-group status of the drafts.** All three Internet-Drafts are named `draft-<author>-...` or carry no `ietf` component, which marks them as individual submissions. I did not check OAuth WG meeting minutes for adoption calls.
- **draft-mcguinness-oauth-actor-profile-00** was downloaded but not read in depth.
- The Google Cloud pages redirected from `cloud.google.com` to `docs.cloud.google.com` when fetched. Quotes are from the redirected pages; links above use the original URLs.
