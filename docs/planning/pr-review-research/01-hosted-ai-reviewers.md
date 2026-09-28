# Hosted AI PR reviewers: configuration, learning, and preference memory

Research track 1 for the PR review helpers plan. Researched 2026-09-27 by sub-agent `a-pr-review-research-hosted-2026-09-27`.

Method note: quotes were extracted from vendor pages with a fetch tool that summarizes pages; the quoted strings were returned as verbatim, but a human spot-check against the linked page is worth doing before any quote is reused in public copy. Anything I could only see in a search-engine snippet, and not on the vendor page itself, is marked **unverified**.

## Key findings for the plan

- Line-level bug finding, PR summaries, one-click fixes, and in-PR chat are table stakes in every tool surveyed (CodeRabbit, Copilot, Graphite, Greptile, Qodo, Bugbot, Sourcery, Bito, Gemini, Amazon Q, Devin). Soup.net helpers should consume or sit beside these, not rebuild them.
- Every tool has a static layer (repo files such as `copilot-instructions.md`, `.cursor/BUGBOT.md`, `.gemini/styleguide.md`, `.amazonq/rules`, `REVIEW.md`, `AGENTS.md`, or dashboard rules). Several now read each other's files: Copilot reads `REVIEW.md`, `GEMINI.md`, and `CLAUDE.md`; CodeRabbit reads `.cursorrules`, `CLAUDE.md`, `AGENTS.md`. A shared repo-file convention is emerging, and it is where Soup.net-confirmed judgment could be exported so every reviewer benefits.
- The learning layer splits into two families. Natural-language learnings (CodeRabbit Learnings, Bugbot `@cursor remember`, Copilot Memory) keep the human's reason as text. Signal-driven suppression (Greptile embeddings, Sourcery and Bito thumbs, Bugbot candidate rules, Qodo Rule Miner) infers rules from reactions and accepted suggestions, often activating them without a human seeing the rule first.
- Provenance and lifecycle are uneven. Best in class: Qodo Rule Miner links each rule to its source PR; Copilot Memory stores citations to code, re-validates them, and expires unused facts after 28 days; CodeRabbit records PR number, file, and GitHub user. No tool I found records the human's verbatim reason plus the context it applies to plus who confirmed it, and conflict handling is limited to precedence orders and duplicate skipping.
- Learnings are siloed per vendor and per repo (Copilot Memory is explicitly same-repository only). A team using two reviewers teaches each one separately, and nothing carries a judgment from one repo, tool, or reviewer to another. That cross-tool, cross-repo judgment memory is the gap Soup.net fits.
- I found no tool whose documentation describes the reviewer asking a human a question about the team's taste and judgment before or instead of commenting. Chat in these tools is human-initiated (`/q`, `/gemini`, `@coderabbitai`, Graphite's "ask clarifying questions" is the human asking). The draft-recipe loop (sweep agent asks, personal agent relays, human confirms) has no direct precedent in this set.
- Automatic rule activation is the norm and trending more automatic: Qodo flipped Rule Miner to auto-approve by default for new organizations from 2026-09-01; Bito auto-enables a learned rule after 3 negative reactions; Bugbot promotes candidate rules on accumulated signal. This conflicts with the operator's recorded bar that automated review be observable and verifiable, which argues for Soup.net's human-confirmed drafts as the differentiator.
- Market churn is real: Ellipsis's current site no longer presents a code review product, and Amazon Q Developer is closed to new signups and heading to end of support. Soup.net should integrate via neutral surfaces (GitHub PR comments, repo files, MCP) rather than any single vendor's API.

## Per-tool sections

### CodeRabbit

