# Walkthroughs without a dev server, and the e2e-agent lineage

Research track 7 for [../pr-review-helpers.md](../pr-review-helpers.md), 2026-09-27. Question: can Soup.net stand in for Playwright-style walkthroughs in review by hosting files rather than executing code, what would screenshot and video embeddings enable, and where the operator documented the idea of Soup.net orchestrating autonomous e2e verification agents. Quotes marked *(fetch summary)* came through a summarizing fetch tool; re-open the link before reusing them in public copy.

The operator's framing, verbatim (planning conversation, 2026-09-27):

> "I like puppetteer / playright style walkthroughs and videos. But you need to spin them up with a dev server. Could soupnet securely replace that somehow? Hard pass on running user submitted code, though, so we'd have to accept their config instead. Host files not execute their code."

## Key findings for the plan

- **The e2e idea is documented in one backlog item and one recipe.** [docs/backlog.md](../../backlog.md), heading "`[DESIGN]` Test-coverage recipe books — judging coverage gaps and overlaps by intent (idea stage, not for the first org release)", filed from recipe `0760205a` (2026-09-19). It is about coverage by intent, not PR review, but its unit (an intent, a Playwright walk, screenshots and video, a deposit about how it went) is the same unit a PR walkthrough needs. See [the lineage](#the-e2e-orchestration-lineage).
- **Today Soup.net stores evidence files but never shows them.** `GET /uploads/*` always 404s, and the trace page renders only the filename, MIME type, hash and ROI box (`apps/frontend/src/pages/TraceDetailPage.tsx`, `FileAttachment`). "Hosting walkthroughs" is therefore a new serving surface, not a tweak.
- **Only part of a Playwright run fits the upload allowlist.** Screenshots (PNG) fit. Playwright video is WebM, which is not on the list, so it needs a client-side transcode to MP4. The HTML report (a folder) and `trace.zip` fit nowhere.
- **The line between hosting and executing is clear and already half-drawn.** Images and MP4 are inactive content: serve with `nosniff`, `Content-Disposition: attachment` or `CSP sandbox`, no sandbox domain needed. The HTML report and trace viewer are active content and need an isolated origin. The uploads route already pins `default-src 'none'; sandbox` for any future serving.
- **Video embeddings are coarse.** Gemini samples at most 32 frames and caps video at 120 seconds, so a whole-run video embeds as one blurry summary. Per-step screenshots, each its own evidence entry, are the useful retrieval unit.
- **Self-hosters on `local` or `openai-compatible` embeddings get no visual retrieval.** Those providers fold image parts into a text placeholder. Screenshot similarity is a Gemini-only feature.
- **The operator chose, today, not to host walkthroughs for his own solo review.** Recipe `cd313ba0`: the standard local Playwright HTML report "over a hosted walkthrough page". Hosting earns its place only where the reviewer is not the person who ran the tests, which is exactly the team PR case.
- **Traces leak secrets.** Network bodies, `Authorization` headers and cookies land in `trace.zip`; videos capture whatever the screen showed. Anything Soup.net accepts needs scrubbing guidance on the client side, and the trace archive is the riskiest artifact to accept.

## Scope

In:

- Accepting artifacts the person's own run produced: screenshots, a transcoded MP4, and the run's config and expectations/results text, as evidence files and evidence text on recipes.
- Embedding screenshots (with the existing ROI box) so recipes about UI decisions retrieve by look as well as by words.
- Serving images and MP4 back to authorized readers as inactive content, if a viewing surface is built.
- Linking out to where the person already hosts a report (their CI artifacts, Argos, Currents) as a reference citation.

Out:

- Running any submitted code: test specs, app builds, a Storybook, a dev server, a preview deployment. This is the operator's hard line.
- Hosting the Playwright HTML report or trace viewer on a Soup.net origin. Both are active content; doing it safely means a separate public-suffix sandbox domain, and the ecosystem already offers it (below).
- Pixel-diff visual regression. Argos, Chromatic and Percy do deterministic diffs; embeddings answer "similar", not "changed by 3 pixels".

## What Playwright produces and where each piece can live

- **Screenshots**: PNG, on the upload allowlist (`packages/domain/src/supported-media.ts`: `{ mimeType: "image/png", extension: ".png", category: "image" }`).
- **Video**: WebM. "Record browser sessions as WebM videos with chapter markers and action callouts." ([playwright.dev agent-cli](https://playwright.dev/agent-cli/commands/video-recording), *fetch summary*). Soup.net accepts `video/mp4` and `video/quicktime` only, and Gemini accepts "MP4, MOV" ([Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings), *fetch summary*). "The video size defaults to the viewport size scaled down to fit 800x800." ([playwright.dev/docs/videos](https://playwright.dev/docs/videos), *fetch summary*).
- **Trace** (`trace.zip`): "Traces capture multiple data types including screenshots rendered as filmstrips, complete DOM snapshots at different action states, network requests with headers and bodies, and browser console logs" ([trace viewer docs](https://playwright.dev/docs/trace-viewer), *fetch summary, paraphrase*). Not on the allowlist.
- **HTML report**: "HTML reporter produces a self-contained folder that contains report for the test run that can be served as a web page." ([reporters](https://playwright.dev/docs/test-reporters), *fetch summary*). A folder of HTML and JS; not on the allowlist.

The trace viewer already runs without a server of ours: "trace.playwright.dev is a statically hosted variant of the Trace Viewer." and "Trace Viewer loads the trace entirely in your browser and does not transmit any data externally." It also opens remote traces by URL: `https://trace.playwright.dev/?trace=https://demo.playwright.dev/reports/todomvc/data/e6099cadf79aa753d5500aa9508f9d1dbd87b5ee.zip` ([trace viewer docs](https://playwright.dev/docs/trace-viewer), *fetch summary*). So a recipe can cite a trace the person hosts somewhere and a reader opens it in Playwright's own viewer; Soup.net serves nothing active. Caveat, unverified: the remote-trace fetch needs the trace host to allow cross-origin reads.

## What hosted services do

- **Argos** stores, does not run tests: "The Argos Playwright reporter automatically reports failure screenshots and playwright traces." and "Each uploaded snapshot — including screenshots and Playwright traces — is limited to 50 MB." ([Argos Playwright reference](https://argos-ci.com/docs/reference/playwright), *fetch summary*).
- **Currents** stores, does not run tests: "The artifacts are collected for each individual test attempt, and are stored on Currents' secure and encrypted cloud storage." ([currents.dev/playwright](https://currents.dev/playwright), *fetch summary*).
- **Chromatic** crosses the line on purpose: "Every time you trigger a Chromatic build, your Storybook is published on our secure CDN." and "Published Storybooks are private by default with access restricted to logged in collaborators." ([Chromatic publish](https://www.chromatic.com/docs/publish/), *fetch summary*). It then renders that built JavaScript in its own browsers to take snapshots, which is executing the customer's code. Preview deployments (Vercel and similar) are the same pattern: build and run the app. Both sit outside the operator's line.

The pattern: the storage-only services (Argos, Currents) are the model Soup.net can follow; the rendering services (Chromatic, preview deploys) are what "Host files not execute their code" rules out.

## Security of hosting what people upload

- **Inactive content needs no sandbox domain.** web.dev lists `"X-Content-Type-Options: nosniff"`, `"Content-Disposition: attachment; filename="download""`, `"Content-Security-Policy: sandbox"` and `"Content-Security-Policy: default-src 'none'"` for content that should "load only as subresources or downloads" ([Securely hosting user data](https://web.dev/articles/securely-hosting-user-data), *fetch summary*).
- **Active content does.** "Create a new sandbox domain added to the public suffix list. For example, by adding exampleusercontent.com to the PSL, you can ensure that foo.exampleusercontent.com and bar.exampleusercontent.com are cross-site and thus fully isolated from each other." (same source, *fetch summary*).
- **Soup.net already pinned the inactive posture.** `apps/backend/src/routes/uploads.ts`: "GET /uploads/* unconditionally 404s today (F10), so these are inert — they pin the failure mode NOW so that if file serving is ever enabled (even for a narrow use case), responses on this prefix are already sandboxed", with `default-src 'none'; sandbox`, `Content-Disposition: attachment` and `Cross-Origin-Resource-Policy: same-origin`. Showing an image inline in the SPA would need `Content-Disposition` relaxed for images only, and ACL checks per reader: today an upload URL "is only resolvable by the same key that uploaded it" (briefing), which is the opposite of a teammate viewing it.
- **The artifacts carry secrets.** "Inside a Playwright trace, you can see DOM snapshots, test events, and network activity, such as requests and response headers and bodies." and "Videos capture the entire test viewport for the full duration. Any data rendered on screen during the test ends up in the `.webm` file." ([Currents blog](https://currents.dev/posts/playwright-avoid-data-leak), *fetch summary*). The repo's own workflow says the same of local output: "The report, screenshots, videos and traces: `playwright-report/` and `test-results/`, both gitignored. They can show local dev data." ([browser-verification.md](../../workflows/browser-verification.md), "Where the files live").

## Current Soup.net support, from the code

- Allowlist: PNG, JPEG, WebP, MP4, MOV, MP3, WAV, FLAC, OGG, PDF (`packages/domain/src/supported-media.ts`). The comment on video reads "(≤120s per Gemini limit)".
- Size: `MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB (video needs more room)` (same file). Rate: "100 uploads per hour per key" (`apps/backend/src/routes/uploads.ts`).
- Embedding: files go to Gemini as `inlineData` base64 (`apps/backend/src/lib/embeddings/enqueue.ts`), synchronously at check time; ADR-0019: "Multimodal embeddings are deliberately sync-only".
- Region of interest: images only. `region_meta` is "extensible to future `time_range`, `page_range` for video/audio/PDF" ([ADR-0019](../../adr/0019-roi-multimodal-embeddings.md)), and `apps/backend/src/lib/image-roi.ts` holds the placeholder `// Future: time_range?: { start_seconds: number; end_seconds: number };`.
- Self-hosted providers: "Local models are text-only; image parts contribute a stable text placeholder" (`apps/backend/src/lib/embeddings/local-client.ts`).
- Display: filename, MIME, hash and ROI only (`FileAttachment` in `TraceDetailPage.tsx`).
- Doc drift found: CLAUDE.md lists "`uploads` — multimodal evidence files, api-key-scoped capability tokens (ADR-0019)", but ADR-0019 is ROI embeddings, and the design doc `uploads.ts` cites (`docs/planning/uploads-endpoint.md`) does not exist.

## What the embedding model supports

From [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings) (*fetch summary*):

- "Text, image, video, audio, and documents" in one space, enabling "cross-modal search and comparison."
- "Maximum of 6 images per request. Supported formats: PNG, JPEG." (WebP is on Soup.net's allowlist but not in this list; unverified whether it embeds.)
- "Maximum duration of 120 seconds. Supported formats: MP4, MOV. Supported codecs: H264, H265, AV1, VP9. The system processes a maximum of 32 frames per video: short videos (≤32s) are sampled at 1 fps, while longer videos are uniformly sampled to 32 frames."
- "Adding multiple inputs directly to the `contents` parameter produces one aggregated embedding for all inputs," while "wrapping each input in a `Content` object" returns "separate embeddings for each entry."

Prior art on screen embeddings: Screen2Vec (Li, Popowski, Mitchell, Myers, CHI 2021) reports "representing between-screen similarity through nearest neighbors" among its properties ([arXiv 2101.11103](https://arxiv.org/abs/2101.11103), *fetch summary*). The corpus holds a standing caution: "The cosine similarity between two "dark mode" screenshots may be high for layout reasons, not the taste-relevant color scheme reasons." (recipe `2bd24176`), and ADR-0019 says its ROI technique is "Gemini-untested".

## Hypotheses

**(a) Soup.net accepts the person's own-run Playwright artifacts as evidence files.**

- Enables: a PR recipe ("I chose to show the error inline") carries the screenshot of that state, so a reviewer sees the decision and its proof together, with no dev server. Matches the operator's practice: "Every new web UI gets a screenshot, of each state a reader could reach: the empty state, each error message, the result of each action." (recipe `3fe6f013`).
- Needs: nothing for screenshots; a client-side WebM-to-MP4 step (ffmpeg) for video, kept under 20 MB and 120 s; a skill step that uploads the fixed-name screenshots from `browser-verify` runs; a viewing surface for readers other than the uploader (today: none); scrubbing guidance.
- Against: the operator picked the local HTML report over a hosted page for his own review (`cd313ba0`); for solo work this adds nothing. The trace, the richest artifact, does not fit and carries the most secrets.

**(b) Screenshot and frame embeddings answer "has this UI state been seen before".**

- Enables: a reviewer's agent searches by a PR's screenshot and finds earlier recipes about the same screen or state (the empty state someone already ruled on, a layout reversed last month). Visual search across PRs, not pixel regression.
- Needs: one evidence entry per screenshot (the model aggregates if several go in one request, and a 32-frame video sample is too coarse to find one state); an image-query path in `search_recipes` (today search takes text only; unverified whether any surface accepts an image query); Gemini as provider.
- Against: embeddings encode topic, not stance, and may cluster screens by layout rather than the taste-relevant detail (`2bd24176`); the ROI box helps but is untested on Gemini. Near-identical screenshots across runs will crowd results the way near-duplicate text does.

**(c) A recipe about a UI decision retrieves by screenshot similarity.**

- Enables: a design recipe logged with its mockup surfaces when a later PR's screenshot looks like it, even if the words differ. This is the original multimodal intent: "I'd like to comment on each taste or judgement call so that it can be checked as a recipe along with the appropriate images, code, even browser screenshots" (Andy, 2026-03-29, recipe `c6c4645e`).
- Needs: (b)'s image-query path, and evidence-level retrieval that weighs the image vector. Measure before building: run a small held-out set of UI recipes with and without screenshots, the same A/B ADR-0019 already names as its first open question.
- Against: the corpus holds few image-bearing recipes; ADR-0019 set "≥50 multimodal recipes to score" before its A/B. Until then this is a hypothesis without data.

**(d) Accept config and results text, not code.** The operator's "accept their config instead" maps onto what `browser-verify` already writes: `expectations.md` (claims, actors, steps, expected outcomes, screenshot names) and `results.md` (met / not met / unverified / open per expectation). As evidence text these are cheap, searchable, and carry no execution risk; the screenshot names join text to images.

- Enables: a PR recipe cites "E3 not met: the page showed X" with the matching screenshot, and a later search finds every PR where that expectation failed.
- Needs: nothing new server-side; a skill step. Security-fix results stay out of public books (browser-verification.md: "Results for a security fix follow the security workflow's rule").

## The e2e-orchestration lineage

Where it is written down:

1. **Recipe `0760205a`** (soupnet-oss, 2026-09-20, from a 2026-09-19 conversation): "As an engineering lead frustrated by automated test suites that proliferate with no way to judge coverage gaps or overlaps, I want to explore a different kind of recipe book where an agent role-plays an end user from a declared intent, walks the site with browser automation while capturing screenshots and video, and deposits how it went, so that clustering over those walkthroughs shows whether an intent is already covered before anyone adds another test." Evidence, verbatim: "This is a differnt kind of recipe book that is more roleplaying like an end user, design thinking style, and walking through a website as that user. It would start with an intent - as a web site admin, I want to add a new user. Then it walks through the steps to get there with playwrite, taking screenshots and video, depositing feedback on how it's going." and "Feels like a solution to the proliferation of test cases with no real way to judge coverage gaps or overlaps."
2. **Backlog item** in [docs/backlog.md](../../backlog.md), "`[DESIGN]` Test-coverage recipe books — judging coverage gaps and overlaps by intent (idea stage, not for the first org release)". It names what it builds on: "intents, multimodal evidence (uploads), the recipe map's clustering, and the agent-run persona pattern from the briefing regression harness (`89e712e5`)", and its open questions: "what the recipe's claim is for a walkthrough (the user's expectation of the flow?), whether screenshots and video fit the evidence model as-is, and how a coverage view differs from the existing map."
3. **Ancestor, recipe `89e712e5`** (soupnet-oss, 2026-06-10): the orchestration pattern itself, "an AI coding agent following a runbook — orchestrating fresh sub-agent contexts as test personas and separate sub-agents as judges — over scripted LLM API calls".
4. **Current practice** (2026-09-27): [docs/workflows/browser-verification.md](../../workflows/browser-verification.md) and `.claude/skills/browser-verify/SKILL.md` (both on `main`; not yet on this worktree's branch). An orchestrator writes expectations from the PR's claims, a fresh verifier agent writes and runs `tests/e2e/pr-<n>.spec.ts`, and results are labelled per expectation: "The verifier checks the author's claims, not the implementer's conclusions." Decisions behind it: `842703c5` (three separated steps), `b13d1f89` (harness in the public repo), `3fe6f013` (screenshot every state), `cd313ba0` (local HTML report as the viewing surface), `350c2040` (process public, run results private).

How it connects to PR review:

- The browser-verify **expectation** is a small intent ("as a new member, I accept an invite and see my book"). The coverage idea's unit is an intent walked by an agent. They are the same shape: an intent, a walk, screenshots, a verdict.
- So each PR verification run could deposit one walkthrough per expectation into a walkthrough book: the claim (expected outcome), the verdict, the named screenshots. Over time that book is the coverage map `0760205a` asked for, grown as a side effect of PR review instead of as a separate test-writing effort. This is stigmergy applied to the e2e suite.
- The recipe's claim, one of the backlog's open questions, then has a natural answer: the PR author's stated expectation of the flow, with the verdict as evidence.
- Soup.net orchestrates without executing: the agent runs Playwright on the person's machine or CI, Soup.net holds intents, verdicts and screenshots, and search tells the next orchestrator which intents already have walkthroughs.

## Suggested sequence

1. Nothing server-side: have `browser-verify` optionally deposit one recipe per expectation (claim plus verdict, results line as evidence text, screenshot uploaded as a file). Tests hypotheses (a) and (d) with today's surface.
2. Measure before building: once enough image-bearing recipes exist, run ADR-0019's A/B and a screenshot-query probe for (b) and (c).
3. A read-only viewer for images and MP4 on the trace page, inactive-content headers, reader ACL by book membership. Needed before a teammate can see anything.
4. Coverage view over a walkthrough book (the `0760205a` backlog item), after steps 1 to 3 show the deposits cluster usefully.
5. Traces and HTML reports: link out (the person's CI, Argos, Currents, or `trace.playwright.dev/?trace=`) rather than host.

## Soup.net use

Agent `a-pr-review-research-walkthroughs-2026-09-27`, intent `int_YJ38wwO8VBqFsyYeJFTeOhAg`, session `1ddd8ef8-93c8-4190-8284-25b404aa87fd`.

- Search `66f556f2-8fc0-4170-b00d-8a4ed8923149` ("orchestrate autonomous e2e verification agents"): surfaced `0760205a`, the source of the e2e idea, which led to the backlog item. Also `89e712e5` via the backlog text.
- Search `094d1920-8949-4013-9d14-d11326599db8` (Playwright verification evidence): surfaced the 2026-09-27 browser-verify decisions, including `cd313ba0`, the counter-evidence to hosting.
- Search `0fe1ee24-8173-48ac-b032-3f57a957883f` (screenshot embeddings): surfaced ROI recipes `332cf4e2`, `d629cd93` and the layout-versus-taste caution in `2bd24176`.
- Check `d818864d` (soupnet-oss): the operator's stated line, accept own-run artifacts as stored files and never execute submitted code. Nearest: `350c2040`, `cd313ba0`; nothing contradicted it.
