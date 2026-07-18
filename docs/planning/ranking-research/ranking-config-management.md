# Experiment & configuration management for ranking systems — evidence memo

**Research sub-agent memo for [check-recipe-ranking-system.md](../check-recipe-ranking-system.md) §5.5.** Date: 2026-07-16. Method: primary-source web research (vendor docs, engineering blogs, the Google SRE workbook) plus prior rulings surfaced via Soup.net recipe check. Verbatim quotes throughout; secondary or unconfirmed claims are flagged UNVERIFIED.

## 1. Parameter versioning for ranking algorithms

**Vespa: named rank profiles, deployed as code, selected per query.** Vespa is the clearest production precedent for "ranking parameters are a versioned artifact, not scattered settings." Rank profiles live in the schema (the deployed application package — config-as-code), and a query picks one at request time:

> "A schema can have any number of rank profiles specifying computations and ranking for different use cases, experiments, and so on."
> "Queries select one using the ranking.profile parameter in requests or a query profile."
> "If no profile is specified in the request, the one called `default` is used"
> — [Vespa: Ranking](https://docs.vespa.ai/en/basics/ranking.html)

Vespa's query profiles additionally carry explicit version strings — "Query profiles (and types) may exist in multiple versions at the same time … e.g `MyProfile:1.2.3`" ([Vespa: Query Profiles](https://docs.vespa.ai/en/querying/query-profiles.html), quoted via search result — wording UNVERIFIED against the page, mechanism confirmed by the docs' existence). The composite pattern: **defaults are one named profile; experiments are other named profiles; both ship through the same code-deploy pipeline; the request selects.**

