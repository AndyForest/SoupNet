# Org accounts: research plan and restart handoff

Status: written 2026-09-19 at the end of the idea-capture session. The next session starts here. Companion docs: [org-accounts-program.md](org-accounts-program.md), [derived-agent-keys.md](derived-agent-keys.md).

## 0. Update, 2026-09-19 second session

- Operator answered the blocking questions. Q1: managed accounts, no mixing (decided). Q2: answered with a phasing recommendation in the program doc §5, plus a question for the customer in [../customers/c01-requirements.md](../customers/c01-requirements.md). Q6: reopened as design options in [derived-agent-keys.md](derived-agent-keys.md), with the operator leaning toward "session is the scoped-down auth, intents inside it". The rest of §3 had his general "your recommendations sound good" and stays open for specific confirmation where marked.
- Soup.net workflow run: briefing with a declared intent, one discovery check, six searches, ten decision checks, feedback rows on all of them. Decisions and what the corpus changed are in the program doc §0.
- Customer requirements segmented into `docs/customers/`, with a proposed requirements-to-specs workflow in its README.
- Research fleet launched (two code-mapping agents, six web-research agents), each with its own declared intent and feedback instructions. Reports land in [org-accounts-research/](org-accounts-research/).
- **Fleet complete (same day).** Eight reports in [org-accounts-research/](org-accounts-research/): `access-control-map`, `admin-ui-and-export-inventory`, `google-sso-oidc`, `offboarding-deprovisioning`, `domain-verification-and-claiming`, `credential-attenuation`, `pr-review-integration`, `ai-memory-systems-sweep`. Each web-research doc ends with its own operator questions (§6) and an Unverified list (§7). The program doc and the scoped-sessions doc carry a "Research landed" summary at the top of each affected section; first-pass text is kept beneath for the record and still holds some **[verify]** tags, which the phase briefs should drop as they are written from the research docs. Every agent declared its own intent, searched the corpus, and logged feedback; none deposited recipes, and each escalated its judgment calls instead. Security-relevant leads from the code map are filed in the private deployment repo.
- The biggest changes the research made: org-book access should be materialized, not implicit; offboarding's promise is the key-lifetime cap, with the liveness probe gated on an empirical Workspace test; `email_verified` alone isn't sufficient for auto-verification; a mint call that returns a secret conflicts with standing ruling `f1543441`; the org-owned service principal is what enables autonomous PR reviewers, because they need a static org-owned credential; filename-quoting is the weakest PR-retrieval strategy per this repo's own benchmark.
- Still to do: replace **[verify]** tags with sourced quotes, write `docs/architecture/agent-context-seams.md`, draft the org archetypes and user stories in `design-thinking.md` once the operator has reviewed the C01 doc, read the security audit in the private repo before any auth design is finalized.

## 0b. Update, 2026-09-19 third pass (operator feedback on the docs)

- Standing instruction: the agent's recommendations stand unless the operator says otherwise. That settles §3 questions 3, 4, 5, 7, 8, 9, 11, 15, and 16 at their recommended answers, subject to the research refinements recorded in the program doc.
- Q10: planning stays in this public repo, written about a hypothetical company with zero private information. Threat analysis and audit findings still go to the private repo.
- Q12 and Q14: resolved as **derived API keys**, not sessions. Same term, table, and validation as every API key, one nullable parent column, one-hour default, nested UI, dead with the parent, OAuth-connected clients included ([derived-agent-keys.md](derived-agent-keys.md)). Open points there: the named exception to ruling `f1543441`, and hourly rotation of OAuth parents.
- Q13: the operator asked whether the ~32 hand-written gates should be consolidated. Answer in program §3.0: yes, an in-process authorization seam with characterization tests and a CI guard, as phase 0. Materialized org-book access stays the recommendation, decided inside the seam.
- C01 doc corrected: provenance tags, users across the whole company including less technical builders, five further use cases, both SSO and offboarding required before adoption (phasing in program §5 revised to match), org admin as a role.
- New rulings logged: references on intents (lean, `6e1cf536`), verify-before-visible for backfilled recipes with the person's own agent allowed to verify (`e3a0b211`), whole-company audience (`32a0015a`), test-coverage recipe books as a backlog idea (`0760205a`).
- Backlog gained: the authorization seam, test-coverage recipe books, and a parking list for minor web UI improvements.
- A paste-ready brief for a long-running workflow session to write a public-safe discovery document: [../briefings/workflow-discovery-brief.md](../briefings/workflow-discovery-brief.md).
- Still open for the operator, in rough order of how much they block: the `f1543441` exception wording; OAuth-parent handling for derived keys; the key-lifetime cap (default and minimum) and whether it applies to existing scoped keys; whether the empirical Workspace test gates the liveness probe; break-glass under `require_sso`; confirm-step versus silent account linking; offline access from day one; whether admins see a list or a count of pre-existing accounts on their domain. Each is detailed in the relevant research doc's §6.

