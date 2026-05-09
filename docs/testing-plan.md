# Testing Plan

## Philosophy
- Test behavior, not implementation
- Pure functions get unit tests; service functions get integration tests
- **Two-tier testing:** `npx vitest run` for fast daily dev (shared Docker DB); `npm run test:ci` for clean verification (fresh DB, matches CI exactly)
- **What NOT to test:** Don't test what the type system catches. Pure data exports (e.g., `RECIPE_EXAMPLES`) — if it compiles, it works. Don't bloat route tests with redundant content assertions. One "contains key string" check per semantic concern, not snapshot testing.

## Known Side Effects of Integration Tests

Integration tests (`npx vitest run`) hit the running Docker backend and create real data:
- **Test users** accumulate (timestamped emails like `test-auth-{ts}@test.local`)
- **Test traces/evidence** are created by check route tests — these enqueue embedding jobs
- **Worker processes test embeddings** — see "Embedding Provider for Tests" below; with the stub provider this uses zero API quota
- **Postgres logs** expected duplicate key violations from "rejects duplicate email" tests

This is acceptable for daily development. For clean verification, use `npm run test:ci` which runs against a fresh isolated DB on port 5534 (see "CI-Like Local Testing" below).

## Embedding Provider for Tests

The worker chooses an embedding provider at startup via `EMBEDDINGS_PROVIDER`:

- **`stub`** (recommended for local dev and CI) — deterministic 3072-dim fake vectors derived from `sha256(text + taskType + modelId)`. No network, no quota. Same input → same vector, so the real `vector_cache` code path (cache miss → provider → write back → next call hits cache) is fully exercised. Different inputs produce different vectors so HNSW search and clustering still differentiate them — they just aren't semantically meaningful.
- **`gemini`** — real Gemini API. Required in production. Use locally only when you specifically want to verify real embeddings.

`.env.example` defaults to `stub`. Production sets `gemini` via Terraform / ECS task definition. The provider is logged at backend startup (`[backend] Embedding provider: stub`).

**One smoke test always exercises real Gemini** when `GEMINI_API_KEY` is set: `apps/backend/src/lib/gemini-client.test.ts`. This is a deliberate, single, cheap call per test run that verifies the actual API integration (response shape, dimensionality, model id). It calls `batchEmbed` directly — no pg-boss, no docker — and skips automatically when no key is present. If it fails, investigate the API / key / request shape; do not mock it.

If you need to inspect real semantic search behavior locally, set `EMBEDDINGS_PROVIDER=gemini` in `.env`, restart the backend, and re-run the relevant tests.

**Rate limiting** is disabled in the Docker dev environment (`DISABLE_RATE_LIMIT=true` in docker-compose.yml). Dedicated unit tests in `rate-limit.test.ts` verify rate limiting behavior independently.

## Running Tests

`.env` is loaded automatically by `vitest.config.ts` — no `source .env` needed. CLI env vars take precedence over `.env` values.

```bash
npx vitest run                    # all tests (integration tests need running backend)
npx vitest run --reporter verbose # with details
npx vitest watch                  # watch mode

# CI-like environment (fresh postgres, no Gemini key, no dev data):
npm run test:ci                   # full CI reproduction — see below
```

### CI-Like Local Testing

`npm run test:ci` reproduces the exact CI environment locally using `docker-compose.ci.yml`:

1. Spins up a fresh postgres on port **5534** (separate from dev on 5533)
2. Builds packages + backend
3. Starts the backend (runs migrations from scratch, creates system user)
4. Seeds system settings (signup cap)
5. Runs all tests with `GEMINI_API_KEY=""` (lexical-only fallback)
6. Tears down everything

Use this when:
- CI fails but local tests pass (different data, different postgres state)
- Testing migrations work from scratch
- Verifying lexical-only search behavior (no Gemini key)
- Debugging cold-start behavior

You can also use the CI postgres manually:
```bash
docker compose -f docker-compose.ci.yml up -d           # start
docker compose -f docker-compose.ci.yml down -v          # teardown (deletes data)
```

## Test Layers

### Layer 1: Unit Tests (no I/O)

100% branch coverage expected. These are small, deterministic, and fast.

| File | What it tests |
|------|--------------|
| `evidence-parser.test.ts` | Markdown evidence parsing (14 cases, delimiter variants) |
| `full-document.test.ts` | SHA-256 chunking, determinism |
| `ranking.test.ts` | Score blending formula (40% lexical + 60% semantic), clamping |
| `format-adherence.test.ts` | User story format validation (8 cases + edge cases) |

