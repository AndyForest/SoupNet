# C01 requirements

Status: second pass, 2026-09-19, with the operator's corrections to provenance, use cases, and open questions folded in. Conventions: [README.md](README.md).

C01 is written as a hypothetical company rather than a specific one. Nothing here is private to any real organization. (Operator ruling, 2026-09-19: the code is public and more revealing than any plan, so planning lives here with zero company-private information.)

## Who C01 is

A company adopting Soup.net for everyone, not only its engineers. Its direction is that people across the company are becoming builders, and in particular that the people closest to its customers do real development work alongside experienced developers. It signs in with Google Workspace. It runs an autonomous agent for automated pull-request review, which can reach outside context by MCP or by HTTP API. Its people's agents already connect to their other work systems on their own; Soup.net is one more MCP server to those agents and builds no connections to those systems.

## Users

- **Experienced developers**, working with coding agents daily.
- **Less technical and non-technical builders.** A key user type: they learn from the judgment calls others have logged, and surface their own decisions to others. The product has to serve a wide range of skill levels.
- **Senior leadership**, as consumers of observability rather than authors (see UC5).
- **The org admin**, a role rather than a person. Assume the same person administers the identity provider.
- **Autonomous agents** acting for the company rather than for one person.

## Use cases

Recorded without ranking.

- **UC1. Informing PR reviews** with the taste and judgment calls the author made while building the change, for human and autonomous reviewers.
- **UC2. Learning across skill levels.** Newer builders find how experienced colleagues decided similar things; experienced colleagues see what newer builders decided and why.
- **UC3. Documentation.** Sweeping the decisions made on a feature to inform its design documents.
- **UC4. ADR context links.** Connecting architecture decision records to the recipes that carry their reasoning and evidence.
- **UC5. Leadership observability.** Senior leaders' own agents sweep the corpus to inform a high-level view. "Dashboard" is probably the wrong word; the shape is open.
- **UC6. Judging automated test coverage** (operator idea, divergent, not for the first release). A different kind of recipe book: an agent role-plays an end user in the design-thinking style, starts from an intent ("as a site admin, I want to add a new user"), walks the site with a browser automation tool while capturing screenshots and video, and deposits feedback on how it went. Clustering over those recipes would show whether a given intent is already covered, so the team can decide where new walkthroughs and new test cases are needed. Aimed at the proliferation of test cases with no way to judge gaps and overlaps. Filed in the backlog.

## Requirements

| Id | Need | Provenance | Consumer | Stated priority | Plan section |
|---|---|---|---|---|---|
| C01-R01 | One organization containing multiple employee accounts. | customer-stated | human | "the core" | program §3.1 |
| C01-R02 | New accounts whose email domain matches the company's domain list join the organization automatically, controlled by an org setting. | customer-stated | human | part of the core | program §3.3 |
| C01-R03 | When an employee's account is disabled at the company's identity provider, their Soup.net API keys stop working without the company admin having to remember Soup.net. | customer-stated ("the customer specifically mentioned this case") | dual | crucial; required before adoption | program §3.9 |
| C01-R04 | Sign-in through the company's identity provider, Google for the first release. | customer-stated | human | crucial; required before adoption | program §3.4 |
| C01-R05 | The company proves it owns its email domain(s) before domain-based features turn on. | operator-derived | human | | program §3.2 |
| C01-R06 | Org admins have oversight over all company recipe books. | operator-derived | human | | program §3.5, §3.6 |
| C01-R07 | Employees can have private recipe books that admins cannot browse, including their names, while data created by company accounts stays under the company's control. Every employee has access to a shared org default book immediately. | operator-derived | dual | | program §3.5, §3.6 |
| C01-R08 | Org admins control whether recipe books can be shared outside the organization. | operator-derived | human | | program §3.7 |
| C01-R09 | Org admin is a role. Org admins can manage users: see usage (recipes, API keys, activity) without seeing private content, and disable or re-enable a user, which disables or restores that user's API keys. | operator-derived | human | | program §3.8, §3.12 |
| C01-R10 | End users can read, in plain language, what their organization's admins can and cannot see. | operator-derived | human | | program §3.6 |
| C01-R11 | Employees connecting an MCP client through OAuth can use the same company sign-in. | operator-derived | dual | | program §3.11 |
| C01-R12 | Employees who registered with a company email before the organization existed have a defined path into it. Assume none exist for C01, so this is general product work rather than a C01 blocker. | operator-derived | human | | program §3.10 |
| C01-R13 | The company's autonomous PR-review agent can draw on people's logged taste and judgment, over MCP and over the HTTP API. First step: declared intents, search, and feedback, with no recipe checks. | operator-derived from UC1 | agent | | program §4.3 |
| C01-R14 | Work can be tied to the things it relates to: a repo, branch, or PR, and equally a ticket in an issue tracker, a design document, or anything else with an address. Freeform rather than a fixed set of fields. Operator's framing: recipes already have references, which are references for evidence; these may be **references for intents**. | operator-derived from UC1, UC3, UC4 | dual | | program §4.4 |
| C01-R15 | Existing repositories can be swept for past judgment calls and deposited on behalf of the person who made each decision. Those recipes are **visible only to the attributed person until verified**, by that person or by that person's own agent. The review experience should share the human search page rather than be a separate UI. | operator-derived | dual | | program §4.4 |
| C01-R16 | An org admin can download all organization data. | operator-derived | human | | program §3.13 |

Seats and tier are an operator decision about the account type, not a C01 requirement, and live in the program plan §4.1. Seat count doesn't affect the design.

## Questions, answered by the operator 2026-09-19

1. Other use cases and users: see Users and Use cases above. All users across the company.
2. SSO and offboarding: both are crucial. Neither can follow later. The program's first release therefore includes them.
3. Headcount: doesn't matter to the design.
4. Google Workspace for everyone: yes.
5. How the autonomous reviewer takes in context: either MCP or HTTP API. Plan for both, as with every agent surface.
6. Where code and discussions live: out of scope and a seam. Soup.net builds no connections to those systems. The company's agents reach Soup.net by MCP and reach their other sources themselves.
7. Existing signups on company emails: assume none.
8. Security questionnaires and similar: outside this document, which is about features.
9. Org admin: assume the same person as the identity-provider admin. Org admin is a role.
10. Admin visibility expectations: R06 to R10 are the operator's design, not the customer's ask. The customer has no stated position.

## Considered, not included

| Item | Why not a C01 requirement | What would change that |
|---|---|---|
| Identity providers other than Google; SCIM provisioning | First release is scoped to Google. | A customer on Okta or Entra. |
| Instant (push) offboarding | Operator judged hourly or daily pull sufficient, and Google offers no push channel for Workspace users. | A customer stating a tighter expectation. |
| Admin ability to read private recipe books directly | Conflicts with R07. | A compliance-driven customer asking for legal export; the memory-systems research notes some buyers will. |
| Connectors to issue trackers, chat, or document systems | A seam by design (question 6). | Nothing foreseeable; agents bridge these. |
| Image viewing for designers; LLM-powered briefings and reranking | Operator-originated ideas about the broader product. | Demand from non-developer users (now in scope as users, so worth watching). |
| Derived API keys for sub-agents | Operator-originated, separate optional track. | Likely relevant to R13 and to any team running agent fleets. |
| Billing and seat management | No billing build yet. | A commercial agreement. |
