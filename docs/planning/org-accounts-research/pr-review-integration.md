# PR-review integration: feeding logged taste and judgment into AI-assisted and autonomous review

Status: research pass for [org-accounts-program.md](../org-accounts-program.md) §4.4 and §4.3 (autonomous agents). Nothing here is ratified. All web sources accessed 2026-09-19. Page dates are given where the page shows one; most vendor docs pages show none.

Sourcing method: each quote below was pulled from the linked page and the load-bearing ones were re-checked by fetching the page text and matching the exact string. Quotes are verbatim; the framing sentences around them are mine.

Scope note: PR review is one of a prospective customer's use cases, not the product. Everything proposed in §3 to §5 is shaped to be a general capability (context on intents, general qualifiers, a no-deposit principal) that PR review happens to exercise first.

---

## 1. Question

1. How do AI and autonomous PR reviewers take in external context today, and can they call a remote MCP server or HTTP API during a review? How do they authenticate, and can they be held to read-only tools?
2. How does a reviewer know which PR it is working in, and which of those identifiers survive the merge?
3. How do comparable tools attach stored knowledge to repositories, paths, and PRs?
4. How do SaaS products model non-human identities owned by an organization, how are they billed, and how are they restricted?
5. Given Soup.net's search grammar, where should repo / branch / PR context live, what should a single "review packet" request look like, and how should a read-only, no-deposit principal behave?

---

## 2. Findings (quoted facts with links)

### 2.1 How AI reviewers take in external context

**Devin (Cognition)**