### Layer 2: Integration Tests (requires running DB)

Happy path + key error paths + idempotency. Not exhaustive edge cases.

| File | What it tests |
|------|--------------|
| `auth.test.ts` | Registration, duplicate rejection, login, JWT validation |
| `check.test.ts` | Recipe check via GET/POST, JSON format, idempotency, error handling |
| `trace.service.test.ts` | Submit + search, idempotency, different-key diversity, tsvector matching |
| `clustering.service.test.ts` | Cosine distance, k-means clustering, medoid logic |

### Layer 3: Route/HTTP Tests (status codes + response shapes)

Lightweight — assert status, content-type, and key content markers. No auth needed for public pages.

| File | What it tests |
|------|--------------|
| `docs.test.ts` | Public doc pages: recipe-check-guide, recipe-scenarios (file reading + markdown rendering), mcp-setup (query param embedding) |

### Layer 4: Manual Browser Verification

When an agent modifies HTML routes, CSS, or frontend components, it provides the human with a verification checklist. The agent cannot see the browser — the human confirms.

**Prerequisites:** Backend running on localhost:3001.

| URL | What to verify |
|-----|---------------|
| http://localhost:3001/docs/recipe-check-guide | Page loads. All sections render (How this works, Examples, Tips). "Recipe Check Scenarios" link works. |
| http://localhost:3001/docs/recipe-scenarios | Page loads (no 500 error). Markdown renders as HTML — headings, code blocks, blockquotes visible. No raw markdown. "Back to recipe check guide" link works. |
| http://localhost:3001/docs/mcp-setup | Page loads. Config snippets show with YOUR_API_KEY placeholder. macOS/Windows configs in details toggles. |
| http://localhost:3001/docs/mcp-setup?key=TEST123 | Same as above, but snippets show "TEST123" instead of "YOUR_API_KEY". |
| http://localhost:3001/check | Check page loads. Form submits without error. "Recipe Check Guide" link navigates correctly. |
| http://localhost:5173 | Frontend SPA loads. Navigation works. Dashboard shows groups and keys (if logged in). |

**Surfacing test data for manual checks:** When asking the human to test the `/check` page, the agent should fetch a recent recipe from the database and provide it as copy-paste text in the chat. This avoids the human having to dig through the DB themselves. Example query:
```sql
SELECT t.trace_text, e.interpretation, r.quote, r.source
FROM claimnet.traces t
LEFT JOIN claimnet.trace_evidence te ON te.trace_id = t.id
LEFT JOIN claimnet.evidence e ON e.id = te.evidence_id
LEFT JOIN claimnet.evidence_references er ON er.evidence_id = e.id
LEFT JOIN claimnet.references r ON r.id = er.reference_id
ORDER BY t.created_at DESC LIMIT 1;
```
Or use the JSON API: `GET /check?key=<key>&trace=<recipe>&ef=<evidence>&format=json`

Future: A `/check/recent` endpoint to surface the most recent recipe for an API key without reinforcing old traces.

**How agents should use this:** After modifying any route that serves HTML, paste the relevant rows and ask the human to verify. Include additional high-signal checks:
- Anything the agent changed that it can't verify programmatically
- Areas where the agent wants a "second opinion" to confirm alignment on intent
- Recently changed features where the agent doesn't know what it doesn't know

### Layer 4b: Local MCP Testing

Tests MCP tool behavior and session lifecycle against the local Docker backend. The `.mcp.json` file includes a `soupnet-local` server pointing to `http://localhost:3001/mcp`.

**Prerequisites:** Backend running on localhost:3001. A valid API key in `.mcp.json` under `soupnet-local`. If the key has expired, generate a new scoped key:

```bash
# Login, then create a scoped key (replace password from .env)
TOKEN=$(curl -s http://localhost:3001/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"andy@soup.net","password":"YOUR_DEV_PASSWORD"}' | \
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.token))")

# Create a 30-day scoped key (adjust group IDs from your local DB)
curl -s http://localhost:3001/keys/scoped -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"readGroupIds":["<group-id>"],"writeGroupIds":["<group-id>"],"defaultWriteGroupId":"<group-id>","expiresAt":"2026-05-04T00:00:00Z","label":"local-mcp-dev"}'
```

Update the key in `.mcp.json` under `soupnet-local.headers.Authorization`, then run `/mcp` in Claude Code to reconnect.

**What to test:**