**OpenAI: dated snapshots behind a moving alias.** The other widespread pattern is Stripe/OpenAI-style dated identifiers: `gpt-4o` is an alias that moves; `gpt-4o-2024-08-06` is a frozen snapshot callers pin for reproducibility, and OpenAI announces alias moves in advance (e.g. "GPT-4o default model will be updated to latest version on October 2nd, 2024" — [OpenAI community announcement](https://community.openai.com/t/reminder-gpt-4o-default-model-will-be-updated-to-latest-version-on-october-2nd-2024/962350)). The lesson for a ranking system: **an alias ("current") plus immutable dated versions gives both a moving default and pinnability.**

## 2. Pinned-algorithm reporting

**Stripe is the canonical design.** Their versioning post is explicit about pinning, overriding, and date naming:

> "The first time a user makes an API request, their account is automatically pinned to the most recent version available, and from then on, every API call they make is assigned that version implicitly."
> "Users can override the version of any single request by manually setting the `Stripe-Version` header"
> "At Stripe, we implement versioning with rolling versions that are named with the date they're released (for example, `2017-05-24`)."
> — [Stripe: APIs as infrastructure — future-proofing Stripe with versioning](https://stripe.com/blog/api-versioning)

Stripe also keeps old versions cheap by encapsulating each change ("Version changes are written so that they expect to be automatically applied backwards from the current API version"), which is what makes long-lived pinning affordable — and their changelog falls out of the same structure: "our API changelog is programmatically generated" (same source).

**Algolia: experiment identity in the response body.** For A/B tests, Algolia stamps the served variant into search-response metadata so downstream analysis can join on it: the response carries `abTestID` and `abTestVariantID` when `getRankingInfo:true` ([Algolia support: "Can I see which A/B test variant a query was sent to?"](https://support.algolia.com/hc/en-us/articles/18318389276689-Can-I-see-which-A-B-test-variant-a-query-was-sent-to); field definitions in the [REST API reference](https://www.algolia.com/doc/rest-api/abtesting-v3/get-ab-test)). A practitioner writeup confirms the analytics join is the point: capture these IDs "along with user ID information" for your data warehouse ([Harlan Harris, "11 Algolia A/B Testing Gotchas"](https://medium.com/@HarlanH/11-algolia-a-b-testing-gotchas-tips-and-lessons-9890e92f3992) — secondary source).

Takeaway: **the served ranking identity (version + any experiment arm + any per-request overrides) must be echoed in the response itself**, not merely logged server-side — the consumer is what writes the experiment report.

## 3. Safe-default rollout (defaults never change silently)

**Elasticsearch's BM25 switch: defaults change only at loud, versioned boundaries.** Elasticsearch changed its default similarity from TF/IDF to BM25 at the 5.0 major version (following Lucene 6), documented as a breaking change with an opt-out (configure `classic` similarity) — UNVERIFIED as verbatim (widely reported; e.g. [Elastic discuss threads](https://discuss.elastic.co/t/change-default-similarity-to-bm25-for-all-fields/12212)); the current state is confirmed: "BM25 similarity (**default**)" — [Elasticsearch similarity settings reference](https://www.elastic.co/docs/reference/elasticsearch/index-settings/similarity). The pattern: a ranking-default change rides a major, announced version boundary, never a patch.

**Google SRE workbook: gradual rollout + rollback as table stakes for config changes:**

> "push the new configuration out gradually—doing so allows you to detect issues and abort a problematic push before causing a 100% outage."
> "The ability to roll back is important for decreasing incident duration."
> — [SRE Workbook ch. 15, Configuration Specifics](https://sre.google/workbook/configuration-specifics/) (UNVERIFIED chapter attribution — quotes returned from the configuration chapters at sre.google)

**LaunchDarkly: the safe default is the *old* behavior.** LaunchDarkly distinguishes the flag's default rule from the SDK-side *fallback* value used when evaluation fails; guidance is that every flag needs a fallback "describing the expected behavior of the feature in case failures occur" and practitioners phrase it as: always default to the safe/old behavior, because a `true` fallback with the flag service unreachable means "the feature is ON for everyone with no control" ([LaunchDarkly: the default rule](https://launchdarkly.com/docs/home/flags/default-rule); practitioner phrasing from [how2.sh setup guide](https://how2.sh/posts/how-to-set-up-feature-flags-with-launchdarkly/) — secondary source, UNVERIFIED verbatim).

This is exactly the posture already on the record here: the echo-suppression mechanism shipped feature-flagged and default-OFF, flipping globally only after the A/B confirms (soup.net recipe `5cfee9bb`, 2026-07-14: "a live ranking change arrives measured rather than wired in untested, keeping production ranking byte-stable until the evidence is in").

## 4. Config-as-code vs runtime settings

The SRE workbook treats even runtime-mutable config as version-controlled, audited code:

> "Checking configuration files into a versioning system, such as Subversion or Git, is a common practice nowadays, but this practice is equally important for configuration ingested by web UI or remote APIs."
> "it is useful (and sometimes required) to log both changes to the configuration and the resulting application to the system."
> — [SRE Workbook, Configuration Design and Best Practices](https://sre.google/workbook/configuration-design/)

And on defaults as product surface: "most users will use the default, so this is both a chance and a responsibility" (same chapter). Vespa reinforces the split: ranking *definitions* deploy with the application package (code); only *selection* (which profile) and query-time inputs are runtime. Andy's prior ruling points the same way: one source of truth for configuration per environment, with drift named and tracked rather than tolerated (recipe `084e4263`, 2026-04-09).

## 5. Changelog/audit practices

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) supplies the format discipline:

> "Changelogs are _for humans_, not machines." … "There should be an entry for every single version." … "The latest version comes first."
> "Using commit log diffs as changelogs is a bad idea: they're full of noise."
> "If you do nothing else, list deprecations, removals, and any breaking changes in your changelog."

Stripe shows the ceiling: when version changes are structured data, "our API changelog is programmatically generated" ([Stripe blog](https://stripe.com/blog/api-versioning)).

## 6. Documenting parameter ranges and tuning provenance

Elastic's BM25 documentation is the model for per-knob documentation — each parameter carries **default + tested range + provenance + tuning method + a don't-tune-first warning**:

> "By default, k1 has a value of 1.2 in Elasticsearch" / "By default, b has a value of 0.75 in Elasticsearch" — [Practical BM25 Part 2](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables)
> "most experiments seem to show the optimal b to be in a range of 0.3-0.9" / "most experiments seem to show the optimal k1 to be in a range of 0.5-2.0"
> "Picking b and k1 are generally not the first thing to do when your users aren't finding documents quickly."
> "If you do end up changing these, make sure to re-test across many queries and many documents."
> — [Practical BM25 Part 3](https://www.elastic.co/blog/practical-bm25-part-3-considerations-for-picking-b-and-k1-in-elasticsearch)

Note the tuning method Elastic recommends — incremental sweeps evaluated with the Rank Eval API — is structurally identical to this brief's golden-dataset sweep harness.

## Recommendations for this system

**Version-identifier scheme.** Stripe-style dated identifiers: `ranking version = YYYY-MM-DD` (e.g. `2026-07-16`), minted **only when a default changes** (parameter default, stage behavior, or pipeline shape) — not per deploy. One identifier ≙ one frozen (pipeline code shape + default parameter set). Keep it as a single exported constant in `packages/domain` next to the config object, so code, tests, and responses cannot disagree. Response metadata (JSON and MCP `structuredContent`) carries a `ranking` block: `{ version, overrides: {…} }` where `overrides` lists only the per-request deltas actually applied (echo_suppress, etc.) — the Algolia pattern: the response self-describes what ranking served it, so agent-side experiment reports need no server-side join. Honest pinning scope: guarantee pinning for *parameter-set* versions (cheap: keep old default objects as data, Stripe's "fixed-cost" encapsulation); when the pipeline *shape* changes, old versions may be retired — a pin request for a retired version should error loudly, never silently serve current.

**Layering — where each knob lives.**
- **Code defaults (canonical):** the config object with all documented knobs, in `packages/domain`, version-controlled, changed only via PR that passes the golden-dataset CI gate and bumps the version constant + changelog together. Ranking defaults move in lockstep with algorithm code and golden thresholds, so they must live in the same artifact (Vespa precedent; SRE version-control quote; Andy's one-source-of-truth ruling).
- **`system_settings` (operational only):** boolean enable/kill-switches per deployment (e.g. the echo-suppression global flag during its A/B window) — never numeric tuning values, because DB-resident numbers bypass the CI harness and drift from the versioned defaults. Every change writes an `audit_log` row (SRE: log the change *and* its application).
- **Per-request overrides (experiments + consumer choice):** the `echo_suppress=on|off` pattern generalizes; overrides are ephemeral, never persisted as defaults, and always echoed back in the response `ranking.overrides` block. Absent overrides, behavior is byte-identical to the pinned/current version — the LaunchDarkly rule that the fallback is the old behavior.

**Changelog format.** `docs/ranking-changelog.md`, Keep-a-Changelog discipline adapted: newest first, one entry per ranking version, each entry recording — version id (date); each parameter changed as `old → new`; the why (link to the sweep report and the human ruling that approved it, per §3c's workflow); golden-metric deltas (before/after on the polluted + clean sets); deploy date. Per-knob documentation table (in the config module's doc or the changelog header) follows the BM25 model: name, default, valid range, tested range, provenance (which sweep established it), and interaction warnings.

## Soup.net activity

- **Briefing:** fetched (purpose = this research task).
- **Discovery check:** `e9717746-6006-4599-bfd5-dcf68375e1d3` (soupnet-oss, agent_id `a-ranking-config-research-2026-07-16`) — "As a maintainer of a semantic-retrieval ranking system, about to design versioned configuration and tuning workflow…". Top result 87%: the sibling offline-eval research check (same fleet). Materially useful hits: recipe `5cfee9bb` (echo suppression shipped flagged, default-OFF, A/B before global flip) and `084e4263` (one source of truth for config per environment; drift documented, not fixed inline) — both cited in the recommendations above.
- **Feedback logged:** check-feedback row on `e9717746` (impact: subtle; disposition: proceeded; story_fulfilled: yes) — prior rulings confirmed and concretely shaped the layering recommendation (code-default vs system_settings vs per-request).
- **Judgment calls:** proceeded on all memo-level calls (source selection, recommendation shape — these synthesize existing rulings rather than contradict any). Nothing escalated; no new recipe logged beyond the discovery check, since the memo's recommendations are inputs to a pending human ruling, not decisions already made.