## 1. State at handoff (first session)

- Done: the operator's ideas organized into the two planning docs, grounded in a read of the current schemas (`organizations`, `users`, `groups`, `api_keys`, `intents`, `session_shown`, `ephemeral_books`), `validateKey`, and the backlog. Backlog pointers added, including the ChatGPT MCP note.
- Deliberately not done, per operator instruction: no Soup.net access, no sub-agents, no web research. Every industry-practice claim in the planning docs is tagged **[verify]**.
- Branch: `docs/org-accounts-planning`, files uncommitted. Docs only, no code touched.

## 2. The Soup.net key for the next session

The operator plans to mint a key scoped to what this work needs. I can't see the book list (no Soup.net access this session), so this is stated by need rather than by name:

- **Read**: the book holding Soup.net product and architecture rulings (memory says `soupnet-oss`). This is the main one. The plans lean on prior rulings about intents, sessions, search grammar, key design, and sharing.
- **Read, if the operator is comfortable**: the private infrastructure book, for prior auth, deployment, and security-posture decisions. Useful for the security-heavy parts, but not required for the first research pass.
- **Write**: one book for decisions made in this program. One wrinkle: some of these judgment calls are customer-driven (what a specific prospect asked for, how to sequence for them). If the product book is shared or public-facing, those belong in a private book instead. A default write book that is private, plus write access to the product book for public-safe rulings, would cover both.
- **Sub-agents**: until derived keys exist, the practical option is a second hand-minted key for the research fleet: read on the product book only, write to a single designated book so the fleet's deposits are reviewable in one place. Research agents should mostly search and log feedback. They check only at real judgment calls, in the operator's voice, per the briefing. If the operator would rather the fleet not deposit at all, say so and I'll brief them as search-and-feedback only. Sub-agent types without MCP access get the `/check` web endpoint with that key.

## 3. Questions for the operator

Ordered by how much they block. Recommendations are in the program doc at the cited section.

