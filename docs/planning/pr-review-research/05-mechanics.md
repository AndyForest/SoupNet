# PR review helpers: mechanics research (track 5)

Research track 5 for the "Soup.net as the back end for PR review helpers" plan. Scope: how a sweep agent finds PRs, writes a draft review for its human, runs unattended, stays inside rate limits and budgets, and resists prompt injection from PR content. All quotes were fetched on 2026-09-27 from the linked pages; where a fetch tool returned a summary rather than the page text, the item is marked **(unverified wording)**.

## Key findings for the plan

- **A pending GitHub review is private to its author, so the sweep has to write as the human.** GitHub's own docs say pending line comments are "only visible to you". A bot or GitHub App identity can create a pending review, but its human could never see or submit it. The "draft review for my human to approve" flow therefore needs the human's own credential (their `gh` login or a fine-grained PAT), not a bot identity. GitLab draft notes and Bitbucket pending comments behave the same way. This is the single biggest mechanical constraint on the design.
- **One pending review per user per PR, and REST cannot append to it.** GitHub rejects a second pending review ("User can only have one pending review per pull request"), and REST `POST .../reviews` always creates a new review. GraphQL `addPullRequestReviewThread` "Adds a new thread to a pending Pull Request Review", which is the way to add comments to a pending review the human already started instead of deleting and recreating it (which would destroy the human's edits).
- **Polling is the right default for a sweep that runs in the user's own Claude Code.** Webhooks need an endpoint GitHub can reach and a 10-second acknowledgement; GitHub recommends webhooks over polling, but a laptop sweep has no public endpoint. A search query such as `is:pr is:open review-requested:@me updated:>TIMESTAMP` fits well inside the 30 requests/minute search limit. Cloud routines and GitHub Actions are the event-driven alternatives when the sweep does not need to run as the human's local session.
- **"Done" state belongs on the PR, keyed by head SHA.** A review records `commit_id`; a marker such as `<!-- soupnet-sweep head=<sha> -->` in the pending review body (visible only to the human and the sweep) plus a small local state file lets the sweep skip PRs whose head SHA it already reviewed and find reviews the human has since submitted.
- **Headless runners exist for all three major CLIs.** `claude -p` (with `--bare`, `--mcp-config`, `--allowedTools`, `--permission-mode dontAsk`, `--permission-prompts none`, `--output-format json`), `codex exec` (read-only sandbox by default), and Gemini CLI `-p` all run non-interactively. Claude Code's JSON output carries `total_cost_usd`, which is how per-sweep cost should be measured rather than estimated.
- **Prompt injection through PR content is documented and exploited, not hypothetical.** Aikido's PromptPwnd research (December 2025) showed AI actions in CI leaking secrets through instructions hidden in issue and PR text. The mitigations that matter for this design: the review agent gets read-only repo access plus exactly one write path (the pending review), no secrets beyond what it needs, and never runs PR code. Because the human submits the review, a manipulated draft is caught at the human gate, which is the design's main structural defence.
- **Fork PRs and `pull_request_target` are the Actions trap.** Fork-triggered `pull_request` runs get a read-only `GITHUB_TOKEN` and no secrets; `pull_request_target` has secrets and write access, and GitHub warns that running untrusted code there "may lead to security vulnerabilities". A local or routine-based sweep that reads diffs through the API sidesteps this entirely.
- **Soup.net fit:** the planned headless-key setting (every deposit a draft, recipe e263dc40) matches the GitHub mechanic exactly: the review is a draft the human submits, and the recipes the sweep logs are drafts the human verifies. Both gates sit with the same human.

## 1. GitHub mechanics

### 1.1 Pending (draft) reviews

Creating one. The REST "Create a review" endpoint makes a pending review when `event` is left out.

> "By leaving this blank, you set the review action state to PENDING, which means you will need to submit the pull request review when you are ready."
> -- [REST API endpoints for pull request reviews](https://docs.github.com/en/rest/pulls/reviews)

> "Pull request reviews created in the PENDING state are not submitted and therefore do not include the submitted_at property in the response."
> -- [same page](https://docs.github.com/en/rest/pulls/reviews)

Visibility. Pending comments are private to their author until submitted.

> "Before you submit your review, your line comments are *pending* and only visible to you."
> -- [Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)

Issue, better approach, benefit: a bot-identity sweep would create pending reviews its human cannot see; running the sweep with the human's own GitHub credential puts the draft in the human's own "Finish your review" panel, where they edit, delete, and submit it in the normal GitHub UI with no new Soup.net surface.

One pending review per user per PR. The GraphQL error text, reported by the VS Code GitHub extension:

> "User can only have one pending review per pull request"
> -- [microsoft/vscode-pull-request-github#1317](https://github.com/microsoft/vscode-pull-request-github/issues/1317) (2019)

A 2025 community request describes the consequence for REST scripting:

> "a PR only allows one pending review per user, so the only path was deleting the first review and recreating it with both comments in the array."
> -- [community discussion #168380](https://github.com/orgs/community/discussions/168380) (August 2025)

GraphQL can append to an existing pending review, which that discussion does not mention:

> "Adds a new thread to a pending Pull Request Review."
> -- `addPullRequestReviewThread`, [GraphQL reference: Pulls](https://docs.github.com/en/graphql/reference/pulls); input `pullRequestReviewId`: "The Node ID of the review to modify."

Issue, better approach, benefit: if the human has already started a review on a PR, a REST create fails and a delete-and-recreate discards their work; detecting the existing pending review and adding threads to it through GraphQL (or skipping the PR and noting it) keeps the human's edits intact.

Submitting and deleting. Submission is `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events` with `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`; `DELETE .../reviews/{review_id}` "Deletes a pull request review that has not been submitted. Submitted reviews cannot be deleted." ([source](https://docs.github.com/en/rest/pulls/reviews)). The human normally submits from the GitHub UI; the sweep never needs the submit endpoint.

Line and multi-line comments. Each entry in the review's `comments` array takes `path`, `body`, `line`, `side`, and for ranges `start_line` and `start_side` ([source](https://docs.github.com/en/rest/pulls/reviews)). From the review-comments reference:

> "This parameter is closing down. Use line instead." (on `position`)
> "For a multi-line comment, the last line of the range that your comment applies to." (on `line`)
> "Required when using multi-line comments unless using in_reply_to. The start_line is the first line in the pull request diff that your multi-line comment applies to."
> -- [REST API endpoints for pull request review comments](https://docs.github.com/en/rest/pulls/comments)

Anchor to a SHA. `commit_id`: "The SHA of the commit that needs a review. Not using the latest commit SHA may render your review comment outdated if a subsequent commit modifies the line you specify as the position. Defaults to the most recent commit in the pull request when you do not specify a value." ([source](https://docs.github.com/en/rest/pulls/reviews)). Passing the head SHA the agent actually read makes the review honest about what it covered.

Suggestions. The UI docs describe suggested changes that "appear in an editable block, which PR authors can accept" **(unverified wording)** ([source](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)). Via the API, a suggestion is a ```` ```suggestion ```` fenced block inside a comment body; this is widely used but I did not find the API-side statement on a docs page during this track **(unverified)**.

Token permission. Creating, submitting, and deleting reviews all need fine-grained PAT "Pull requests" **write** ([permissions for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), fetched as a table: `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews | write`). A fine-grained PAT scoped to the review repositories with Pull requests write and Contents read is the least-privilege credential for a sweep that acts as the human.

### 1.2 `gh` CLI support

`gh pr review` supports only whole-review actions: flags `--approve`, `--comment`, `--request-changes`, `--body`, `--body-file` ([manual](https://cli.github.com/manual/gh_pr_review)). It has no line comments and no pending state, so the sweep writes the pending review through `gh api` (REST) or `gh api graphql`. Finding PRs: `gh search prs` has `--review-requested`, `--updated`, `--reviewed-by`, `--draft`, `--state`, `--owner`, `--repo`, `--json`; the manual's example is `gh search prs --review-requested=@me --state=open` ([manual](https://cli.github.com/manual/gh_search_prs)).

### 1.3 Finding new and updated PRs

Search qualifiers ([Searching issues and pull requests](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)):

- `review-requested:` "matches pull requests where a specific person is requested for review"
- `user-review-requested:@me` "matches pull requests that you have directly been asked to review" (excludes team requests)
- `team-review-requested:` "matches pull requests that have review requests from the team"
- `reviewed-by:`, `review:none`, `review:required`, `draft:false`, `updated:>` with date comparison **(the last two: unverified wording)**

The List pull requests endpoint has no `since` parameter; it sorts by `updated` and pages up to 100 per page ([source](https://docs.github.com/en/rest/pulls/pulls)), so "updated since" means sorting by `updated` descending and stopping at the watermark, or using search.

CODEOWNERS and team requests:

> "Code owners are automatically requested for review when someone opens a pull request that modifies code that they own."
> "Code owners are not automatically requested to review draft pull requests."
> -- [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

Issue, better approach, benefit: CODEOWNERS usually requests a team, so `user-review-requested:@me` misses those PRs; querying `review-requested:@me` (which the docs describe as matching a requested person and, per `gh`, "user or team") plus the teams the human belongs to covers both, and skipping `draft:true` matches GitHub's own behaviour of not requesting reviews on drafts.

### 1.4 Rate limits

REST ([Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)):

- Personal token: "All of these requests count towards your personal rate limit of 5,000 requests per hour."
- App installation: "use the installation's minimum rate limit of 5,000 requests per hour" (scales to a 12,500 maximum for larger non-Enterprise installs **(unverified wording)**).
- Actions: "The rate limit for `GITHUB_TOKEN` is 1,000 requests per hour per repository."
- Secondary: "No more than 100 concurrent requests are allowed"; "No more than 900 points per minute are allowed for REST API endpoints"; "no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour".
- The reviews page adds: "Creating content too quickly using this endpoint may result in secondary rate limiting." ([source](https://docs.github.com/en/rest/pulls/reviews))

GraphQL ([rate and query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)): "5,000 points per hour per user"; "1,000 points per hour per repository" for `GITHUB_TOKEN`; secondary "no more than 2,000 points per minute".

Search ([REST search](https://docs.github.com/en/rest/search/search)): "up to 30 requests per minute for all search endpoints except for the Search code endpoint"; "up to 1,000 results for each search".

Best practice ([REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)): "Making a conditional request does not count against your primary rate limit if a `304` response is returned"; "you should make requests serially instead of concurrently". The same page advises waiting at least one second between mutative requests **(unverified wording)**.

Implication (arithmetic, not a measurement): a sweep that runs one search per cycle and one review-create per PR it reviews is several orders of magnitude inside these limits for any individual reviewer. The binding limit is the content-creation cap if a single review is ever split into many separate comment calls; creating the review with all comments in one request avoids that.

### 1.5 Webhooks vs polling vs Actions

Webhooks. `pull_request` actions include `opened`, `synchronize`, `ready_for_review`, `review_requested`, `converted_to_draft`, `closed`; `pull_request_review` actions are `dismissed, edited, submitted` ([webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)). Delivery needs a receiver:

> "Your server should respond with a 2XX response within 10 seconds of receiving a webhook delivery."
> "You should not use smee.io to forward your webhooks in production."
> -- [Handling webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries)

GitHub prefers them: "You should subscribe to webhook events instead of polling the API for data." ([best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)). The docs I fetched do not state outright that the URL must be public **(unverified as a quoted requirement)**; in practice GitHub has to reach it, which is why smee.io exists for local development.

Actions triggers ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)):

- "By default, a workflow only runs when a `pull_request` event's activity type is `opened`, `synchronize`, or `reopened`."
- "The shortest interval you can run scheduled workflows is once every 5 minutes."
- "Scheduled workflows run on the latest commit on the default branch."
- "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days."

Issue, better approach, benefit: a webhook or Actions design needs infrastructure and runs as a bot, which contradicts the "pending review in my name" requirement; a polling sweep in the human's own Claude Code (or a routine acting as the human, see 3.4) runs where the human's credentials already are, needs no public endpoint, and its latency (minutes to an hour) is fine for review work.

### 1.6 GitHub App vs personal token

From [Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app) **(fetched as a summary; quoted fragments unverified wording)**: Apps use "fine-grained permissions", "short lived tokens", "can act independently of a user", "do not consume a seat", have rate limits that scale with repositories and users, and "built-in, centralized webhooks".

Trade-off for this design: an App is the right identity for a team-wide bot that posts submitted reviews, but it cannot produce a draft the human finishes, because the draft would be the App's own pending review. A personal credential (fine-grained PAT or the human's `gh` login) is the one that fits the draft-for-my-human flow. A later "team bot" mode that posts submitted comment reviews could use an App.

## 2. GitLab, Bitbucket, Azure DevOps

GitLab draft notes ([Draft notes API](https://docs.gitlab.com/api/draft_notes/)):

> "Use this API to manage draft notes. These notes are pending, unpublished comments on merge requests. Draft notes can start a discussion, or continue an existing discussion as a reply."
> "Publishes all pending draft notes for a merge request that belong to the user." (bulk publish)

Endpoints: `GET/POST /projects/:id/merge_requests/:merge_request_iid/draft_notes`, `PUT .../draft_notes/:draft_note_id/publish`, `POST .../draft_notes/bulk_publish`, `DELETE .../draft_notes/:draft_note_id`. Create takes `note`, `position`, `in_reply_to_discussion_id`, `resolve_discussion`; bulk publish can set `reviewer_state` **(parameter list from a fetch summary, unverified wording)**. Unlike GitHub, GitLab has no single-pending-review object, so appending drafts is natural. That drafts are visible only to their author is stated in the fetch summary but not in the verbatim text I could retrieve **(unverified)**; "that belong to the user" implies per-user ownership.

GitLab MR listing ([Merge requests API](https://docs.gitlab.com/api/merge_requests/)): `updated_after` "Returns merge requests updated on or after the given date and time. Expected in ISO 8601 format (`2019-03-15T08:00:00Z`)" **(unverified wording)**; `reviewer_username`, `scope=reviews_for_me`, `state`, `draft`; `diff_refs.head_sha` gives the head SHA for the state marker.

GitLab webhooks ([webhook events](https://docs.gitlab.com/user/project/integrations/webhook_events/)): header `X-Gitlab-Event: Merge Request Hook`; triggers include "A new merge request is created." and "A commit is added in the source branch."

Bitbucket Cloud: pending comments are reported (search summary, **unverified**) to be created with `"pending": true`, visible only to their author, with no public endpoint to publish them, so the human would finish the review in the UI. The source I could reach was [Atlassian's "Batched comments" announcement](https://community.atlassian.com/forums/Bitbucket-articles/New-in-pull-requests-Batched-comments/ba-p/2534448), whose body did not load.

Azure DevOps: not researched in this track.

Portability note: all three platforms share the "pending comments belong to their author" shape, so the sweep's core contract (write drafts as the human, the human publishes) ports; only GitHub has the one-pending-review constraint.

## 3. Running agents headless

### 3.1 Claude Code print mode

From [Run Claude Code programmatically](https://code.claude.com/docs/en/headless):

- "Add the `-p` (or `--print`) flag to any `claude` command to run it non-interactively."
- Output: `text` (default), `json` ("structured JSON with result, session ID, and metadata"), `stream-json`; `--json-schema` returns schema-conforming output in `structured_output`.
- "With `--output-format json`, the response payload includes `total_cost_usd` and a per-model cost breakdown, so scripted callers can track spend without consulting the usage dashboard." Both figures "are client-side estimates and can differ from your actual bill."
- `--bare`: "skipping auto-discovery of hooks, skills, custom commands, subagents, installed plugins, MCP servers, auto memory, and CLAUDE.md"; "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." Bare mode "never reads OAuth credentials or the system keychain", so it needs `ANTHROPIC_API_KEY` or `apiKeyHelper`.
- MCP in headless: pass `--mcp-config <file-or-json>`; with `-p`, Claude Code "waits for still-pending servers before running the first turn, up to the `MCP_TIMEOUT` startup timeout, 30 seconds by default"; invalid entries are skipped and reported in `mcp_server_errors`, "so a CI gate can fail on a non-empty array."
- Permissions: "For `-p`, the built-in starting permission mode is Manual on every plan"; `dontAsk` "denies every call that would otherwise prompt, which is useful for locked-down CI runs"; `--permission-prompts none` for "when nobody is available to answer permission prompts, for example in a scheduled job."
- Skills in `-p`: "User-invoked skills and custom commands work. Include `/skill-name` in the prompt string and Claude Code expands it before running." Note that `--bare` skips skill discovery except from `--add-dir` directories.
- Trust: "Without `--bare`, a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted." The security page repeats: "Trust verification is disabled when running non-interactively with the `-p` flag" ([Security](https://code.claude.com/docs/en/security)).

Issue, better approach, benefit: a sweep that checks out PR branches and runs `claude -p` inside them without `--bare` would load the PR author's `.claude/settings.json` hooks and `.mcp.json`, which is arbitrary code from an untrusted contributor; running from a fixed directory (the sweep's own folder) with `--bare`, reading PR content through the API or into a subdirectory, keeps PR-supplied configuration inert.

Agent SDK: the same page says the Agent SDK "gives you the same tools, agent loop, and context management that power Claude Code", as a CLI or Python/TypeScript packages "with structured outputs, tool approval callbacks, and native message objects". Worth it when the sweep grows beyond a shell loop (for example a `canUseTool` callback that permits only the pending-review write).

### 3.2 Claude Code GitHub Action and Code Review

From [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions): `anthropics/claude-code-action@v1` runs in "Automation mode: when the workflow provides a `prompt` input", can run a skill ("pass `/skill-name` as the `prompt`"), and on a `schedule` trigger. The review example uses `--comment` to post "an inline comment on each issue it finds", i.e. submitted comments, not a pending review. Identity: "When omitted, the Claude Code GitHub Action authenticates as the Claude GitHub App". Fork limits: "On public repositories, GitHub withholds secrets from runs triggered by fork pull requests, so the review runs only on pull requests from branches in the same repository." Access: "the triggering user must have write access to the repository." Cost: runs consume "GitHub Actions minutes" and "API tokens"; "If you authenticate with an OAuth token, runs use your Claude subscription instead of API billing."

Fit: good for a team-wide automated first pass; poor for the draft-for-my-human flow, because it posts as the App.

### 3.3 Codex and Gemini CLI

Codex ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), **fetched as a summary, unverified wording**): `codex exec "..."` streams progress to stderr and prints the final message to stdout; sandbox "Defaults to read-only" with `--sandbox workspace-write` or `danger-full-access`; `--json` event stream, `-o/--output-last-message`, `--output-schema`; `codex exec resume`; `CODEX_API_KEY` for CI; `--ephemeral`, `--ignore-user-config`. The [Codex GitHub Action](https://github.com/openai/codex-action) offers safety strategies; its read-only mode "Executes Codex in a read-only sandbox. Codex can view files but cannot mutate the filesystem or access the network directly."

Gemini CLI ([headless mode](https://geminicli.com/docs/cli/headless/)): "Headless mode is triggered when the CLI is run in a non-TTY environment or when providing a query with the `-p` (or `--prompt`) flag." Output formats `json` and `stream-json`. Approval-mode flags were not on that page **(not researched further)**.

Portability: the sweep skill's contract (inputs: PR list; outputs: pending review JSON plus Soup.net calls) can be CLI-agnostic if the GitHub write is done by a small script rather than by the agent, which also narrows the agent's write surface (see 5).

### 3.4 Claude Code routines (cloud scheduling)

From [Automate work with routines](https://code.claude.com/docs/en/routines) ("Routines are in research preview. Behavior, limits, and the API surface may change."):

- Triggers: "Scheduled", "API", and "GitHub: run automatically in response to repository events such as pull requests or releases". Example given: "Bespoke code review. A GitHub trigger runs on `pull_request.opened`. The routine applies your team's own review checklist, leaves inline comments".
- Schedule: "The minimum interval is one hour; expressions that run more frequently are rejected."
- Identity: "Anything a routine does through your connected GitHub identity or connectors appears as you: commits and pull requests carry your GitHub user". This is the one managed runner that acts as the human, so a pending review it creates would be the human's own draft **(inference; whether the routine's GitHub path exposes the review API was not verified)**.
- Autonomy: "there is no permission-mode picker"; connectors: "Claude can use every tool from an included connector, including writes, without asking for permission during a run."
- Limits: "routines have a daily cap on how many runs can start per account"; GitHub webhook events "are subject to per-routine and per-account hourly caps. Events beyond the limit are dropped until the window resets." Available on "Pro, Max, Team, and Enterprise plans".
- Untrusted input handling: API-trigger text "arrives wrapped in a `<routine-fire-payload>` block that labels it as untrusted data".

Local alternatives named on the same page: "`/loop` and in-session scheduling" and "Desktop scheduled tasks: local scheduled tasks that run on your machine with access to local files".

### 3.5 OS schedulers

Windows Task Scheduler ([schtasks create](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create)): "HOURLY - Specifies that the task runs every <n> hours. You can use any value between 1 - 23 hours"; example `schtasks /create /sc hourly /st 00:05 /tn MyApp /tr c:\apps\myapp.exe`. The `/it` flag "Specifies to run the scheduled task only when the run as user ... is logged on to the computer", which matters if the sweep relies on the user's keychain-held `gh` and Claude logins. Cron on macOS/Linux is equivalent (not separately sourced).

### 3.6 State tracking

The sweep needs to answer two questions each cycle: "have I already drafted a review for this head SHA?" and "has my human resolved a draft I made?". Mechanisms, all using facts above:

- Head SHA per PR: `head.sha` from the PR object (GitHub) or `diff_refs.head_sha` (GitLab).
- Review anchor: the review's `commit_id`, set explicitly to the SHA read.
- Marker in the pending review body, for example `<!-- soupnet-sweep v1 head=<sha> intent=<int_id> -->`. Only the author (the human, whose credential the sweep uses) can read a pending review, so the marker is private until submission; after submission it stays in the review body as an HTML comment (not rendered in GitHub's Markdown view, but present in the raw body; **unverified that GitHub strips nothing**).
- Resolution: listing the PR's reviews (returned "chronologically from earliest to most recent" **(unverified wording)**) shows whether the marked review is still `PENDING`, `COMMENTED`, `APPROVED`, `CHANGES_REQUESTED`, or gone (deleted by the human). That state is the signal to verify or discard the matching Soup.net draft recipes.
- A local watermark file (last successful sweep timestamp) feeds `updated:>`; the SHA check, not the timestamp, decides whether to re-review, so a missed or duplicated cycle is harmless.
- New commits after a draft: the pending review is anchored to the old SHA; deleting it would destroy human edits. The safe default is to leave it, note in the next cycle's summary that the PR moved, and let the human decide.

## 4. Cost and rate considerations

Only quoted numbers; no per-PR estimate is given because none is published and one should be measured.

- Claude API ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing)), per million tokens input / output: Claude Opus 5.5 "$4 / MTok" / "$20 / MTok"; Claude Sonnet 5 "$2 / MTok" / "$10 / MTok"; Claude Haiku 4.5 "$1 / MTok" / "$5 / MTok". "The Batch API allows asynchronous processing of large volumes of requests with a 50% discount on both input and output tokens." "Cache read (hit) 0.1x base input price (0.025x on Claude Fable 5.1 and Claude Mythos 5.1; 0.05x on Claude Opus 5.5)". Also: "Claude 4.7 and later models ... use a newer tokenizer ... This tokenizer produces approximately 30% more tokens for the same text."
- Subscriptions: GitHub Action runs with an OAuth token "use your Claude subscription instead of API billing" ([source](https://code.claude.com/docs/en/github-actions)); routines "draw down subscription usage the same way interactive sessions do" plus a daily run cap ([source](https://code.claude.com/docs/en/routines)).
- GitHub Actions ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), fetched as a summary): usage "is **free** for **self-hosted runners** and for **public repositories** that use standard GitHub-hosted runners"; included minutes GitHub Free "2,000", Pro "3,000", Team "3,000"; "Linux 2-core (x64)" "$0.006" per minute beyond the quota **(unverified wording)**.
- GitHub API limits: section 1.4. A polling sweep is not rate-limit-bound at individual scale.

How to measure per-PR cost: run each review as its own `claude -p --output-format json` call and record `total_cost_usd`, PR size (changed lines, files), model, and cache-read tokens per run; after a few dozen PRs, fit cost against diff size. Remember the docs' caveat that these are client-side estimates. For subscription-auth runs, the same JSON still reports tokens, which is the portable unit.

## 5. Security mechanics

Documented incident class. Aikido Security's PromptPwnd research ([blog](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents), fetched as a summary): the pattern is "Untrusted user input → injected into prompts → AI agent executes privileged tools → secrets leaked or workflows manipulated"; affected tools named include Gemini CLI, Claude Code Actions, OpenAI Codex Actions and GitHub AI Inference; Google patched the Gemini CLI issue "within four days" (December 2025) **(timeline wording unverified)**. Press coverage reports impact at "at least five Fortune 500 companies" ([CyberScoop](https://cyberscoop.com/ai-coding-tools-can-be-turned-against-you-aikido-github-prompt-injection/), via search summary, **unverified wording**). Aikido's recommendations include restricting the AI's toolset (including preventing it from writing to issues or PRs), not injecting untrusted input into prompts, and validating AI output.

Vendor guidance.

- Claude Code Action ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)): "External contributors may include hidden instructions through HTML comments, invisible characters, hidden attributes, or other techniques. The action sanitizes content by stripping HTML comments, invisible characters, markdown image alt text, hidden HTML attributes, and HTML entities, but new bypass techniques may emerge." And: "Do not check out an untrusted ref into the workspace root before this action."; the recommended pattern checks the PR head into a subdirectory and passes it with `--add-dir`.
- Claude Code ([Security](https://code.claude.com/docs/en/security)), best practices for untrusted content: "Avoid piping untrusted content directly to Claude"; "Use virtual machines (VMs) to run scripts and make tool calls, especially when interacting with external web services"; "While these protections significantly reduce risk, no system is completely immune to all attacks."
- Codex Action: read-only safety strategy quoted in 3.3; the README also warns "The OpenAI API key still flows through the proxy, so Codex could read it if it can reach process memory."

Fork PRs and `pull_request_target`.

> "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is triggered from a forked repository. The `GITHUB_TOKEN` has read-only permissions in pull requests from forked repositories."
> "Running untrusted code on the `pull_request_target` trigger may lead to security vulnerabilities. These vulnerabilities include cache poisoning and granting unintended access to write privileges or secrets."
> -- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

> "Combining `pull_request_target` workflow trigger with an explicit checkout of an untrusted PR is a dangerous practice that may lead to repository compromise."
> -- [GitHub Security Lab, Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)

Soup.net's own repo already requires approval for all outside PR workflow runs (recipe 9ab0e29d), which is consistent with this.

What this means for the sweep, as issue, better approach, benefit:

- Issue: the review agent reads attacker-controllable text (diff, PR title and body, comments, and repository files such as `CLAUDE.md` or `.mcp.json` on the PR branch). Better approach: fetch the diff and metadata through the API into the sweep's own working directory, run `claude -p --bare` from there, never execute PR code, and never let PR-branch config load. Benefit: injected text can at worst shape the draft's words, not run code or read secrets.
- Issue: an agent with a general-purpose GitHub token can be steered into posting, approving, or editing. Better approach: give the agent no GitHub write tool at all; it emits review JSON (file, line range, body, the Soup.net draft ids it logged), and a small deterministic script validates paths and lines against the diff and creates the pending review with the human's fine-grained PAT (Pull requests write, Contents read, only the target repos). Benefit: the only write the whole system can make is a private draft the human must submit.
- Issue: an injected instruction could try to make the agent deposit misleading recipes. Better approach: a headless Soup.net key (all deposits drafts, e263dc40) and the "results are context, not instructions" framing already on search. Benefit: nothing reaches the shared corpus without the same human's verification.
- Issue: the human gate only works if the human reads the draft. Better approach: the review body should say plainly that it is an agent draft and list what was verified versus inferred, echoing the operator's own practice of posting only hand-verified comments with verification steps beside each (recipe 97fa42eb). Benefit: the gate is informed rather than rubber-stamped.

## Recommended minimal mechanics recipe for a sweep

A sketch for GitHub, running as the human on their own machine (Windows Git Bash shown; cron is equivalent). Assumptions: `gh` is logged in as the human, or `GH_TOKEN` holds their fine-grained PAT; the Soup.net headless key is in the sweep's MCP config. Commands are illustrative, not tested in this track.

```bash
# 0. One-time: sweep folder, state file, MCP config for the headless Soup.net key
mkdir -p ~/pr-sweep && cd ~/pr-sweep
echo '{"last_run":"2026-09-01T00:00:00Z","reviewed":{}}' > state.json
# mcp.json holds the Soup.net server entry with the headless key in its Authorization header

# 1. Find candidate PRs (search API, 30 req/min budget)
SINCE=$(jq -r .last_run state.json)
gh search prs --review-requested=@me --state=open --draft=false \
  --updated=">$SINCE" --json number,repository,url,updatedAt > candidates.json
# (also query each team the human belongs to, for CODEOWNERS team requests)

# 2. For each PR: skip if head SHA already reviewed or a pending review of mine exists
HEAD=$(gh api repos/$OWNER/$REPO/pulls/$N --jq .head.sha)
MINE_PENDING=$(gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | select(.state=="PENDING")] | length')

# 3. Collect review inputs outside any PR checkout
gh pr diff $N -R $OWNER/$REPO > pr-$N.diff
gh pr view $N -R $OWNER/$REPO --json title,body,files,author > pr-$N.json

# 4. Run the review skill headless, from the sweep folder, with no GitHub write tool
claude --bare -p "/pr-review-sweep pr-$N.diff pr-$N.json" \
  --add-dir ./skills-dir \
  --mcp-config mcp.json \
  --permission-mode dontAsk --permission-prompts none \
  --allowedTools "Read,mcp__soupnet__get_briefing,mcp__soupnet__search_recipes,mcp__soupnet__check_recipe,mcp__soupnet__log_feedback" \
  --output-format json --json-schema "$(cat review-schema.json)" > out-$N.json
jq '.total_cost_usd' out-$N.json   # measure, don't estimate

# 5. Deterministic write: validate lines against the diff, then create a PENDING review
jq --arg sha "$HEAD" '{commit_id:$sha,
    body:(.structured_output.summary + "\n\n<!-- soupnet-sweep v1 head=" + $sha + " -->"),
    comments:.structured_output.comments}' out-$N.json > review-$N.json
gh api -X POST repos/$OWNER/$REPO/pulls/$N/reviews --input review-$N.json   # no "event" => PENDING
# If MINE_PENDING > 0: add threads with GraphQL addPullRequestReviewThread instead, or skip

# 6. Resolution pass: find marked reviews the human has submitted or deleted
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '.[] | select(.body | contains("soupnet-sweep")) | {id,state,commit_id}'
# state != PENDING => human resolved it: verify/discard the matching Soup.net drafts

# 7. Advance the watermark only after the cycle succeeds
jq --arg t "$(date -u +%FT%TZ)" '.last_run=$t' state.json > s && mv s state.json

# Schedule (Windows): hourly, only while the human is logged on (keychain credentials)
schtasks /create /sc hourly /st 00:07 /it /tn "PR sweep" /tr "C:\path\to\sweep.cmd"
```

Why this shape: the agent reads and writes Soup.net drafts only; the only GitHub write is a script-made pending review under the human's identity; PR content never becomes configuration; the SHA marker makes cycles idempotent. The interactive variant is the same skill run inside the human's normal Claude Code session, skipping step 4's flags.

## Soup.net use

- Intent: `int_aMSw6csn3MATTAGcSAx3vvJX` (agent_id `a-pr-review-research-mechanics-2026-09-27`).
- Searches (all `author:anyone`):
  - `1d8f5a72-bb4a-4005-84bc-b63c161a2173` headless / long-lived keys / scheduled sweeps: surfaced e263dc40 (headless key, deposits forced to drafts), 5295e40f (autonomous PR-review agents as a no-deposit principal), eb4b77eb (derived scoped keys). Shaped the "two gates, same human" framing and the least-privilege recommendation.
  - `79541dd9-a577-4d29-8636-9ccff637872a` prompt injection from untrusted content: nothing directly on PR-borne injection; tangential hits (845776d4 on community suggestions as an injection vector by construction). Null result for this topic.
  - `d31065bc-8618-4eda-850f-a496ab7f7efb` PR review, draft PRs, polling vs webhooks: surfaced 97fa42eb (post only hand-verified comments, verification beside each), 9ab0e29d (approval for all outside PR runs), 3c8600ac (event-driven over timer polling for an always-on agent). Used 97fa42eb and 9ab0e29d in section 5. 3c8600ac is a counter-lean worth weighing: for an always-on personal agent the operator preferred event-driven pulls over timer polling "because the agent only needs fresh state when it's about to act". The polling recommendation here rests on the absence of a reachable endpoint for a laptop sweep; if the sweep runs as a routine, its GitHub trigger is the event-driven option.
- Recipes fetched: 97fa42eb, 9ab0e29d, 5295e40f, eb4b77eb.
- Checks: none. The identity decision (sweep writes as the human) is a recommendation from platform mechanics, not yet an operator position, so it is escalated rather than logged.
- Feedback: logged against each search id (see final report).
