# AI agent memory systems sweep (2025 to September 2026)

Status: research input for the [organization accounts program](../org-accounts-program.md) §4.6. Not a decision. Companion in style to [research-foundations.md](../../architecture/research-foundations.md): every factual statement in §2 is a verbatim quote with a link. All sources were accessed on 2026-09-19. Where a page shows its own date, that date is given. Quotes were machine-checked as substrings of the fetched source on the access date, except where §7 says otherwise.

---

## 1. Question

What have AI agent memory systems shipped or published between roughly January 2025 and September 2026, and what should Soup.net's organization features take from them or deliberately leave behind? The organization features in view are org-scoped recipe books, admin oversight that stays out of private books, backfilling decisions from repository history on behalf of employees, and autonomous PR-review agents that consume the corpus read-only.

Seven questions were put to each system: (a) what is stored and who or what writes it; (b) the multi-tenant, team, or org permission model; (c) provenance and attribution; (d) human oversight and correction of writes; (e) temporal validity and contradiction handling, the analog of `decided_at` plus supersession; (f) how autonomous or unattended agents use it; (g) cross-vendor portability.

---

## 2. Findings

Findings are numbered M1, M2, and so on, so that §3 to §5 can point back to them. Each bullet is a quote and its source. Text outside quotation marks in this section is limited to naming the system and the question the quote answers.

### 2.1 Developer memory layers (the "memory as an API" products)

**M1. Mem0** (paper submitted 28 April 2025; docs undated).