| Test | How | What to verify |
|------|-----|----------------|
| Basic connectivity | Call `list_my_groups` via `soupnet-local` | Returns groups without error |
| Recipe check | Call `check_recipe` with a test recipe | Returns results, trace is logged |
| Session recovery | Run `docker compose restart backend`, then call any tool | Works without `/mcp` reconnect — server creates new session transparently |
| Key expiry | Use an expired key | Returns "Invalid or expired API key" error |

**When agents should run this:** After modifying `apps/backend/src/routes/mcp.ts`, MCP tool definitions, session handling, or auth middleware. The session recovery test should be run whenever session management code changes.

**Verify server-side behavior, not just client success.** A tool call succeeding doesn't prove the server did the right thing — the MCP client may silently retry. After session management changes, always check the Docker logs (`docker compose logs backend --tail=20`) to verify the expected code path was hit. For session recovery, look for the log line: `[mcp] Stale session: client sent unknown session ...`. For protocol-level verification, use curl to see the raw HTTP response code.

**Important:** The `soupnet-local` key in `.mcp.json` is not committed to the repo (`.mcp.json` is in `.gitignore` or contains dev-only keys). Each developer generates their own local key.

### Layer 5: Search Quality (monitored, not pass/fail)

Metrics may intentionally change when algorithms change.

| Planned | Metrics |
|---------|---------|
| `tests/search-quality/run-comparison.ts` | precision@5, MRR, score spread |

Compares vector types: SEMANTIC_SIMILARITY vs RETRIEVAL_DOCUMENT.

### Layer 5b: Agent Comprehension QA (manual, requires fresh LLM session)

Tests whether the bootstrap blurb + recipe guide produce correct understanding in a fresh AI agent with no prior context.

| Script | What it tests |
|--------|--------------|
| `scripts/qa-agent-understanding.ts` | Outputs: (1) the exact prompt a fresh agent receives, (2) five comprehension questions with expected nuances and red flags, (3) scoring rubric. Run: `npx tsx scripts/qa-agent-understanding.ts` |

**How to run:** Execute the script, give the output prompt to a fresh LLM session (no CLAUDE.md, no memory, no MCP), ask the five questions, and score against the rubric. The most diagnostic question is "read-vs-write" — if the agent describes checks as primarily writes that require caution, the framing hasn't landed.

**When to run:** After any change to CLAUDE.md's Recipe Checks section, the bootstrap blurb in `packages/domain/src/recipe-guide-content.ts`, or the MCP tool descriptions.

### Future: Claude Agentic Browser Testing

**Status:** TODO — sits between Layer 3 (route tests) and Layer 4 (manual verification).

**Goal:** Automate Layer 4 using Claude's computer-use or browser-tool capabilities. Verifies visual rendering, link navigation, and form behavior that HTTP-level tests cannot.

**When to implement:** When Claude Code gains stable browser/screenshot tool access and the manual checklist has stabilized.

**What it would cover:** Screenshot each URL, verify no error states, click navigation links, submit forms, verify CSS loads, check responsive layout.

## Coverage Expectations
- Pure functions: 100% branch coverage
- Services: happy path + error paths + idempotency
- HTTP routes: status codes + response shapes
- Manual: agent provides checklist, human confirms
- Search quality: monitored, not pass/fail (metrics may vary)

## Test Data Isolation

**Automated tests:** Create throwaway users with `@test.local` emails (e.g., `test-check-{timestamp}@test.local`). These are isolated by convention — the cleanup script removes them:
```bash
npx tsx scripts/cleanup-test-data.ts           # clean up @test.local users + all associated data
npx tsx scripts/cleanup-test-data.ts --status  # just show counts
```

**E2E testing with real data:** AI agents can use the dev credentials from `.env` (`DEV_USERNAME` / `DEV_PASSWORD`) to log in, create a dedicated test group (e.g., "e2e-test-{timestamp}"), and run recipe checks against the actual system with real API keys scoped to that group. This tests the full stack including Soupnet integration without polluting personal recipes. The test group and its data can be cleaned up after the run.

**Rules:**
- Never test against production API keys
- Automated test users always use `@test.local` email addresses
- E2E test groups should be clearly named to distinguish from real groups
- Idempotent fixtures: same key + group + text = no duplicates

## Decisions
- **Vitest** over Jest: native ESM, faster, Vite ecosystem alignment
- **No Langfuse**: no LLM calls to trace, our QA needs are search-specific
- **No testcontainers**: tests run against the existing Docker postgres for simplicity