What it does and how configured: repo file `.coderabbit.yaml` plus dashboard settings. "`.coderabbit.yaml` configuration file must be located in the root of the repository. The configuration present in the feature branch under review will be automatically detected and used by CodeRabbit for that review." ([YAML configuration](https://docs.coderabbit.ai/getting-started/yaml-configuration)). Path-scoped rules: "Custom review rules that only apply to files matching a glob pattern." Code guidelines: "Files in your repository that describe your team's coding standards, such as `.cursorrules`, `CLAUDE.md`, or `AGENTS.md`. CodeRabbit reads these files and applies them as review criteria." ([glossary](https://docs.coderabbit.ai/reference/glossary))

What it learns and how stored: "When you respond to CodeRabbit's review comments (for example, 'we prefer early returns over try-catch in this repo'), CodeRabbit remembers that preference and applies it to future reviews." ([glossary](https://docs.coderabbit.ai/reference/glossary)). "To add learnings to the database CodeRabbit keeps about your organization's preferences, communicate your preferences using natural language, in a comment attached to any pull request or issue." Files can be imported: "@coderabbitai add a learning using docs/coding-standards.md". ([Learnings](https://docs.coderabbit.ai/knowledge-base/learnings))

Scope: three modes. "Local": "CodeRabbit applies only learnings associated with code reviews' respective repositories." "Global": "CodeRabbit applies all of your organization's learnings to all code reviews." "Auto" (default): "When reviewing a public repository, CodeRabbit applies only the learnings specific to that repository. When reviewing a private repository, CodeRabbit applies all of your organization's learnings." ([Learnings](https://docs.coderabbit.ai/knowledge-base/learnings))

Provenance, edit, expiry, conflicts: learnings carry "the pull request number, filename, and GitHub user associated with the learning"; users can "edit the text of any stored learning or delete it through the CodeRabbit dashboard". No expiry is described. Conflict handling is precedence only: "Path instructions precede learnings". ([Learnings](https://docs.coderabbit.ai/knowledge-base/learnings))

Stance on feedback signals: CodeRabbit argues against emoji reactions. "A single scalar signal tells the system _something went well_, but not _what went well_." and "The model doesn't guess based on thumbs, it reasons from your team's actual guidance." ([Why Emojis Fail for Reinforcement Learning, 2025-11-07](https://www.coderabbit.ai/blog/why-emojis-suck-for-reinforcement-learning))

Human interaction: PR comments and `@coderabbitai` chat; web dashboard at app.coderabbit.ai/learnings.

Pricing (vendor page): "Essentials" "$24/ developer / month", "Team" "$48/ developer / month", "Advanced" "$72/ developer / month", "Enterprise" "Custom"; the comparison table lists Learnings on all four. ([pricing](https://www.coderabbit.ai/pricing)). Billing period on that page as extracted: billed annually (not re-verified).

### GitHub Copilot code review

What it does: "Copilot reviews your pull requests, identifies issues, and suggests fixes you can apply in a couple of clicks." Reviews include "an approval assessment in the overview comment, indicating whether Copilot has determined the pull request ready to approve." "By default, Copilot's reviews do not count toward required approvals for the pull request." ([About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review))

Configuration: custom instructions are "short, natural-language statements that you write and store as one or more files in a repository" (`.github/copilot-instructions.md`, path-scoped `*.instructions.md`). ([About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)). July 2026: "Custom instructions are now read from the head branch of the pull request instead of the base branch." and "Copilot code review now reads `REVIEW.md`, `GEMINI.md`, and `CLAUDE.md` files from your repository." ([changelog 2026-07-17](https://github.blog/changelog/2026-07-17-copilot-code-review-customization-and-configurability-improvements/))

What it learns (Copilot Memory): stores "Repository-level facts" such as "coding conventions, architectural decisions, build commands, and project-specific rules". Facts are created only "in response to actions by users with write access to the repository who have Copilot Memory enabled." Provenance and validation: "Repository-level facts are stored with citations pointing to the code that supports them. When Copilot finds a fact relevant to its current work, it checks those citations against the current branch to confirm the information is still accurate." Expiry: "Any stored fact or preference that goes unused is automatically deleted after 28 days. The 28-day timer may reset whenever Copilot successfully validates and uses an entry." Scope: facts "can only be used in operations on the same repository". Access: "Repository owners can review and manually delete the repository-level facts stored for their repository." Used by "Copilot cloud agent, Copilot code review, Copilot CLI, and agentic autofix." ([Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))

Feedback signals: the code review concepts page does not describe thumbs-based learning (not found on that page).

Pricing (vendor pages): code review "is available on the Copilot Pro, Copilot Pro+, and Copilot Max plans, and with a Copilot Business or Copilot Enterprise license." ([About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)). "A review typically consumes an estimated $0.05 USD to $1 USD worth of AI credits with 'Lite' effort, and $0.25 USD to $5 USD with 'Balanced' effort." (same page). Plans page as extracted: Pro "$10/month", Pro+ "$39/month", Max "$100/month", "1 AI credit = $0.01 USD" ([plans](https://github.com/features/copilot/plans); Business and Enterprise prices not extracted).

### Graphite (Diamond, now Graphite Agent)

What it does: "Get instant feedback, suggestions, and fixes applied directly in your diff" and "Follow up on suggestions, ask clarifying questions, and apply changes conversationally." ([Meet Graphite Agent, 2025-10-07](https://graphite.com/blog/introducing-graphite-agent-and-pricing)). AI reviews "Focuses on real bugs - not just style issues or best practices". ([AI Reviews docs](https://graphite.com/docs/ai-reviews))

Configuration: web dashboard "Rules & exclusions" tab. Exclusions let you "specify situations where Graphite Agent should **not** leave comments." Custom rules as "Custom Prompts (Recommended)": "Rules written directly in the Graphite UI", or file-based rules that "reference existing documentation in your repository using glob patterns." ([Customization](https://graphite.com/docs/ai-review-customization))

What it learns: "Learns from feedback - improves based on how your team interacts with comments" ([AI Reviews docs](https://graphite.com/docs/ai-reviews)). The customization page tracks "Upvote/Downvote rates: Direct feedback from your team" for custom rules ([Customization](https://graphite.com/docs/ai-review-customization)). How learned behavior is stored, and whether it is visible, is not documented on the pages I read.

Human interaction: chat on the PR page (human-initiated); dashboard for rules.

Pricing (vendor post): "Hobby" (free), "Starter" ($20), "Team" ($40) ([Meet Graphite Agent](https://graphite.com/blog/introducing-graphite-agent-and-pricing)). Billing unit (per user per month) not confirmed on the vendor page; **unverified**.

### Greptile

What it learns: "Greptile observes patterns in your team's code review discussions"; "Your responses teach Greptile what matters"; "Thumbs up/down reactions provide instant feedback on suggestion quality"; "Greptile analyzes which comments get addressed by comparing first and last commits". "Greptile automatically infers custom rules from team behavior without manual configuration". Example timeline: "Week 1: Style comments get 👎 reactions", "Week 3: Performance comments get 👍 reactions", "Week 6: Greptile stops style suggestions, focuses on performance". A context-setting reply example: "In our domain layer, we prefer detailed functions for clarity". ([Memory and Learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning))

How stored: the engineering post describes per-team embedding filters. "If the comment had a cosine similarity exceeding some threshold with at least 3 unique downvoted comments, it would get blocked." Result: "address rate (percentage of Greptile's comments that devs address before merging) go from 19% to 55+%". Why: prompting failed and LLM-as-judge severity "was nearly random". ([How to Make LLMs Shut Up](https://www.greptile.com/blog/make-llms-shut-up)). The docs page does not describe a dashboard for viewing, editing, expiring, or tracing learned rules.

Pricing (vendor page): "Starter" free with "50 credits per month"; "Pro" "$30/seat/month" with "50 credits included per seat" and "$1 per additional credit" and "Create custom rules"; "Enterprise" "Custom pricing". ([pricing](https://www.greptile.com/pricing))

### Qodo (Qodo Merge, open-source PR-Agent)

What it does and how configured: "Qodo builds Review Standards from your codebase, pull request history, and requirements"; "Qodo uses your pull request history to judge whether a finding is likely to matter"; "Where nothing team-specific applies, Qodo falls back to established best practices". Chat: "Ask follow-up questions or request changes, right in the thread". ([Code review](https://docs.qodo.ai/code-review))

What it learns (Rule Miner): "Rule Miner continuously turns recurring patterns from your team's own PR history into new enforced rules" ([Code review](https://docs.qodo.ai/code-review)), drawing on "comments that were accepted by developers and led to code changes, recurring behaviors that reviewers consistently flag". ([Rule Miner](https://docs.qodo.ai/governance/rule-enforcement/rule-miner))

Approval: with auto-approve on (default for new organizations since 2026-09-01) "Generated rules are activated automatically"; with it off "Generated rules appear in Rules > Suggestions for review before activation". Provenance: "Each rule includes a link back to the pull request it was generated from." and "the Source field shows the pull request count instead of a single link." Scope: "area-specific rules, scoped to the paths they govern." Conflicts: "Rules that are too similar to existing ones (whether manually created or previously mined) are skipped automatically." ([Rule Miner](https://docs.qodo.ai/governance/rule-enforcement/rule-miner))

Older PR-Agent mechanics (accepted-suggestion tracking into a wiki page, a monthly `.pr_agent_auto_best_practices` file, the "Learned best practice" label, `/scan_repo_discussions` writing a `best_practices.md` PR) appear in search snippets but the current docs redirect to the new Rule Miner pages; **unverified** against a live vendor page.

Pricing (vendor page): "Pro Team" "$30" per month, "Monthly billing • no commitment", credit packs such as "~18 Reviews/Mo" with "2,500 credits", "$.012/credit, pooled across the team"; Enterprise "For 30+ users" with "Annual contracts & negotiated pricing". ([pricing](https://www.qodo.ai/pricing/))

### Cursor Bugbot

Configuration: "Create `.cursor/BUGBOT.md` files to provide project-specific context for reviews." ([Bugbot docs](https://cursor.com/docs/bugbot))

What it learns: "Rules are generated automatically from your team's activity on GitHub for that repository or by manually backfilling from the history of the repository." "You can also teach Bugbot new rules inline by commenting `@cursor remember [fact]` on any PR." "Cursor will automatically enable or disable rules as it learns more about your team's activity over time." ([Bugbot docs](https://cursor.com/docs/bugbot)). Signals: "Reactions to Bugbot comments, where a downvote tells Bugbot the finding wasn't useful."; "Replies to Bugbot comments, in which developers explain what was wrong or how the suggestion could have been better."; "Comments from human reviewers, which flag issues that Bugbot missed." Lifecycle: "Bugbot processes these signals into candidate rules that it continues to evaluate against incoming PRs. As signal accumulates, Bugbot can promote a candidate rule to active status where it begins influencing future reviews." and "if an active rule starts generating consistent negative signal, Bugbot can disable it." Management: "You can also edit or delete rules directly in the UI". Adoption: "Since launching learned rules in beta, more than 110,000 repos have enabled learning, generating more than 44,000 learned rules." ([Bugbot learning, 2026-04-08](https://cursor.com/blog/bugbot-learning)). A community feature request asks for a git-based way to promote learned rules into repository rules ([forum](https://forum.cursor.com/t/api-or-git-based-workflow-to-promote-bugbot-learned-rules-into-repository-rules/171018)), which suggests learned rules live only in the dashboard today (inference).

Fixes: "Bugbot Autofix automatically spawns a Cloud Agent to fix bugs found during PR reviews." Pricing: "Bugbot uses usage-based billing" with reviews that "bill additional reviews through on-demand spend." ([Bugbot docs](https://cursor.com/docs/bugbot))

### Sourcery

Configuration: dashboard "Review rules" tab. "Describe what Sourcery should check in the **Rule** field, which takes up to 3,000 characters of free-form text." Path scope: "Add one or more globs under **Path patterns**, such as `src/api/**`. The rule applies only to files that match." "A rule only looks at the lines the pull request changes." ([Write review rules](https://docs.sourcery.ai/reviews/review-rules/))

What it learns: the anatomy page says "Reviews adapt to your team. The parts are the same on every review, but the comments themselves change as your team reacts to them and as you add review rules." ([Anatomy of a review](https://docs.sourcery.ai/reviews/anatomy-of-a-review/)). Search snippets attribute to Sourcery docs that "Where many similar past comments were marked unhelpful, Sourcery suppresses similar new ones" and "It's a gradual signal"; I could not find those sentences on the fetched page, so **unverified**. No visibility or editing of learned preferences is documented.

Pricing (vendor page): "Open Source" "Free"; "Pro" "$12 / developer / month" (annual) or "$15 / developer / month" (monthly); "Team" "$24 / developer / month" (annual) or "$30 / developer / month" (monthly); "Enterprise" "Custom". ([pricing](https://www.sourcery.ai/pricing))

### Ellipsis

Status: the current homepage describes a general agent platform, "Define agents in YAML and invoke through API. You choose the harness and model, while we handle the environments, permissions, budgets, and logging." ([ellipsis.dev](https://www.ellipsis.dev/)), and its pricing page does not present code review as a product ([pricing](https://www.ellipsis.dev/pricing)). Earlier code review features (thumbs-based adaptation, plain-language style guides) appear only in third-party pages; **unverified** and possibly discontinued. Pricing (vendor page): Individual "FREE with a Claude Code or Codex subscription"; Managed SaaS "Tokens + 10%".

### Bito (AI Code Review Agent)

What it learns: "When you **provide negative feedback on Bito-reported issues in pull requests**, the Agent automatically adapts by creating **custom code review rules**." Activation: "By default, newly generated custom code review rules are disabled. Once negative feedback for a specific rule reaches a threshold of 3, the rule is automatically enabled." Control: "You can also manually enable or disable these rules at any time using the toggle button in the **Status** column." Visibility: rules "are displayed on the **Learned Rules** dashboard in Bito Cloud." Static config via a `.bito.yaml` file. ([custom review rules](https://docs.bito.ai/ai-code-reviews-in-git/implementing-custom-code-review-rules))

Pricing (vendor page, as extracted): "Team" "$12 $15 monthly per seat" and "Professional" "$20 $25 monthly per seat" (the paired figures appear to be annual versus monthly), each "5K lines/seat/month included, $5 per 1K after"; "Enterprise" "Custom". ([pricing](https://bito.ai/pricing/))

### Gemini Code Assist (GitHub app)

Configuration: a `config.yaml` in the repo's `.gemini/` folder, and "Gemini Code Assist also supports adding a styleguide.md file to the .gemini/ folder, which instructs Gemini Code Assist with some specific rules that you want it to follow when performing a code review." The severity threshold "sets the minimum severity for which Gemini Code Assist posts comments." ([customize repo review](https://docs.cloud.google.com/gemini/docs/code-review/customize-repo-review))

What it learns: "Gemini Code Assist on GitHub now supports persistent memory, which stores your previous interactions with Gemini Code Assist on GitHub so that it has context during your future interactions." (Preview, 2025-11-10; [release notes](https://docs.cloud.google.com/gemini/docs/codeassist/release-notes)). The config docs mention only "memory_config: This field is applicable if you have previously enabled improved response quality for multiple repositories." No documentation found on viewing, editing, provenance, or expiry of memories.

Interaction: "Prompting Gemini Code Assist by adding the `/gemini` tag to your comments to ask questions in the context of the pull request." ([review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code))

Pricing: the enterprise docs cite a quota of "100+ pull requests per day"; I could not extract a price from a vendor page. **Unverified.**

### Amazon Q Developer (GitHub code review)

What it does: "When you create a new pull request or reopen a closed pull request, Amazon Q Developer automatically performs a code review and provides feedback on code quality, potential issues, and high-severity findings." "Automatic code reviews are not triggered by subsequent commits made within an existing pull request." Rules: "defining custom coding standards in simple Markdown files in the `project-root/.amazonq/rules` directory." Interaction: "`/q` followed by your question (for example, "`/q explain the importance of this finding`")". Status: "Amazon Q Developer for GitHub is in preview release and is subject to change." ([GitHub code reviews](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-code-reviews.html)). No learning from feedback is documented.

Pricing and lifecycle: "You can have Amazon Q Developer perform a code review for a limited amount of lines per month." (same page). AWS has announced end of support for Q Developer IDE plugins and paid subscriptions and points users to Kiro ([end-of-support announcement](https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/)); the specific dates in search snippets (new signups closed 2026-05-15, end of support 2027-04-30) were not re-read on the vendor page, so treat as **unverified**.

### Devin Review

What it does: "Devin Review is a full-service code review platform within the Devin webapp that turns large, complex PRs into intuitively organized diffs and precise explanations." "The Bug Catcher automatically analyzes your PR for potential issues and displays findings in the Analysis sidebar", including "**Flags** — Informational code annotations that may or may not require action." Auto-review modes: "**Auto review** (default)", "**On PR creation**", "**Manual**". Configuration: respects `REVIEW.md`, `AGENTS.md` and similar files, and "You can configure additional files to be ingested as review context from Settings > Review." Chat: "**Codebase-aware chat** — Ask questions about the PR and get answers with relevant context from the rest of the codebase." ([Devin Review](https://docs.devin.ai/work-with-devin/devin-review)). The page does not describe learning from review feedback.

Pricing (vendor page): "Free" "$0"; "Pro" "$20per month"; "Max" "$200per month"; "Teams" "$80/month for team plan + $40/mo per full dev seat"; "Enterprise" "Let's talk". Whether Devin Review is included per plan is not stated there. ([pricing](https://devin.ai/pricing))

## Synthesis

### What these tools already do well, so Soup.net should not rebuild it

- Issue: line-level defect finding, PR summaries, suggested fixes, autofix agents, and in-PR chat are commoditized and priced per seat or per review by vendors with codebase indexing. Better approach: the Soup.net sweep agent reads their output (bot review comments on the PR) as input, and spends its own effort only on the taste-and-judgment calls those comments raise or skip. Benefit: no race against funded vendors on bug recall, and teams keep the reviewer they already chose, which honors "helpers, not another workflow".
- Issue: static repo instruction files are converging (`AGENTS.md`, `REVIEW.md`, `CLAUDE.md` read across vendors). Better approach: treat those files as an export target for confirmed recipes (for example, a generated section listing confirmed team judgments with links back to their recipes), not as something Soup.net replaces. Benefit: every reviewer the team runs, including ones Soup.net never integrates with, inherits the confirmed judgment.

### Where the judgment memory layer is weak

- Reason capture is thin. Thumbs-driven systems (Greptile, Sourcery, Bito, parts of Bugbot and Graphite) keep a scalar, and CodeRabbit's own post names the problem: a scalar says "_something went well_, but not _what went well_". The operator's prior recipe on review queues prefers structured reason codes over free text so rejections become data (Soup.net recipe 20640ed5). Soup.net recipes keep role, goal, claim, reason, and verbatim evidence.
- Provenance is partial. Best cases are Qodo (link to source PR) and Copilot Memory (code citations re-validated). None stores who confirmed the judgment, in what context, and the verbatim words, which is what the operator asks of automated review: "observable, understandable and verifiable by the humans and other agents who read it" (Soup.net recipe 0960a183).
- Activation is silent. Qodo's new default auto-activates mined rules, Bito auto-enables at 3 downvotes, Bugbot promotes candidates on signal, Greptile blocks by embedding similarity. People on the team are not asked whether the inferred rule reflects their taste and judgment, and a dissenter's downvotes can become team policy.
- Scope and conflict handling are coarse. Scopes are repo, org, or path globs; conflict handling is precedence ("Path instructions precede learnings") or near-duplicate skipping. Nothing models that two people on the team disagree, or that a judgment was superseded with a new reason. Soup.net's append-only log with dated, authored recipes and newest-wins synthesis is a closer fit.
- Memory is siloed. Copilot Memory is same-repository only; every vendor's learnings live in its own dashboard. Nothing carries a team's judgment across tools, repos, or into non-review work (design docs, agent sessions). Soup.net recipe books already span these.
- Lifecycle is mostly absent. Only Copilot Memory expires (28 days unused) and re-validates. Others keep learnings until someone deletes them.

### Does any tool ask humans clarifying questions about preferences?

- Not in the documentation I read. The closest patterns are: Qodo's "Rules > Suggestions" queue (an admin approves mined rules, now off by default for new organizations), Bito's disabled-until-threshold learned rules with a manual toggle, Bugbot's dashboard of candidate and active rules, and CodeRabbit capturing a learning when a human replies in natural language. In every case the human reviews a rule the system already inferred, in a vendor dashboard, rather than being asked a question in their own channel. Chat features are human-initiated.
- Implication for the plan: the draft recipe (a question about the human's taste and judgment, answered through the person's own agent or a review queue, with select-one options) is a genuine gap in this market rather than a reinvention. The risk the vendors avoided by staying silent is interruption cost; the plan should keep the questions few and batched, which fits "helpers, not another workflow".

## Soup.net use

- Intent: `int_AUi9eufJHOoMGv2hN0kkdiIH` (registered by get_briefing). A second intent `int_UXNT29tUMBN9BZJ0QBYSoQWY` was registered unintentionally by the first search carrying intent text; later calls used the first id.
- Search `55853510-00b1-41ff-a9d0-113eefcdaa25` ("author:anyone AI PR review helpers, CodeRabbit, reviewer learnings, draft PR review"): surfaced 985afff8 (draft-PR review flow), 0960a183 (automated review must be observable and verifiable), 20640ed5 (structured rejection reason codes); get_recipes on 97fa42eb (post only hand-verified review comments, verification beside each comment). No recipe names a hosted reviewer vendor. Feedback row `74e10ff5-d0bf-427d-94bf-d5cfa0caf9a8`.
- Search `004e2f8d-c4ed-44bb-afda-fc5a960fb176` ("author:anyone automated reviewer learnings memory team preferences feedback thumbs dismissed comments"): surfaced 63a4bd60 (log reviewer process, not only outcome) and e32a4425 (group collaborators converging on shared taste and judgment); no recipe on reviewer-bot feedback signals. Feedback row `b1b4f224-6f99-450f-a70c-1a800045744c`.
- Checks: none. The research produced findings, not judgments of the operator's; the judgment calls below are escalated to the planning agent.