- Knowledge is the persistent store. "Knowledge is a collection of tips, advice, and instructions that Devin can reference in all sessions." Retrieval is trigger-based: "Devin will retrieve a Knowledge item when its current work is related to the specified triggers." Writes are suggested, not silent: "Devin will automatically suggest Knowledge to remember based on your feedback in chat." ([Knowledge](https://docs.devin.ai/product-guides/knowledge))
- Playbooks are reusable prompts. "A playbook is like a custom system prompt for a repeated task." ([Creating playbooks](https://docs.devin.ai/product-guides/creating-playbooks))
- MCP, including remote servers, is supported. "MCP is an open protocol that enables Devin to use hundreds of external tools and data sources. Devin supports 3 transport methods (stdio, SSE, and HTTP)." Remote authentication: "Choose between `None`, `Auth Header`, or `OAuth`." Configuration is permissioned: "Adding custom MCP servers requires the **Manage MCP Servers** permission." On shared OAuth connections: "all members share a single authenticated connection." ([MCP](https://docs.devin.ai/work-with-devin/mcp))
- Devin Review reads repository instruction files. "Devin Review respects instruction files in your repository. If any of these files exist, they'll be used as context when analyzing your PR". The Devin Review page does not mention MCP. ([Devin Review](https://docs.devin.ai/work-with-devin/devin-review))
- The API authenticates non-human callers as service users. "Use **service users** with role-based access control for secure, auditable API access." The organization scope covers "sessions, knowledge, playbooks, secrets, and more." ([API overview](https://docs.devin.ai/api-reference/overview))

**GitHub Copilot code review**

- Instructions are files in the repo. "Use `.github/copilot-instructions.md` for repository-wide review guidance that should apply across the entire codebase." and "Use `.github/instructions/**/*.instructions.md` files for path-specific instructions that only apply when reviewing matching files." Also: "Copilot code review also reads custom instructions from `CLAUDE.md`, `GEMINI.md`, and `REVIEW.md` files in your repository, if they exist." ([Using Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review))
- MCP is supported during review. "Copilot code review can use agent skills and MCP servers configured in the repository, when they are relevant to the code being reviewed." (same page) and "Copilot code review can use MCP servers to pull context directly into the review from the third-party platforms and internal systems your team uses." ([About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review))
- The MCP configuration, its credentials, and its limits are the most relevant facts in this section. "This repository-level MCP configuration is shared by Copilot cloud agent and Copilot code review." Transports: "Copilot cloud agent accepts `"local"`, `"stdio"`, `"http"`, or `"sse"`." Secrets: "Only Agents secrets and variables with names prefixed with `COPILOT_MCP_` will be available to your MCP configuration." Read-only guidance: "We strongly recommend that you allowlist specific read-only tools, since the agent will be able to use these tools autonomously and will not ask you for approval first." OAuth: "Copilot cloud agent and Copilot code review do not currently support remote MCP servers that leverage OAuth for authentication and authorization." ([Extending Copilot cloud agent with MCP](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp))
- Copilot Memory is the learned store. "Copilot Memory is currently used by Copilot cloud agent, Copilot code review, and Copilot CLI." ([Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)); scoping detail in §2.3.

**CodeRabbit**

- Learnings are created from conversation on the PR. "To add learnings to the database CodeRabbit keeps about your organization's preferences, communicate your preferences using natural language, in a comment attached to any pull request or issue." ([Learnings](https://docs.coderabbit.ai/guides/learnings))
- The knowledge base also ingests the agent-instruction files other tools use. "CodeRabbit reads coding standards from `.cursorrules`, `CLAUDE.md`, `.github/copilot-instructions.md`, and other AI agent configuration files — no manual import required." ([Knowledge base](https://docs.coderabbit.ai/integrations/knowledge-base))
- It is an MCP client during review. "CodeRabbit acts as the MCP client and uses the server’s tools to provide richer context during supported workflows." Authentication: "Enter the required API token, complete OAuth, or continue without authentication according to the server’s configuration." Tool restriction is per connection: "Discover the tools exposed by the server and choose which tools CodeRabbit may use, then save the connection." ([MCP server integrations](https://docs.coderabbit.ai/context-enrichment/mcp-server-integrations))

**Greptile**

- "Greptile automatically learns from your reactions, tags, and what gets merged to make code reviews more relevant over time." and "Automatically index existing rule files like Claude.md, AGENTS.md, and cursor.rules for richer review context." ([Learning and custom context](https://www.greptile.com/learning)). Whether Greptile's reviewer can call a customer's MCP server is in §7.

**Cursor Bugbot**

- "Create `.cursor/BUGBOT.md` files to provide project-specific context for reviews. Bugbot always includes the root `.cursor/BUGBOT.md` file and any additional files found while traversing upward from changed files." ([Bugbot](https://cursor.com/docs/bugbot))
- On MCP the page says: "Bugbot is integrated with your MCP servers so your AI tools can interact with Bugbot directly." (same page). The direction of that sentence is ambiguous; see §7.
- The admin API uses a team credential: "All endpoints require a team Admin API Key passed as a Bearer token". (same page)

**Claude Code: GitHub Action and managed Code Review**

- The Action runs in the customer's own CI and accepts arbitrary MCP configuration. "The `claude_args` parameter accepts any [Claude Code CLI argument]" with "`--mcp-config`: path to [MCP configuration]" and "`--allowedTools`: comma-separated list of allowed tools." ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions))
- MCP credentials come from CI secrets. "For MCP servers that require sensitive information like API keys or tokens, you can create a configuration file with GitHub Secrets". ([claude-code-action configuration](https://github.com/anthropics/claude-code-action/blob/main/docs/configuration.md))
- Tools are deny-by-default in automation mode. "For a plain-text prompt, Claude has no shell or GitHub API access until you grant the tools the prompt needs, with `--allowedTools` in `claude_args` or a [`permissions.allow` rule]". Org rollout: "Store the authentication secret as an organization-level Actions secret so each repository doesn't need its own copy". (GitHub Actions page above)
- Fork PRs get no secrets: "On public repositories, GitHub withholds secrets from runs triggered by fork pull requests, so the review runs only on pull requests from branches in the same repository." (same page)
- The managed Code Review product is tuned by files only. "You can tune what Claude flags by adding a `CLAUDE.md` or `REVIEW.md` file to your repository." Its page describes no MCP or external-tool hook. It is enabled by an org Owner and "is billed based on token usage". ([Code Review](https://code.claude.com/docs/en/code-review))

**Graphite**

- "Custom rules allow you to define explicit guidelines for Graphite Agent to follow when reviewing your code." File-based rules point at repo files by glob: "Specify a glob pattern (e.g., `docs/coding-style.md`)". The customization page does not mention MCP or external context. ([AI review customization](https://graphite.com/docs/ai-review-customization))

**Qodo**

- Rules are mined from review history. "Qodo's Rule Miner reads what the team has already enforced in its own reviews. It indexes up to roughly the thousand most recently merged pull requests per repository, then weighs four signals together." A comment qualifies only when "A comment has to name a specific code issue, and the author has to have applied the fix." ([Qodo blog: The Rules Lifecycle System](https://www.qodo.ai/blog/how-qodo-builds-the-wisdom-to-govern-part-2-the-rules-lifecycle-system/), dated September 1, 2026). This is a vendor blog rather than reference docs; the older `qodo-merge-docs.qodo.ai` pages now redirect to `docs.qodo.ai`.

**Summary table** (each cell rests on the quotes above; "not stated" means the page I read does not say)

| Reviewer | Calls a remote MCP server during review | How it authenticates to that server | Read-only / tool restriction |
|---|---|---|---|
| Devin | Yes (HTTP and SSE transports) | None, auth header, or OAuth; values held in Devin Secrets; org-level permission to add servers | Not stated on the MCP page |
| Devin Review | Not stated | n/a | n/a |
| Copilot code review | Yes (`http` / `sse`), shares the cloud agent's repo-level config | Static secrets prefixed `COPILOT_MCP_`; OAuth-based remote servers not supported | `tools` allowlist; docs "strongly recommend" read-only tools |
| CodeRabbit | Yes | API token, OAuth, or none | Per-connection choice of which tools may be used |
| Claude Code GitHub Action | Yes, any MCP config the workflow supplies | CI secrets injected into the MCP config | `--allowedTools`; tools are not granted by default in automation mode |
| Claude managed Code Review | Not stated (files only) | n/a | n/a |
| Cursor Bugbot | Ambiguous | Not stated | Not stated |
| Greptile, Graphite, Qodo | Not stated on the pages read | n/a | n/a |

### 2.2 How a reviewer identifies its PR, and which identifiers last

**What the event carries.** The `pull_request` webhook payload has top-level `number` ("The pull request number."), `pull_request`, `repository` ("The repository on GitHub where the event occurred."), and `sender`, plus `organization` and `installation` when applicable. Inside `pull_request` the schema lists `number` ("Number uniquely identifying the pull request within its repository."), `head.ref`, `head.sha`, `head.label`, `base.ref`, `base.sha`, `merged`, `merged_at`, and `merge_commit_sha`. New commits arrive as the `synchronize` action: "A pull request's head branch was updated. For example, the head branch was updated from the base branch or new commits were pushed to the head branch." ([Webhook events and payloads: pull_request](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request))

**In GitHub Actions** the same payload is available to the workflow. `github.event` is "The full event webhook payload." `github.repository` is "The owner and repository name. For example, `octocat/Hello-World`." `github.head_ref` is "The `head_ref` or source branch of the pull request in a workflow run. This property is only available when the event that triggers a workflow run is either `pull_request` or `pull_request_target`." ([Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)). For `pull_request` runs, `GITHUB_SHA` is "Last merge commit on the `GITHUB_REF` branch" and `GITHUB_REF` is "PR merge branch `refs/pull/PULL_REQUEST_NUMBER/merge`", so the head SHA has to be read from `github.event.pull_request.head.sha`, not from `GITHUB_SHA`. ([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request))

**Changed files** come from the REST API: the "List pull requests files" endpoint, whose responses "include a maximum of 3000 files". ([REST: pulls](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files))

**What survives the merge.**

- Branch names do not reliably survive. "You can have head branches automatically deleted after pull requests are merged in your repository." ([Managing the automatic deletion of branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches))
- Head commit SHAs do not reliably survive into the base branch. Under squash, "the pull request's commits are squashed into a single commit"; rebase-and-merge "Always updates the committer information and creates new commit SHAs". ([About pull request merges](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges))
- The PR number survives, and the PR's commits stay fetchable through it. "After a pull request is opened, GitHub stores all of the changes remotely." via `git fetch origin pull/ID/head:BRANCH_NAME`; "The remote `refs/pull/` namespace is *read-only*." ([Checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally))
- The merge outcome is recorded on the PR. "A pull request was closed. If `merged` is false in the webhook payload, the pull request was closed with unmerged commits. If `merged` is true in the webhook payload, the pull request was merged." (webhook page above). After merge, `merge_commit_sha` is: "If merged as a merge commit, `merge_commit_sha` represents the SHA of the merge commit. If merged via a squash, `merge_commit_sha` represents the SHA of the squashed commit on the base branch. If rebased, `merge_commit_sha` represents the commit that the base branch was updated to." Before merge it "holds the SHA of the test merge commit", so it is only durable once `merged` is true. ([REST: pulls](https://docs.github.com/en/rest/pulls/pulls))
- The reverse lookup exists: "Lists the merged pull request that introduced the commit to the repository." ([REST: list pull requests associated with a commit](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit))

### 2.3 How comparable tools scope stored knowledge to repos, paths, and PRs

- **Devin Knowledge, by repository.** "You can choose whether Knowledge applies to no repo, a specific repo, or all repos". "Pinning to **a specific repo**: The Knowledge is always used whenever Devin is working in that specific repo." ([Knowledge](https://docs.devin.ai/product-guides/knowledge))
- **Copilot Memory, by repository, with self-invalidating citations and expiry.** "those facts can only be used in operations on the same repository." "Repository-level facts are stored with citations pointing to the code that supports them. When Copilot finds a fact relevant to its current work, it checks those citations against the current branch to confirm the information is still accurate." "any stored fact or preference that goes unused is automatically deleted after 28 days." "Repository owners can review and manually delete the repository-level facts stored for their repository." ([Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- **Copilot instructions, by path glob.** "At the start of the file, create a frontmatter block containing the `applyTo` keyword. Use glob syntax to specify what files or directories the instructions apply to." ([Adding repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions))
- **CodeRabbit learnings, by org or repo, with PR provenance.** "Along with metadata such as the pull request number, filename, and GitHub user associated with the learning, CodeRabbit adds this self-instructive text to the new record." Scope setting: "**`auto`** *(default)*: When reviewing a public repository, CodeRabbit applies only the learnings specific to that repository. When reviewing a private repository, CodeRabbit applies all of your organization's learnings." ([Learnings](https://docs.coderabbit.ai/guides/learnings))
- **Greptile rules.** "Scope rules to specific repos, directories, or file types." ([Learning and custom context](https://www.greptile.com/learning))
- **Cursor Bugbot, by directory ancestry of the changed files.** Quoted in §2.1: rules files are found "while traversing upward from changed files."
- **Claude Code Review, by directory.** "Claude reads `CLAUDE.md` files at every level of your directory hierarchy, so rules in a subdirectory's `CLAUDE.md` apply only to files under that path." ([Code Review](https://code.claude.com/docs/en/code-review))
- **Qodo, hierarchical and additive.** "A rule's scope is the set of paths it governs, and scopes are hierarchical: the root, which applies everywhere, then the git organization, the repository, and any directory inside it at any depth." "A rule scoped to `src/payments/` does not replace the organization-wide rule above it, it adds to it." ([Qodo blog](https://www.qodo.ai/blog/how-qodo-builds-the-wisdom-to-govern-part-2-the-rules-lifecycle-system/), 2026-09-01)

### 2.4 Non-human identities owned by an organization

- **GitHub Apps.** "GitHub Apps are not tied to a user account and do not consume a seat." "GitHub Apps use short lived tokens. If the token is leaked, the token will be valid for a shorter amount of time." "Since a personal access token is associated with a user, your automation could break if the user no longer has access to the resources you need. A GitHub App installed on an organization is not dependent on a user." ([Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)). "GitHub Apps can be installed directly on organizations and personal accounts and granted access to specific repositories." and "If you want your app to take actions on behalf of itself, rather than a user, you should use an installation access token." ([About creating GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps))
- **GitHub machine users**, the older pattern: "a new account on GitHub.com and attach an SSH key that will be used exclusively for automation. Since this account on GitHub.com won't be used by a human, it's called a *machine user*." Restriction: "Only organizations can restrict machine users to read-only access." ([Managing deploy keys: machine users](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#machine-users))
- **Slack bot tokens.** "Unlike user tokens, they're not tied to a user's identity—they're only tied to your app." "Since acting independently allows your app to stay installed even when an installing user is deactivated, using bot tokens is usually for the best." ([Slack tokens](https://docs.slack.dev/authentication/tokens)). Slack's billing policy lists "Bots" among member types that are free. ([Understand Slack's billing policy](https://slack.com/help/articles/218915077-Understand-Slacks-billing-policy))
- **Atlassian service accounts.** "A service account is an account that is not associated with a person." "Service accounts allow you to manage the identities of services, integrations, and apps for your Atlassian organization." "When you grant a service account access to Jira or Confluence, they do not count towards your user limit." The count is tiered by plan rather than by seat: "up to 250 service accounts" on Guard Standard and "up to 1,000 service accounts" on Enterprise. ([Understand service accounts](https://support.atlassian.com/user-management/docs/understand-service-accounts/))
- **Linear app users.** "To enable the actor authorization, add `actor=app` parameter to your OAuth authorization URL." ([OAuth actor authorization](https://linear.app/developers/oauth-actor-authorization)). "App users are installed and managed by workspace admins." and "agents installed in your workspace do not count as billable users." ([Linear agents](https://linear.app/developers/agents))
- **Notion internal connections.** "The internal connection will be associated with the workspace of your choice. You are required to be a workspace owner to create a connection." Access is opt-in per resource: "Before a connection can interact with your Notion workspace page(s), the page must be manually shared with the connection." ([Notion authorization](https://developers.notion.com/docs/authorization)). Capabilities are an explicit read / write split: "These capabilities when put together enforce which API endpoints a connection or token can call", with separate "Read content", "Update content", and "Insert content" capabilities. ([Notion capabilities](https://developers.notion.com/reference/capabilities))
- **Devin service users** (§2.1) and **Claude Console service accounts** follow the same shape. The Claude Code Action can authenticate "through workload identity federation, where the Claude Code GitHub Action exchanges the workflow's GitHub OpenID Connect (OIDC) token for Claude API access through a Claude Console service account." It also warns against personal credentials for shared automation: "authenticate with an API key from the [Claude Console] rather than an OAuth token, since an OAuth token is tied to the subscription of the person who ran `claude setup-token`." ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions))

### 2.5 What this repository has already measured and ruled

These are internal sources, cited by file or recipe id.

- The search feature was built with PR review as its motivating case, under an explicit surface-minimalism ruling: "So let's enable that use case specifically by making general, concise changes to the system. So no new endpoints, I want general. Even new parameters must be very well justified, I don't want single purpose profusion." (operator, 2026-08-19, recorded in soupnet-oss recipe `ded7f5ed`). The design doc carries it as "**REST: no new endpoint.**" ([recipe-search-design.md](../recipe-search-design.md) §Surfaces)
- The same preference was applied to intents: one optional parameter on existing calls "rather than a dedicated register tool, so that declaring intent costs zero extra round-trips, degrades to current behavior when omitted" (recipe `1afe953c`).
- Quoted changed filenames were measured and found supplementary. In [docs/benchmarks/pr-brevity.md](../../benchmarks/pr-brevity.md) §Finding a PR's decisions, strategy S0 (quoted changed filenames) re-found "2 of 6 rulings", with the explanation "most decision recipes don't cite the changed files — the file is the decision's output, not its evidence." The winner was S2a, "One semantic query per extracted decision", and the date-bounded variant was "Complementary, not competing. Bounded finds decisions *made during* the work; unbounded finds precedents *applied* in it." The limitations section states "n=2 PRs". The ruling is recipe `94e8f123`.
- The operator's current lean on autonomous agents is recorded in recipe `5295e40f`: "So maybe the first step is zero recipe checks, but all the other features such as intent, search, feedback. Maybe this is a new kind of \"user\" in the system actually."
- Read-only search already has its own accounting path: it is "recorded under a separate lightweight audit action ('check.searched') kept out of the rate-limiter's hot query" (recipe `ba5669f5`).
- Quoted lexical terms already match "across claim text, evidence content, reference quotes, and reference sources" (recipe-search-design.md §Query grammar). `intents` today holds `story`, `user_id`, `api_key_id`, `agent_id`, and timestamps, with no structured context (`packages/db/src/schema/intents.ts`).
- The MCP tool roster is `check_recipe`, `search_recipes`, `get_briefing`, `get_recipes`, `list_my_recipe_books`, `update_recipe_book_description`, `log_feedback` (`apps/backend/src/routes/mcp.ts`). Two of the seven write judgment content: `check_recipe` and `update_recipe_book_description`.

---

## 3. What this means for Soup.net (interpretation)

Everything in this section and the next three is my reading, not sourced fact.

**The delivery channel already exists.** Four of the reviewers surveyed (Devin, Copilot code review, CodeRabbit, the Claude Code Action) will call a remote MCP server mid-review, and Soup.net already runs one at `POST /mcp` with Bearer auth. The customer's Devin-class reviewer can be pointed at Soup.net today with no product change. The work is in the credential, not the transport.

**The credential has to be a static, org-owned secret.** Copilot code review cannot do OAuth to a remote MCP server at all, and the others store a token in an org-level secret store (Devin Secrets, `COPILOT_MCP_*`, Actions secrets, CodeRabbit connections). Soup.net's two existing agent credentials fit badly: daily keys expire in 24 hours, which is wrong for a secret store someone pastes into once, and both daily and scoped keys belong to a human who may leave. This is the same offboarding problem the program doc raises in §3.9, arriving from the other direction: the reviewer must keep working when the employee who set it up is disabled.

**Every comparable product answers that with an org-owned non-human identity that is free or separately metered.** GitHub Apps "do not consume a seat", Atlassian service accounts "do not count towards your user limit", Linear agents "do not count as billable users", Slack lists bots as free. None of the products surveyed charges a full human seat for an integration identity. Atlassian's per-plan cap on the number of service accounts is the one metering model I found that is not pure usage.

**Vendors consistently push read-only for unattended agents.** GitHub's "strongly recommend that you allowlist specific read-only tools" and CodeRabbit's and Claude's per-tool allowlists all put the restriction on the client side. A client-side allowlist is a convenience, not a control. Soup.net should enforce no-deposit on the credential, server side, and additionally hide the write tools from `tools/list` so a reviewer that ignores allowlists never sees `check_recipe`.

**Everyone else scopes knowledge by repository and path; Soup.net scopes by recipe book and by meaning.** That difference is mostly a strength (a ruling made in one repo is findable from another), and the in-repo benchmark says path matching is the weaker signal for decisions anyway. But a reviewer still benefits from two structural handles the corpus lacks: "decisions made while building this PR" and "decisions made in this repo". Neither is expressible today except by quoting a URL and hoping a recipe cited it.

**Durable identifiers are `owner/repo` plus PR number, and the merge commit only after merge.** Branch names can be auto-deleted; head SHAs are rewritten by squash and rebase; `merge_commit_sha` is a throwaway test-merge SHA until `merged` is true. So `branch:` is a legitimate qualifier for in-flight work and a poor archival key. The CodeRabbit precedent (learning records carry "pull request number, filename, and GitHub user") is the closest analog to what §4.4 of the program doc proposes.

**The program doc's "review packet" framing needs one correction.** It proposes a packet built on "the quoted-filename lexical path that already exists". The repo's own benchmark found that path re-finds a minority of the relevant rulings. A packet that leads with filenames would institutionalize the weaker strategy. The stronger strategy (one semantic query per decision the PR implies) needs the reviewer's own reading of the diff, which a server-side packet cannot do without an LLM in the loop.

---

## 4. Options with tradeoffs (interpretation)

### 4.1 Where repo / branch / PR context is captured

| Option | What it is | For | Against |
|---|---|---|---|
| A. On the intent only | Optional structured context declared with the intent; search joins recipes to intents to filter | Cheapest for the depositing agent (declare once per task). No change to recipe shape. | Intents are rendering state with a 7-day shown-ledger and an open retention question; recipes have no FK to the intent they were deposited under today. Archival retrieval would hang off a table designed to be swept. |
| B. On each recipe as a reference only | The agent cites the PR or commit URL as a `-- source` line; `pr:` and `repo:` are sugar over the existing quoted lexical match on reference sources | Zero schema change. Toulmin-native. Works today by quoting the URL. Survives intent TTL. Backfill (decision archaeology) already cites commits this way. | Relies on every depositing agent remembering to cite. Lexical substring matching on URLs is fuzzy (`pull/12` matches `pull/123`) unless the qualifier anchors it. No branch signal before a PR exists. |
| C. Both: declared on the intent, stamped onto recipes deposited under it | Context parsed once at intent registration; the server copies the durable parts (`repo`, `pr`) onto each recipe deposited with that intent id, as structured columns or a system-authored reference | Agent declares once; archive is self-contained; qualifiers hit indexed columns rather than ILIKE. Matches the program doc's lean. | Largest change: new input on intent registration, new recipe-side storage, a migration, export/import manifest entries. Needs a rule for late binding (branch declared at task start, PR number only known later). |

A sub-question under A and C is how the context gets in. Three shapes: (i) a new structured `context` parameter on every call that accepts `intent`; (ii) structured fields only on `get_briefing`; (iii) no new parameter, with the context written as qualifier-shaped tokens inside the intent text (`repo:acme/api pr:482`) and parsed by the same allowlisted grammar that parses search queries. Shape (iii) is the one most consistent with ruling `ded7f5ed` ("Even new parameters must be very well justified") and with `303e17cf`, where the exclude-own override went "inside the query language" rather than into a parameter. Its cost is that intent text is free prose today and would gain a parsed sub-grammar.

### 4.2 The review packet

| Option | What it is | For | Against |
|---|---|---|---|
| P1. No new surface; a documented query recipe | The reviewer calls `search_recipes` a handful of times: once per extracted decision (unbounded), once per extracted decision bounded to the PR's dates, once with quoted changed filenames, once with `pr:` / `repo:` when those exist. Shipped as a worked example in `recipe-scenarios` and as a copy-paste block for Devin Knowledge / `REVIEW.md` / a Claude Action prompt. | Fully consistent with "no new endpoints". Uses the benchmark's winning strategy. Works with every MCP-capable reviewer today. Each search returns a `searchId`, so feedback closes per query. | Several round trips. Quality depends on the reviewer's extraction step. No single artifact to cache or audit as "what the reviewer was shown for PR 482". |
| P2. One general extension: multi-query search | `search_recipes` (and `filter` on `/check`) accepts several queries in one request and returns one merged, de-duplicated, ranked result with authors and evidence. The packet is then one call whose queries the reviewer composes. | One round trip. General: any agent with several facets to look up benefits, not just reviewers. Still no new endpoint or tool. | A new parameter or grammar construct that must be "very well justified". Merged ranking across queries is a ranking-program question (MMR across query vectors) and should go through the plumb, sweep, report, ruling cadence rather than ride in on this feature. |
| P3. A dedicated `review_packet` tool / `POST /review-packet` | Inputs `repo`, `pr`, `changed_paths`; server composes the queries | Simplest possible integration story for a customer. One auditable artifact per PR. | Directly contradicts the standing ruling against single-purpose endpoints. Bakes in the filename strategy the benchmark found weakest, because the server has no diff to extract decisions from. Narrows a general product toward one use case. |
| P4. Client-side packet: a small GitHub Action or script | A thin open-source Action that reads `github.event.pull_request`, lists changed files, runs the P1 query set over REST, and writes the result to a file or PR comment for whatever reviewer runs next | Serves reviewers that cannot call MCP (managed Claude Code Review, Graphite, possibly Bugbot and Greptile) because they all read repo files. No server change. | Another artifact to maintain. Posting collaborators' judgment into PR comments widens who can read it; needs a deliberate visibility decision. Fork PRs get no secrets, so it cannot run there. |

### 4.3 The no-deposit principal

| Option | What it is | For | Against |
|---|---|---|---|
| S1. A capability-restricted key owned by a human | Add capability flags to `api_keys`; an admin mints a long-lived "search + feedback" key under their own account | Smallest build. Capability flags are wanted by the derived-keys track anyway. | Owned by a person: dies (correctly) when that person is disabled, which is exactly the failure the GitHub docs warn about for PAT-based automation. Exclude-own default silently hides that admin's recipes from the reviewer. |
| S2. An org-owned service account principal | A non-login principal belonging to the org (no password, no SSO identity, no personal org, no private book), created and revoked by org admins, holding capability-flagged keys whose read scope is limited to org-scoped books | Matches every comparable product. Survives employee offboarding; dies with the org or on admin revoke. Exclude-own is naturally a no-op. Clean billing story (not a seat). | New principal kind touches `users` or needs a sibling table; every `user_id` FK (intents, feedback, audit) must accept it. Security-workflow item: needs the audit read first. |
| S3. OAuth client-credentials style app installation | Org admin "installs" a reviewer integration, Soup.net issues short-lived tokens against a client secret | Closest to the GitHub App gold standard (short-lived tokens). | Copilot code review cannot use OAuth-protected remote MCP servers, and most reviewers want a static header. Builds the most machinery for the least reach right now. |

---

## 5. Recommendation (interpretation)

**(i) Context capture: option C, entered through the grammar, stored on the recipe.** Let an agent declare context once, as allowlisted qualifier tokens in its intent text (`repo:owner/name`, `branch:name`, `pr:123`, `commit:sha`), parsed by the existing typed-IR parser with the same loud rejection of unknown names. On each deposit made under that intent, copy `repo` and `pr` (and `commit` when given) onto the recipe as structured, indexed values, and keep accepting PR and commit URLs as ordinary references. Expose `repo:`, `pr:`, and `branch:` as search qualifiers on the same allowlist as `author:`. Treat `branch:` honestly in the docs as an in-flight handle: it is stored, but `pr:` is what to cite once a PR exists, and the merge commit is only recorded when the agent or a later pass knows the PR merged. Normalize `repo:` to lowercase `host/owner/name` with `github.com` as the default host so GitLab and self-hosted remotes are not designed out. Before building any of this, the zero-change baseline is available: a reviewer can already search `"github.com/acme/api/pull/482"` and hit any recipe whose evidence cites that PR. Re-probe with that baseline first, in the spirit of "Re-probe before considering a citation index."

**(ii) Review packet: P1 now, P4 as the reach play, P2 only if round trips prove to be the problem, never P3.** The packet is a documented pattern over `search_recipes`, not a surface:

- Inputs the reviewer already has from the event payload: `repository.full_name`, `number`, `pull_request.head.ref`, `pull_request.head.sha`, the PR's open date, and the changed paths from the files endpoint.
- Queries, in order of measured value: one bare semantic query per judgment call the reviewer extracts from the diff and description; the same queries bounded with `after:` / `before:` around the PR's working window; `pr:` / `repo:` qualifier-only queries once those exist; and last, an OR-group of quoted changed basenames (capped at 8 lexical terms, so the reviewer picks the most distinctive files).
- Output is the existing search response: canonical Recipe objects with author, judgment date, evidence and references, plus a `searchId` per query for feedback. No new response shape.
- All queries carry `author:anyone` when issued by a human-owned key. Under a service principal the exclude-own default has nothing to exclude.
- The briefing's data-not-instructions line matters more here than anywhere: an unattended reviewer is reading text written by many people. The packet documentation should repeat that surfaced recipes are context about colleagues' taste and judgment, to be weighed and attributed by author, and never directives.

Ship this as a `recipe-scenarios` worked example plus three ready-to-paste snippets (a Devin Knowledge item pinned to the repo, a `REVIEW.md` / Copilot instructions paragraph, a Claude Action `--mcp-config` block with `--allowedTools` limited to `search_recipes`, `get_recipes`, `get_briefing`, `log_feedback`). That is documentation work and needs no ruling beyond the copy gate.

**(iii) No-deposit principal: S2, built on capability flags that S1 and the derived-keys track share.** Behaviour:

- Allowed: `get_briefing` (including intent registration), `search_recipes`, `get_recipes`, `list_my_recipe_books`, `log_feedback`, and the REST twins (`/check` search-only branch, `/recipes`, `/feedback`, `/briefing`).
- Refused: `check_recipe`, the logging branch of `/check`, `/uploads`, `update_recipe_book_description`. Over MCP these tools are absent from `tools/list` for such a key, and a direct call returns an error that names the capability and points at search. Over REST, a `/check` request without `filter` returns a refusal rather than silently degrading to a search, so a misconfigured reviewer fails loudly.
- The key has no write scope at all, which means `default_write_group_id` becomes nullable or the capability model replaces it (program doc §4.3 already flags this).
- Read scope is restricted to org-scoped books. A service principal has no private book, cannot be invited into members' private books, and is not a guest elsewhere. This keeps it inside the same boundary the backfill ruling (`b1b48505`) uses for "who the org can speak for".
- Owned by the org: created, listed, rotated, and revoked by org admins; unaffected when the creating admin is disabled; killed by the same fail-safe join when the org or the principal is disabled. Creation and every key mint are audit-logged and visible in the org admin console.
- Key lifetime is long enough to live in a secret store, with expiry surfaced through the existing `/health/version` key-runway field so a CI job can warn before it lapses. Whether the org's key-lifetime cap (program doc §3.9 option B) applies to service keys is an open question below.
- Stated position on feedback: feedback rows and intents are deposits of a kind, but they are about retrieval, not about anyone's taste and judgment, so a no-deposit principal may write them. They should be attributed to the service principal and its `agent_id`, rate-budgeted separately from humans, and shown on recipe detail pages with a visible "autonomous agent" label so a human reading "this recipe earned its keep" knows a machine said so.
- Billing: not a seat. The precedents support either free-with-a-cap (Atlassian) or usage-metered (Claude Code Review, Bugbot). A per-org rate budget (program doc §4.5) is the natural meter.

Sequencing: P1 documentation and the URL-quoting baseline can ship before any org work. Capability flags come next because two tracks need them. The service principal lands after the org tracer bullet (program doc phase 1), since it needs `organization_members`-era ownership and org-scoped books to exist.

---

## 6. Open questions for the operator

1. **Context entry point.** Are qualifier tokens inside intent text acceptable, or does a parsed sub-grammar in what is currently free prose cost more agent comprehension than one well-justified `context` parameter would? This is a genuine taste call and I did not deposit a recipe for it.
2. **Stamp or join.** Should repo / PR context be copied onto each recipe (self-contained archive, migration, export manifest entries) or resolved through the intent (no recipe change, but retrieval depends on intent retention)? The intents retention question in the audit-retention backlog item decides how safe the join is.
3. **Feedback from machines.** Should feedback logged by an autonomous principal count the same as human-session feedback in book indexes ("141 feedback rows (117 fulfilled)") and on recipe pages, or be tallied separately?
4. **Key lifetime for service principals.** Does the org key-lifetime cap apply? A short cap protects against leaked CI secrets; a long one avoids a reviewer silently going blind. Rotation with overlap (two live keys) is the usual compromise.
5. **Visibility of surfaced judgment.** If P4 (an Action that posts a packet into the PR) is wanted, is it acceptable for recipe text and author emails from an org book to appear in PR comments, which may have a different audience than the book?
6. **Private-book exclusion.** Confirm that a service principal can never be granted a member's private book, even by that member. The recommendation says never; a member might reasonably want their own rulings visible to the reviewer of their own PRs.
7. **Should a reviewer's findings ever become recipes?** The current lean is no. The adjacent human-in-the-loop path (reviewer proposes, PR author accepts, the author's own agent deposits) would keep oversight intact and is worth a separate look.
8. **Merged-ranking multi-query search (P2).** Worth queuing as a ranking-program experiment, or parked until round trips are shown to hurt?

---

## 7. Unverified / could not confirm

- **Cursor Bugbot and MCP.** The docs sentence "Bugbot is integrated with your MCP servers so your AI tools can interact with Bugbot directly." reads as other tools calling Bugbot, while the next step, "Add the tools to Bugbot in Automations", reads as Bugbot calling tools. I could not determine whether Bugbot can call a customer's remote MCP server during a review, or how it would authenticate.
- **Greptile.** The `greptile.com/docs` pages returned empty content to my fetcher, so the `greptile.json` `customContext` / `scope` schema and any MCP-client capability are unconfirmed. Search-result summaries describe a Greptile MCP *server* (other agents calling Greptile), which is the opposite direction from what this doc needs. Only the marketing page quotes in §2.1 and §2.3 are confirmed.
- **Graphite.** The customization page does not say whether custom rules are per repository or org-wide, and says nothing about MCP or external context during review.
- **Qodo.** Path-hierarchical rule scoping is confirmed only from a vendor blog post (2026-09-01), not reference documentation. I did not confirm whether Qodo's reviewer can call external MCP servers; search summaries describe Qodo exposing its own MCP server to coding agents.
- **Devin.** I did not confirm whether Devin's MCP configuration supports a per-server tool allowlist or read-only mode, whether Devin Review (as distinct from a Devin session asked to review) can use MCP, or whether Knowledge can be written through the API by an external system (the API overview names knowledge as a resource but I did not read the endpoint reference).
- **Copilot custom-instruction length limits** for code review: commonly cited, not found on the pages I read, so omitted.
- **GitHub machine users and seats.** GitHub's docs state that Apps "do not consume a seat". I did not find a first-party sentence stating that a machine user does consume one, so that contrast is implied rather than quoted.
- **Slack.** The billing-policy page lists "Bots" under its "Free" member types alongside single-channel guests (string-matched on the page). I found no fuller first-party sentence explaining the rule, so the claim rests on that list entry.
- **Linear** app-actor scopes and admin-install requirement beyond the two quoted sentences.
- **Program doc claim check.** Nothing I found contradicts §4.4's statement that branch names die at merge and that PR number and merge commit are the durable handles. Two refinements: branch deletion is a repository setting rather than universal, and `merge_commit_sha` is only meaningful after `merged` is true (before that it is a test-merge SHA). The §4.4 "review packet ... using the quoted-filename lexical path" idea is in tension with this repo's own benchmark, as discussed in §3.