1. **Managed accounts or personal accounts with org membership?** Recommendation: managed accounts, no mixing; a personal corpus lives on a separate personal-email account. Everything else hangs off this. (§2)
2. **What does the customer need on day one of a trial?** If SSO and offboarding sync are entry requirements, the phasing changes. If a concierge-created org with invites is enough to start, Phase 1 is a small slice. (§5)
3. **Private books and org control.** Does the org data export include members' private books? Recommendation: no, only via an explicit, logged, member-visible transfer action. And what happens to a departed member's private books: retained, transferable, or deleted after N days? (§3.6)
4. **Existing accounts on a claimed domain.** Accept the notify-and-choose flow? What happens at the deadline if the user does nothing? (§3.10)
5. **Offboarding sync.** Accept B + C (freshness by construction plus refresh-token liveness probe) for the first release, with the Directory API as a later opt-in? This means storing encrypted Google refresh tokens for managed users. (§3.9)
6. **Session versus intent.** Two ideas said "session" (repo/branch context, scoped auth), while the backlog records session as superseded by intent. Confirm these should be designed against intent, or against whatever the seams doc concludes, and that the derived key carrying the lineage is an acceptable reading of "the session is the scoped-down auth". (derived-agent-keys.md)
7. **Seats.** What consumes one? Suggested: active claimed members only; disabled users, unclaimed backfill stubs, guests, and service accounts don't, with service accounts billed their own way later. What happens at seat exhaustion during auto-join?
8. **Org default book in daily keys by default?** The current default for a newly joined book is excluded. Suggest the org default book is the exception. (§3.5)
9. **Backfill on behalf.** Former employees (suggest a non-login historical-author identity), employee notice before a run, and a person's right to disown recipes attributed to them. (§4.4)
10. **Where do these plans live?** This repo is public. The customer is unnamed and nothing here is an audit finding, but the security design for org accounts will get detailed. Keep the design docs here and the threat analysis in the private repo, following the existing split?
11. **Disable semantics.** Separate org-admin disable from site-admin suspension, so an org admin can't lift a site suspension? Suggest yes. (§3.8)
12. **Derived keys timing.** Before the org work (it would make this program's own research fleet safer), in parallel, or after?
13. **Materialized org-book access.** The code map reversed the first-pass lean: org-wide books as materialized `group_members` rows (with a provenance discriminator and a deactivation timestamp) rather than an implicit join, because book access is ~32 hand-written gates with no shared seam. Confirm, given your join-over-sweep preference applies to credentials and is kept there. (program §3.5, [access-control-map.md](org-accounts-research/access-control-map.md))
14. **Scoped sessions: Option B or C, and the mint surface.** Session-as-credential with a public id and a secret token, after retiring the legacy `session_id` surface (B), or the same mechanism under a "key" name (C)? Dedicated mint call, `get_briefing` parameter, or both? ([derived-agent-keys.md](derived-agent-keys.md))
15. **Workflow.** Ratify the requirement, user story, spec, test chain in [../customers/README.md](../customers/README.md), including a new `docs/product-specs/` directory for deterministic Gherkin specs alongside the LLM-eval `docs/briefing-specs/`?
16. **Auto-join as an exception to "no auto-accept", and backfill notices against "no emails to non-users".** Both are deliberate carve-outs from anti-spam principles in `design-thinking.md`, justified by domain verification. Confirm the framing. (program §3.3, §4.4)

## 4. Next-session plan

In order, once the key is in place and the blocking questions (1, 2, 6) have answers:

1. `get_briefing`, then a broad discovery check for this program, then targeted searches for prior rulings on: key scoping, intents and sessions, sharing and viewer roles, export, admin dashboards, OAuth.
2. Write `docs/architecture/agent-context-seams.md`: one table covering API key, derived key, agent id, session, intent, feedback, recipe book, and org, with for each what it identifies, who mints it, its lifetime, whether it is a secret, and what joins to it. This is cheap, it is first, and it settles where repo context and scoped auth belong.
3. Launch the research fleet in parallel, each agent briefed with recipe-check and feedback instructions, scope, and the verbatim-quote-plus-link rule for every fact:
   - **Codebase ACL map** (Explore, very thorough): every place that resolves readable or writable books, every auth check on JWT, API key, and OAuth refresh paths, JWT lifetime, where `suspended_at` should be enforced. Decides implicit versus materialized org-book access.
   - **Admin UI inventory** (Explore): current admin pages, shared components, and `admin-dashboards.md`, for the DRY org console design.
   - **Export and import inventory** (Explore): actual drift between schema and `/auth/me/export`, and the import round-trip constraints.
   - **Google SSO and OIDC** (web): `sub` versus email, `hd`, `email_verified`, account-linking attacks, the domain-takeover write-ups, scopes that avoid app verification.
   - **Deprovisioning practice** (web): SCIM, Google Workspace provisioning limits, Directory API scopes and verification burden, token revocation on suspension, how comparable SaaS products with long-lived API tokens handle offboarding.
   - **Domain verification and account claiming** (web): how Google, Atlassian, GitHub, Slack, and Notion do verification, re-verification, and claiming of pre-existing accounts; how each documents admin visibility to end users.
   - **Credential attenuation** (web): macaroons, Biscuit, RFC 8693, STS session policies, downscoped credentials; plus Claude Code sub-agent MCP access (claude-code-guide agent).
   - **AI memory systems sweep** (web): the seed list and question set in the program doc §4.6.
   - **PR-review integration** (web + code): how autonomous review agents and GitHub Actions consume external context; what a "review packet" call should look like.
4. Read the latest security audit in the private deployment repo before any auth design is finalized. If that repo isn't available to the session, ask the operator.
5. Synthesize: replace every **[verify]** with a sourced quote or delete it, turn the program doc into phase briefs with schema sketches, draft ADRs for the managed-account model and the SSO flow (including the overdue ADR-0022), and log the rulings as recipes with the operator's words as evidence.
6. Update the backlog with phase items once the phasing is ratified.