- (a) What is written, and by what: "Mem0 sends the messages through an LLM that pulls out key facts, decisions, or preferences to remember." ([Mem0 docs, Add memory](https://docs.mem0.ai/core-concepts/memory-operations/add))
- (e) Contradictions, as described in the paper: "The LLM itself determines which of four distinct operations to execute: ADD for creation of new memories when no semantically equivalent memory exists; UPDATE for augmentation of existing memories with complementary information; DELETE for removal of memories contradicted by new information; and NOOP when the candidate fact requires no modification to the knowledge base." ([arXiv 2504.19413, HTML](https://arxiv.org/html/2504.19413))
- (e) Contradictions in the graph variant: "An LLM-based update resolver determines if certain relationships should be obsolete, marking them as invalid rather than physically removing them to enable temporal reasoning." ([arXiv 2504.19413, HTML](https://arxiv.org/html/2504.19413))
- (e) The current docs describe the add path differently from the paper, under the step title "Additive storage": "New memories are added without overwriting or deleting existing memories." ([Mem0 docs, Add memory](https://docs.mem0.ai/core-concepts/memory-operations/add))
- (e) Expiry is a caller-supplied field: "Optional `YYYY-MM-DD` date after which the memory is treated as expired." ([Mem0 docs, Add memory](https://docs.mem0.ai/core-concepts/memory-operations/add))
- (b) Scoping identifiers: "`user_id`, `agent_id`, `app_id`, or `run_id` that scope the memory for future searches." ([Mem0 docs, Add memory](https://docs.mem0.ai/core-concepts/memory-operations/add))
- (b) Org model: "Organizations and projects provide multi-tenant support, access control, and team collaboration capabilities for Mem0 Platform." Roles are two: READER, "Can view and search memories, but cannot modify project settings or manage members", and OWNER. "Only members can access memories and data within their organization/project scope". ([Mem0 docs, Organizations & Projects](https://docs.mem0.ai/api-reference/organizations-projects))

**M2. Zep and Graphiti** (paper submitted 20 January 2025).

- (a) What it is: "a temporally-aware knowledge graph engine that dynamically synthesizes both unstructured conversational data and structured business data while maintaining historical relationships." ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956))
- (e) Bi-temporal validity. Zep's docs define four timestamps by example: `created_at` is "The time Zep learned that the user got married", `valid_at` is "The time the user got married", `invalid_at` is "The time the user got divorced", and `expired_at` is "The time Zep learned that the user got divorced". ([Zep docs, Facts](https://help.getzep.com/facts))
- (e) Supersession without deletion: "Each fact in a context graph has a validity window: when it became true, and when (if ever) it was superseded." and "When information changes, old facts are invalidated — not deleted." ([Graphiti README](https://github.com/getzep/graphiti))
- (c) Provenance: "Every entity and relationship traces back to the episodes (raw data) that produced it. Full lineage from derived fact to source." ([Graphiti README](https://github.com/getzep/graphiti))
- (b) Two separate permission systems, one for humans and one for agents: "Grant dashboard permissions with account- and project-scoped roles (RBAC)." and "Limit which actions and context each agent and Memory MCP user can reach with ABAC policies attached to API keys and UserGroups." ([Zep docs, Governance](https://help.getzep.com/governance))
- (b) Group as a security subject, not a container: "A UserGroup is a security grouping, not a data container". Policy sets attach to it so that "every user in the group inherits its grants". ([Zep docs, UserGroup access](https://help.getzep.com/usergroup-access))
- (d) Audit covers dashboard humans: "Track dashboard member actions including logins, member management, API key changes, and data operations." ([Zep docs, Governance](https://help.getzep.com/governance))

**M3. Letta (formerly MemGPT)**.

- (a) and (b) Shared, optionally read-only blocks: "Memory blocks are read-write by default (so the agent can update the block using memory tools), but can be set to read-only by setting the `read_only` field to `true`." and "If multiple agents are attached to a block, they will all have the block data in their context windows." ([Letta docs, Memory blocks](https://docs.letta.com/guides/agents/memory-blocks))
- (f) Background consolidation, now called dreaming: "Dreaming uses background subagents to review recent conversations, consolidate useful lessons, and update memory without interrupting your active work." It runs "after a set number of completed agent steps or when the context window is compacted." ([Letta docs, sleep-time page](https://docs.letta.com/guides/agents/architectures/sleeptime))
- (f) The research behind it (submitted 17 April 2025): sleep-time compute "allows models to "think" offline about contexts before queries are presented". ([arXiv 2504.13171](https://arxiv.org/abs/2504.13171))
- (c) and (d) Git as the provenance layer (post dated 12 February 2026): "Every change to memory is automatically versioned with informative commit messages." and "By giving each subagent an isolated worktree, multiple subagents can process and write to memory concurrently, then merge their changes back through git-based conflict resolution." ([Letta blog, Context Repositories](https://www.letta.com/blog/context-repositories/))

**M4. LangMem (LangChain)**.

- (a) Two write paths. In the hot path: "This active memory formation happens during the conversation, enabling immediate updates when critical context emerges." In the background, memory formation "refers to the technique of prompting an LLM to reflect on a conversation after it occurs (or after it has been inactive for some period)". ([LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/))
- (e) Contradictions: "The system must reconcile new information with previous beliefs, either deleting/invalidating or updating/consolidating existing memories." ([LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/))
- (b) Scoping: "Multi-Level Namespaces: Group memories by organization, user, application, or any other hierarchical structure." ([LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/))

**M5. Supermemory**.

- (b) Scoping: "A container can be anything - a user, a project, team, organization, etc." The stated purpose is to "isolate each user or workspace so one customer's memory never leaks into another's." ([Supermemory docs, intro](https://supermemory.ai/docs/intro))
- (e) Contradictions: "'I love Adidas' then 'switching to Puma' should not leave both preferences equally true". ([Supermemory docs, intro](https://supermemory.ai/docs/intro))

**M6. Cognee**.

- (a) "Cognee is a free open-source AI memory platform that gives AI agents persistent long-term memory across sessions." It supports structuring memory "with custom data models and ontologies." ([Cognee README](https://github.com/topoteretes/cognee))

### 2.2 Research architectures

**M7. A-MEM** (submitted 17 February 2025). Memories rewrite older memories: "as new memories are integrated, they can trigger updates to the contextual representations and attributes of existing historical memories". ([arXiv 2502.12110](https://arxiv.org/abs/2502.12110))

**M8. Memory-R1** (submitted 27 August 2025). A learned policy decides what to overwrite: "a Memory Manager that learns structured operations, including ADD, UPDATE, DELETE, and NOOP". ([arXiv 2508.19828](https://arxiv.org/abs/2508.19828))

**M9. MemOS** (submitted 4 July 2025). Provenance as first-class metadata: "As the basic unit, a MemCube encapsulates both memory content and metadata such as provenance and versioning." ([arXiv 2507.03724](https://arxiv.org/abs/2507.03724))

**M10. MIRIX** (submitted 10 July 2025). "six distinct, carefully structured memory types: Core, Episodic, Semantic, Procedural, Resource Memory, and Knowledge Vault". ([arXiv 2507.07957](https://arxiv.org/abs/2507.07957))

**M11. HippoRAG 2** (submitted 20 February 2025). A retrieval method, not a governance model: "HippoRAG 2 builds upon the Personalized PageRank algorithm used in HippoRAG and enhances it with deeper passage integration and more effective online use of an LLM." ([arXiv 2502.14802](https://arxiv.org/abs/2502.14802))

**M12. Eywa** (submitted 29 May 2026). The closest published architecture to Soup.net's evidence-first, zero-LLM-server stance: "Existing memory systems often collapse source evidence, extracted facts, retrieved context, and answer policy into one opaque prompt path", and in response "Eywa stores immutable source evidence before deriving canonical facts, validates extracted memories against typed signals and source support, and retrieves bounded memory context through a deterministic multi-route read path with zero LLM calls inside retrieval." ([arXiv 2605.30771](https://arxiv.org/abs/2605.30771))

### 2.3 Vendor memory features

**M13. GitHub Copilot Memory** (engineering post dated 15 January 2026). This is the nearest vendor analog to the customer's PR-review use case.

- (a) What is stored and which agents use it: "Copilot Memory helps Copilot become more effective over time by remembering facts about your repositories and your personal coding preferences." and "Copilot Memory is currently used by Copilot cloud agent, Copilot code review, and Copilot CLI." ([GitHub Docs, About Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- (c) Evidence on every memory: "Repository-level facts are stored with citations pointing to the code that supports them. When Copilot finds a fact relevant to its current work, it checks those citations against the current branch to confirm the information is still accurate." ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- (e) Contradiction handling is read-time verification plus rewrite: "If the code contradicts the memory, or if the citations are invalid (e.g. point to nonexistent locations), the agent is encouraged to store a corrected version of the memory reflecting the new evidence." ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/))
- (e) Decay: "any stored fact or preference that goes unused is automatically deleted after 28 days." ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- (b) Permissions follow the repository: "Memories for a given repository can only be created in response to actions taken within that repository by contributors with write permissions, and can only be used in tasks on that same repository initiated by users with read permissions." ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/))
- (b) Org control is an enablement policy: "For enterprise- and organization-managed plans, an administrator must enable the policy first, and then individual users can opt out." ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- (d) Oversight: "Repository owners can review and manually delete the repository-level facts stored for their repository." and "Users can view and delete their own user-level preferences regardless of their Copilot plan." ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))
- (f) Reported effect in unattended use: "7% increase in pull request merge rates (90% with memories vs. 83% without)" for the coding agent and "2% increase in positive feedback on comments (77% with memories vs 75% without)" for code review. These are GitHub's own numbers. ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/))
- (g) Portability: scope is a single repository on GitHub: "facts can only be used in operations on the same repository." ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory))

**M14. Claude Managed Agents memory stores** (beta header `agent-memory-2026-07-22`). This is the nearest vendor analog to a no-deposit principal and to audited agent writes.

- (a) and (b): "A **memory store** is a workspace-scoped collection of text documents optimized for Claude." ([Claude Platform docs, Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory))
- (f) Read-only attachment for agents that should not write: "You can configure `access` as well. It defaults to `read_write` (shown explicitly in the following example), but `read_only` is also supported." and "`access` is enforced at the filesystem level: a `read_only` mount rejects writes, while writes to a `read_write` mount produce memory versions attributed to the session." ([Claude Platform docs](https://platform.claude.com/docs/en/managed-agents/memory))
- (f) The vendor's own warning about unattended writers: "If the agent processes untrusted input (user-supplied prompts, fetched web content, or third-party tool output), a successful prompt injection could write malicious content into the store. Later sessions then read that content as trusted memory. Use `read_only` for reference material, shared lookups, and any store the agent does not need to modify." ([Claude Platform docs](https://platform.claude.com/docs/en/managed-agents/memory))
- (c) and (d) Audit trail: "Every mutation to a memory creates an immutable **memory version** (`memver_...`). Use the version endpoints to audit who changed what and when, to inspect or restore a prior snapshot, and to scrub sensitive content out of history with redact." ([Claude Platform docs](https://platform.claude.com/docs/en/managed-agents/memory))
- (d) Redaction that keeps the trail: "Redact scrubs content out of a historical version while preserving the audit trail (who did what, when). Use it for compliance workflows such as removing leaked secrets, PII, or user deletion requests." ([Claude Platform docs](https://platform.claude.com/docs/en/managed-agents/memory))
- (d) Retention limit on that trail: "Versions are retained for 30 days after they are written; however, the recent versions of a live memory are always kept regardless of age". ([Claude Platform docs](https://platform.claude.com/docs/en/managed-agents/memory))
- (e) Consolidation that never edits in place (research preview): "A dream reads an existing memory store alongside past session transcripts, then produces a new, reorganized memory store: duplicates merged, stale or contradicted entries replaced with the latest value, and new insights surfaced." and "The input store is never modified, so you can review the output and discard it if you don't like the result." ([Claude Platform docs, Dreams](https://platform.claude.com/docs/en/managed-agents/dreams))

**M15. Claude API memory tool** (tool type `memory_20250818`). (g) Storage is the integrator's: "The memory tool operates client-side: Claude requests file operations, and your application executes them. You control where and how the data is stored through your own infrastructure." ([Claude Platform docs, Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool))

**M16. Claude Code: CLAUDE.md, auto memory, skills**.

- (a) Two writers: CLAUDE.md files are "instructions you write to give Claude persistent context" and auto memory is "notes Claude writes itself based on your corrections and preferences". ([Claude Code docs, memory](https://code.claude.com/docs/en/memory))
- (b) The org tier is a file pushed by IT. The managed policy scope is "Organization-wide instructions managed by IT/DevOps", shared with "All users in organization", and "Managed policy CLAUDE.md files cannot be excluded." Project instructions are shared with "Team members via source control". ([Claude Code docs, memory](https://code.claude.com/docs/en/memory))
- (b) What the agent writes itself is not shared: "Auto memory is machine-local. All worktrees and subdirectories within the same git repository share one auto memory directory. Files are not shared across machines or cloud environments." ([Claude Code docs, memory](https://code.claude.com/docs/en/memory))
- (d) "Auto memory files are plain markdown you can edit or delete at any time." ([Claude Code docs, memory](https://code.claude.com/docs/en/memory))
- (b) Skills distribute the same way: "Save it under your home directory to get it in every project, commit it to a repository to share it with everyone who works there, or distribute it through a plugin or managed settings to reach a whole team." ([Claude Code docs, skills](https://code.claude.com/docs/en/skills))

**M17. Claude apps memory** (post dated 11 September 2025, updated 23 October 2025).

- (b) "If you use projects, Claude creates a separate memory for each project." ([Claude blog, Bringing memory to teams](https://claude.com/blog/memory))
- (d) "Claude uses a memory summary to capture all its memories in one place for you to view and edit." ([Claude blog](https://claude.com/blog/memory))
- (b) Admin control is on or off: "Enterprise admins can choose whether to disable memory for their organization at any time." ([Claude blog](https://claude.com/blog/memory))
- (g) Portability is copy and paste: "You can bring your memory over from other AI providers using Claude's built-in import flow." with the caveat "Memory imports are experimental and still in active development, and at this stage, Claude may not always successfully incorporate imported memories." ([Claude Help Center](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude))

**M18. Microsoft 365 Copilot memory** (page dated 2 September 2026; feature in preview). This is the clearest published example of the admin-visibility model that the program doc proposes not to build.

- (b) Admins can read members' memories: "Admins can search their users' memory in Microsoft Copilot via Microsoft Purview eDiscovery or Content Search." and "Admins can use eDiscovery and Microsoft Graph Explorer to search, export, and delete users' memory data." ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory))
- (c) Where it lives: "Memories, which include saved memories, details inferred from chat history and custom instructions, are stored in the user's Exchange mailbox in a hidden folder." ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory))
- (d) Gaps Microsoft states itself: "Memory and personalization actions don't generate audit log entries in Purview." and "No, admins can't restrict what type of information is added to Copilot memory." ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory))
- (e) Retention: "Retention policies and retention labels configured in Purview by organization admins don't apply to Copilot memory." ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory))

**M19. Devin Knowledge (Cognition)**. This is the nearest vendor analog to human approval of agent-proposed writes.

- (a) "Knowledge is a collection of tips, advice, and instructions that Devin can reference in all sessions." ([Devin docs, Knowledge](https://docs.devin.ai/product-guides/knowledge))
- (d) Agent proposes, human disposes: "Devin will automatically suggest Knowledge to remember based on your feedback in chat. Edit the suggested Knowledge before saving, or dismiss the Knowledge if it's not helpful." ([Devin docs, Knowledge](https://docs.devin.ai/product-guides/knowledge))
- (b) Org and enterprise tiers: "Knowledge items scoped to your current organization. These are visible to all members of the organization" and "Knowledge items that apply across all organizations in your enterprise. Only visible when you belong to an enterprise account." ([Devin docs, Knowledge](https://docs.devin.ai/product-guides/knowledge))
- (f) Retrieval is steered by a human-written hint: "Your Trigger Description will help Devin recall relevant Knowledge at the right times." ([Devin docs, Knowledge](https://docs.devin.ai/product-guides/knowledge))

**M20. Windsurf Cascade memories** (docs now served from `docs.devin.ai/desktop`).

- (b) "Cascade's autogenerated memories are associated with the workspace they were created in and are stored locally in `~/.codeium/windsurf/memories/`." and "Memories generated in one workspace are not available in another, and they are not committed to your repository." ([Devin Desktop docs, Memories & Rules](https://docs.devin.ai/desktop/cascade/memories))
- (b) The org tier is admin-deployed rule files that "cannot be modified by end users without administrator permissions". ([Devin Desktop docs](https://docs.devin.ai/desktop/cascade/memories))

**M21. Cursor rules**. (b) "Team administrators can create and manage rules directly from the Cursor dashboard." With enforcement on, "the rule is required for all team members and cannot be disabled in Customize." Precedence: "Rules are applied in this order: **Team Rules → Project Rules → User Rules**." ([Cursor docs, Rules](https://cursor.com/docs/context/rules))

**M22. OpenAI Codex memories** (preview).

- (a) "After you enable memories, Codex can turn useful context from eligible prior chats into local memory files. Codex skips active or short-lived sessions, redacts secrets from generated memory fields, and updates memories in the background instead of immediately at the end of every chat." ([ChatGPT Learn, Memories](https://learn.chatgpt.com/docs/customization/memories?surface=app))
- (b) The vendor's own guidance sends team knowledge elsewhere: "Keep required team guidance in `AGENTS.md` or checked-in documentation. Treat memories as a helpful recall layer, not as the only source for rules that must always apply." ([ChatGPT Learn, Memories](https://learn.chatgpt.com/docs/customization/memories?surface=app))

**M23. Gemini Apps personalization**. (b) Not offered to managed accounts: "To use these features, you must sign in to Gemini Apps with a personal Google Account. These features are not available while signed in to a work, school, or supervised account." ([Gemini Apps Help](https://support.google.com/gemini/answer/15637730?hl=en))

### 2.4 Products that name "team memory" as the product

**M24. RoBrain** (Apache 2.0, open source). Already identified in the 2026-07-12 landscape scan; re-verified here. Its README headline has changed since that scan and now reads "Shared memory across your team and your AI agents — with judgment!" ([RoBrain README](https://github.com/adelinamart/robrain))

- (a) Decisions, captured passively: "RoBrain records what your team and its agents decide — and the alternatives they ruled out — without anyone tagging anything by hand. Sensing captures session turns; Perception extracts each decision into Postgres, where every row can carry a structured `rejected[]` field." ([RoBrain README](https://github.com/adelinamart/robrain))
- (e) Server-side contradiction scanning: "Most agent-memory tools stop at capture: they store what happened and hope you query it later. RoBrain adds judgment. Batch **Synthesis** reads the whole corpus to flag contradictions, stance drift, and recurring entities that no single session could see." ([RoBrain README](https://github.com/adelinamart/robrain))
- (c), (d), (b): the README lists "Provenance on every memory", a human review command `npx robrain review`, and a cloud tier with "orgs, API keys, roles, scoped isolation". ([RoBrain README](https://github.com/adelinamart/robrain))

**M25. TencentDB Agent Memory, Team Memory release** (press release dated 13 August 2026).

- (a) "The new release turns a team's conversations, documents, code, and institutional knowledge into shared memory assets that any agent can draw on." ([PR Newswire](https://www.prnewswire.com/apac/news-releases/tencentdb-agent-memory-tops-20-000-github-stars-in-90-days-launches-team-memory-for-multi-agent-collaboration-302850576.html))
- (b), (c): "Each memory item supports management of its owner, version, status, and usage history, and permissions can be configured by user, role, and agent." ([PR Newswire](https://www.prnewswire.com/apac/news-releases/tencentdb-agent-memory-tops-20-000-github-stars-in-90-days-launches-team-memory-for-multi-agent-collaboration-302850576.html))
- (d) Review before sharing: "A troubleshooting skill created by one developer can be reviewed and then shared with other team members and agents." ([PR Newswire](https://www.prnewswire.com/apac/news-releases/tencentdb-agent-memory-tops-20-000-github-stars-in-90-days-launches-team-memory-for-multi-agent-collaboration-302850576.html))

### 2.5 Benchmarks, and how far to trust them

**M26. What the two standard benchmarks measure.** LoCoMo (submitted 27 February 2024) is "a dataset of very long-term conversations, each encompassing 300 turns and 9K tokens on avg., over up to 35 sessions." ([arXiv 2402.17753](https://arxiv.org/abs/2402.17753)) LongMemEval (submitted 14 October 2024) evaluates "five core long-term memory abilities of chat assistants: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention." ([arXiv 2410.10813](https://arxiv.org/abs/2410.10813)) Both are single-user chat recall. Neither has a second user, a permission boundary, or an attribution question.

**M27. Newer benchmarks keep the single-principal shape.** MemoryAgentBench (submitted 7 July 2025) names "four core competencies essential for memory agents: accurate retrieval, test-time learning, long-range understanding, and selective forgetting." ([arXiv 2507.05257](https://arxiv.org/abs/2507.05257)) BEAM (submitted 31 October 2025) is "a new benchmark comprising 100 conversations and 2,000 validated questions." ([arXiv 2510.27246](https://arxiv.org/abs/2510.27246)) LongMemEval-V2 (submitted 12 May 2026) moves from chat to agent experience, covering "static state recall, dynamic state tracking, workflow knowledge, environment gotchas, and premise awareness", with the stated aim of helping "agents acquire the experience needed to become knowledgeable colleagues in customized environments." ([arXiv 2605.12493](https://arxiv.org/abs/2605.12493)) PERMA, which this repo already reports against, is covered in [docs/benchmarks/perma.md](../../benchmarks/perma.md).

**M28. Vendor-run numbers are contested in public.** Mem0's CTO opened an issue on Zep's paper repository (8 May 2025) titled "Revisiting Zep’s 84% LoCoMo Claim: Corrected Evaluation & 58.44% Accuracy", stating "our analysis shows that Zep achieves 58.44 % accuracy—not the 84 % reported." ([getzep/zep-papers issue 5](https://github.com/getzep/zep-papers/issues/5)) Zep's reply post (published 6 May 2025, later amended) itself carries a correction: "In an earlier version of this article, we erred in how we calculated Zep's LoCoMo score. We've updated the article to reflect Zep's corrected result is 75.14% +/- 0.17". ([Zep blog](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/))

**M29. A controlled study finds the architecture is often not what is being measured.** MemDelta (submitted 29 June 2026): "reported gains often mix changes in the memory method with changes in the language model, embedding model, or retrieval pipeline, making it unclear what is actually being measured." Among its findings: "swapping only the embedding model in an identical pipeline shifts accuracy by +6.2pp at n = 500 (p = 0.004)" and "agent self-memory (42%) underperforms basic retrieval (47%)". Its recommendation: "memory evaluations fix embedding models across comparisons, stratify by model family, and report write-path cost before attributing gains to architecture." ([arXiv 2606.29914](https://arxiv.org/abs/2606.29914))

### 2.6 Security of shared, agent-written memory

**M30. Memory injection needs no write access.** MINJA (submitted 5 March 2025): "The attacker injects malicious records into the memory bank by only interacting with the agent via queries and output observations." The authors conclude that it "enables any user to influence agent memory, highlighting the risk." ([arXiv 2503.03704](https://arxiv.org/abs/2503.03704)) Two vendors build their designs around the same threat: see the Claude Managed Agents warning in M14, and GitHub's test method, "we deliberately seeded repositories with adversarial memories–facts that contradicted the codebase–with citations pointing to irrelevant or nonexistent code locations." ([GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/))

### 2.7 Cross-vendor portability

**M31. The portable thing today is a static instruction file, not a memory.** AGENTS.md is "A simple, open format for guiding coding agents", and "AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation." ([agents.md](https://agents.md/)) Codex's guidance (M22) and Windsurf's docs point the same way; Windsurf tells users that for durable, shareable knowledge they should "ask Cascade to write it to a Rule" or to "your repo's `AGENTS.md` instead." ([Devin Desktop docs](https://docs.devin.ai/desktop/cascade/memories)) Memory-layer products reach multiple agents through MCP; Graphiti's README describes its MCP server as one that "allows AI assistants to interact with Graphiti's context graph capabilities through the MCP protocol." ([Graphiti README](https://github.com/getzep/graphiti))

### 2.8 Index of findings by question

This table is a navigation aid. It contains no new facts; each cell points to the finding that carries the quote.

| Question | Strongest examples found |
|---|---|
| (a) LLM extractor writes, from transcripts | M1, M4, M22, M24 |
| (a) Human writes, agent reads | M16 (CLAUDE.md), M21, M31 |
| (a) Agent proposes, human approves | M19, M25 |
| (b) Org tier is on/off or a pushed file | M13, M16, M17, M20, M21 |
| (b) Org tier has roles over shared memory | M1, M2, M14, M19, M24, M25 |
| (b) Admin can read members' memories | M18 |
| (c) Evidence attached to each memory | M2 (episodes), M12, M13 (code citations), M24 |
| (c) Write attributed to a principal | M3 (git), M14 (session), M25 (owner) |
| (d) Human review surface | M13, M14, M16, M17, M19, M24 |
| (e) Bi-temporal validity | M2 |
| (e) LLM overwrites or deletes on contradiction | M1 (paper), M4, M7, M8 |
| (e) Read-time verification against evidence | M13 |
| (e) Consolidate into a copy, never in place | M14 (dreams) |
| (f) Read-only principal | M3, M14 |
| (f) Unattended writer, with injection warning | M14, M30 |
| (g) Cross-vendor | M15, M31; MCP servers in M2, M24 |

---

## 3. What this means for Soup.net (interpretation)

Everything in this section is the author's reading of §2, measured against the operator's existing rulings. It is not sourced fact.

**3.1 The field stores facts and rewrites them. Soup.net stores authored judgment and appends.** Almost every system in §2.1 and §2.2 has an LLM decide, at write time, what the truth now is: UPDATE and DELETE in M1 and M8, memory evolution in M7, reconcile-or-invalidate in M4. That is coherent for facts about one user ("prefers Puma"). It does not carry over to an organization, where two engineers holding different positions is information, not a conflict to resolve. Soup.net's append-only rule (design-thinking.md principle 8; recipe `4b97ba86`) and its "system doesn't make judgments" principle already sit on the right side of this. The sweep found no system that treats disagreement between named humans as a first-class, preserved state. That is differentiated ground.

**3.2 Zep's bi-temporal model is the rigorous version of `decided_at`.** Soup.net has two of Zep's four timestamps: `decided_at` corresponds to `valid_at` and `created_at` to `created_at` (M2). It has no `invalid_at` or `expired_at`, by design: supersession is a new recipe with its own reason, and the reader judges staleness from evidence. The briefing already explains why a bare flip does not separate in embedding space. For an org this gap will be felt more sharply than for a solo user, because a PR-review agent cannot ask the author whether a 2024 decision still stands, and the author may have left. This is the one place where the sweep suggests Soup.net's current model is thin rather than merely different.

**3.3 GitHub Copilot Memory is the direct competitor for the customer's headline use case, and it is structurally narrow.** It is already wired into Copilot code review (M13), it is free with the seat, and it carries citations. It is also scoped to one repository, to one vendor's agents, to facts that code can confirm, and it deletes what goes unused after 28 days. The customer runs a non-GitHub autonomous reviewer. A "why did we choose this" judgment cannot be verified against a branch and is often most valuable precisely when it has not been touched for a year. The honest framing, consistent with recipe `249d7dae`, is that Copilot Memory is good and that the gap is the walls around it, not its quality.

**3.4 The no-deposit principal now has vendor precedent.** Recipe `5295e40f` (2026-09-19) leans toward autonomous agents that search, declare intent, and log feedback but make no recipe checks. M14 ships the same shape (`read_only` attachment) with the vendor's own rationale: an unattended agent that processes untrusted input and can write to shared memory is a persistence vector for prompt injection. M30 supplies the research backing. A PR-review agent reads attacker-controllable text (PR descriptions, diffs, comments) by definition. This moves the no-deposit principal from a product preference to a security position that can be stated with citations.

**3.5 Feedback rows from an autonomous agent are still writes.** The program doc already notes this. In light of M14 and M30 it deserves a stated rule rather than a note: feedback text from a no-deposit principal should never be rendered back to other agents as trusted corpus content, or the read-only guarantee leaks through the feedback channel.

**3.6 Admin oversight: the market shows both extremes and nothing in between.** Most vendors give the org an on/off switch or a pushed file (M13, M16, M17, M20, M21). Microsoft gives admins full-text search, export, and delete over members' memories, with no audit log of memory actions (M18). The program doc's position, aggregates and admin-action events only, with no reading of private books and a member-visible log, is a third model that the sweep did not find shipped anywhere. It is defensible as a differentiator. It also needs the honest sentence the program doc already calls for, because under managed accounts the organization still has a path to the data.

**3.7 Backfill on behalf of employees has no precedent in this sweep.** No system found attributes a memory to a human who was not in the session. The closest mechanisms are attribution of the write to a session (M14), owner and version fields (M25), and git commits (M3). All of these record the depositor, not the person whose judgment it is. Soup.net's proposed split (author = decision-maker, depositor = admin's key, provenance label = AI backfill, `decided_at` = artifact date) is new. New means there is no borrowed pattern to lean on for the consent and right-to-disown questions in Q9.

**3.8 Portability remains the structural gap in the market.** What is portable across vendors today is a hand-written instruction file (M31). What agents learn for themselves stays on one machine (M16, M20, M22) or inside one vendor (M13, M17), and Gemini's version is not available to work accounts at all (M23). Claude's import path is pasted text marked experimental (M17). This confirms the design-thinking.md thesis rather than threatening it.

**3.9 Where the position is threatened.**

- Vendor-neutral memory layers (Mem0, Zep, Supermemory, Cognee, TencentDB) are independent of model vendors too, reach agents over MCP, and several already ship org roles. "Independent" alone does not separate Soup.net from them. "Human taste and judgment, with evidence, under human oversight" does, because those products store extracted facts.
- RoBrain (M24) overlaps on decisions, provenance, human review, team scope, MCP reach, and open source, and it adds two things Soup.net has ruled out or not built: passive capture with no agent authoring step, and server-side LLM synthesis that flags contradictions and stance drift. Per recipe `e657695c` the right response is to name it and keep Soup.net's claim modest. Its `rejected[]` field is a good idea stated plainly.
- Bundling. Copilot Memory costs the customer nothing extra and needs no setup. Soup.net has to be worth a second system.
- Benchmarks will not settle any of this. M26 to M29 show that the standard benchmarks have no second user and that published gains are frequently artifacts. docs/benchmarks.md already takes this stance.

---

## 4. Options with tradeoffs

**4.1 Temporal validity for org books.**

| Option | What it is | For | Against |
|---|---|---|---|
| A. Status quo | Supersession is a new recipe with a fresh reason; reader judges staleness | Append-only; zero server judgment; already built | An unattended reviewer cannot ask whether an old call still stands; departed authors cannot restate |
| B. Human-only "superseded by" link | A JWT-only action links an old recipe to the one that replaced it; both remain; search renders the link | Gives Zep's `invalid_at` signal (M2) without an LLM deciding; consistent with human-only corrections | New human chore; links will be sparse |
| C. Agent-proposed, human-confirmed link | An agent's check may name the recipe it believes it supersedes; the link shows as pending until a human confirms | Devin's propose-and-approve pattern (M19); cheap to author | A pending queue needs an owner in an org; adds state to the check path |
| D. Server-side LLM contradiction scan | RoBrain-style synthesis (M24) | Finds drift nobody flagged | Breaks "zero LLM on the server" and "system doesn't make judgments"; only thinkable as a premium, advisory, opt-in feature |

**4.2 Staleness signal for evidence.**

| Option | What it is | For | Against |
|---|---|---|---|
| A. None | As today | Simple | Reviewer agents get no hint that a cited file is gone |
| B. Client-side citation check | The briefing teaches consuming agents to verify a recipe's file or commit references against the current branch before relying on it, and to say so in feedback | Copilot's just-in-time verification (M13) with zero server cost; fits "agents do the reasoning" | Depends on agent diligence; only works for code-anchored evidence |
| C. Server-side reference liveness | Server re-fetches reference URLs and marks dead ones | Uniform | Server needs repo access, which principle 3 rules out |

**4.3 Autonomous-agent principal.**

| Option | What it is | For | Against |
|---|---|---|---|
| A. No-deposit capability on a key (program doc §4.3) | Intent, search, read, feedback; no checks | Matches M14's `read_only`; defensible against M30; already the operator's lean | Loses whatever the reviewer learns |
| B. Deposits into a quarantined book | Agent may check into a book no other key reads by default until a human promotes | Keeps the learning | Promotion queue; quarantine must be airtight |
| C. Full deposit rights | Same as a human's agent | Simplest | Contradicts the oversight premise; M14 and M30 argue directly against it |

**4.4 Admin visibility.**

| Option | What it is | For | Against |
|---|---|---|---|
| A. Aggregates only (program doc §3.6) | Counts, last activity, admin-action log visible to the member | Unshipped elsewhere, so a differentiator; aligns with privacy-narrow default | Some compliance buyers will expect eDiscovery |
| B. Microsoft-style discovery (M18) | Admin search, export, delete over member content | Meets legal-hold expectations | Chills candid deposits; Microsoft itself ships it without a memory audit log |
| C. A plus a logged, member-visible legal-export action | Break-glass export by an org owner, recorded and shown to the member | Covers the compliance case honestly | More to build and to explain |

---

## 5. Recommendation

Ideas worth borrowing, in rough priority order:

1. **Read-only principal, justified as security.** Take 4.3 A and cite M14 and M30 in the design doc and the ADR. State the feedback-channel rule from 3.5 alongside it.
2. **Attribute every write to a principal and keep that trail through redaction.** M14's version model (who, what, when, surviving redact) is the right bar for the backfill feature, where depositor and author differ. Soup.net's audit log already points this way; the org work should make depositor, author, and provenance label separately queryable.
3. **Just-in-time evidence verification, done by the consuming agent.** Take 4.2 B. It is a briefing change, goes through the briefing regression gate, and gives the PR-review packet a staleness signal without the server reaching into repositories.
4. **An explicit supersession link made or confirmed by a human.** Take 4.1 B first, with C as a follow-up once an org has someone to own the queue. This is the smallest honest answer to the gap in 3.2.
5. **Record rejected alternatives.** RoBrain's `rejected[]` (M24) names something reviewers need: "we already tried that and said no". In Soup.net this can be recipe-guide copy rather than schema, since a Toulmin rebuttal fits the existing evidence structure.
6. **Separate human permissions from agent permissions in the org model.** Zep's split (M2: roles for dashboard humans, policies on keys and groups for agents) matches Soup.net's JWT and API-key separation and supports capability flags on keys over a growing role enum.
7. **Consolidate into a copy, never in place.** If LLM-assisted cleanup of a book is ever offered, M14's dreams show the shape: output to a new store, original untouched, human reviews and switches over.

Ideas to deliberately not borrow:

8. **LLM-decided UPDATE and DELETE at write time** (M1, M4, M7, M8). It erases disagreement and history, and it puts a judgment on the server.
9. **Passive transcript capture** (M1, M22, M24, M25). It is the low-friction path and it is tempting for onboarding. It removes the authoring step where an agent forms a hypothesis about the human's taste and judgment and attaches evidence, and it fails principle 3.
10. **Usage-based expiry** (M13's 28 days). Judgment that nobody has needed for a year is often exactly what a reviewer needs.
11. **Admin full-text discovery as the default** (M18). Keep 4.4 A, and treat 4.4 C as the answer when a buyer requires it.

Positioning: keep the claim where recipe `e657695c` put it. Soup.net is differentiated by evidence-backed, human-attributed taste and judgment that crosses vendors and people. It is not the first or only shared team memory, and the doc set should name Copilot Memory, RoBrain, and the vendor-neutral memory layers as real alternatives.

---

## 6. Open questions for the operator

1. Does an org-scoped book get a human-only "superseded by" link (4.1 B), or does the reason-in-a-new-recipe rule stand unchanged for orgs?
2. Should feedback rows written by a no-deposit principal be excluded from anything rendered to other agents (3.5)? This affects where feedback shows up in check responses today.
3. Is a logged, member-visible legal-export action (4.4 C) in scope for the first org release, or is "aggregates only" the whole story until a buyer asks?
4. Backfill has no precedent found (3.7). Does that raise the bar for Q9 (notice before backfill, right to disown), for example requiring that backfilled recipes stay visibly "unconfirmed by author" until the named person claims or reacts to them?
5. Is recording rejected alternatives (item 5) a recipe-guide copy change, or does the PR-review use case justify a structured field that search can filter on?
6. Should docs/benchmarks.md cite MemDelta (M29) as outside support for its existing "judge the methodology" stance?
7. RoBrain's README describes its own benchmark, VetoBench, in these words: "without decision memory, a coding agent re-proposes an approach your team already rejected in up to **9 of 10** tasks" ([RoBrain README](https://github.com/adelinamart/robrain); vendor-run). Is that worth running as an outside check, given the single-prompt screen in recipe `9a43901e` would seem to admit it (it rewards persistent judgment across tasks)?

---

## 7. Unverified / could not confirm

- **ChatGPT memory for Business and Enterprise.** Both OpenAI Help Center articles ([Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq), [Memory FAQ, Business version](https://help.openai.com/en/articles/9295112-memory-faq-business-version)) and the [launch post](https://openai.com/index/memory-and-new-controls-for-chatgpt/) returned HTTP 403 to automated fetches. A search-engine summary said that workspace members cannot see each other's memories and that a workspace owner turning memory off deletes members' saved memories. Not quoted above because the primary text could not be read. Someone with a browser should confirm.
- **Cursor Memories removal.** A Cursor forum thread titled "Custom modes and memories gone in 2.1" exists ([forum.cursor.com](https://forum.cursor.com/t/custom-modes-and-memories-gone-in-2-1/143744)), and the current Rules page does not mention Memories. No official Cursor statement on the removal was found. The program doc's seed entry "Cursor memories" should be read as "Cursor rules" until confirmed.
- **OWASP Top 10 for Agentic Applications 2026.** The [landing page](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) (dated 9 December 2025) was reachable, but the list itself is in a downloadable document that was not read. Secondary sources say memory and context poisoning is item ASI06. Not confirmed from the primary.
- **MINJA success rates and later attack papers.** Percentages reported in secondary write-ups were not checked against the paper body and are omitted.
- **Mem0 paper versus Mem0 docs.** The paper describes UPDATE and DELETE operations; the current docs describe "Additive storage" (both quoted in M1). Whether the hosted product changed behavior, or the docs describe a different layer, was not determined.
- **Zep LoCoMo dispute.** The Zep blog also carries a later note about newer scores. It was not quoted because the note's displayed date appears to contain a typo, and the underlying evaluation was not reviewed.
- **TencentDB Agent Memory.** The only source read was the vendor's press release. The repository, its license, and whether memories are agent-written or human-written were not checked.
- **Cognee permissions and temporal features.** The README points to a permissions guide that was not read. Nothing is claimed about Cognee's tenant model.
- **Letta organization model.** Shared and read-only blocks are documented (M3). Letta Cloud's org roles were not researched.
- **GitHub Copilot Memory effect sizes** (M13) are GitHub's own A/B results and have the same self-reporting caveat as every vendor number in §2.5.
- **Anything after the access date.** Several of these features are in beta or preview (M14, M18, M22) and their docs say they may change.
