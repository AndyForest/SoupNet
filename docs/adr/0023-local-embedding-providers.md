# ADR-0023: Local / self-hosted embedding providers

**Date:** 2026-07-08
**Status:** Accepted

---

## Context

ADR-0005 chose `gemini-embedding-2-preview` as the single embedding model, and ADR-0020 collapsed the async embedding pipeline into the backend behind one provider seam (`apps/backend/src/lib/embeddings/provider.ts`). That seam already carries two providers selected process-wide by `EMBEDDINGS_PROVIDER`: `gemini` (real API, default, required in prod) and `stub` (deterministic 3072-dim fake vectors for CI and tests). The 4-table pipeline was deliberately built to support multiple models behind a clean interface (trace [`cd1545d9`](https://www.soup.net/traces/cd1545d9)).

The gap: every non-stub vector-search path requires a Google Gemini API key. Three personas have no key and no reason to get one — headless CI wanting a genuine (non-stub) semantic smoke test, self-hosters who won't send their corpus to Google, and tire-kickers evaluating the stack. For them the product's core promise (semantic recipe checks) is unreachable without signing up for a third-party API. The stub proves the plumbing but returns meaningless similarities, so it can't answer "does search actually work here?"

The searchable column is `halfvec(3072)` with a single HNSW index (`halfvec_cosine_ops`), and `model_id` is hardcoded to `"gemini-embedding-2-preview"` in four places (including a string literal in the `vector_cache` JOIN in `search-pipeline.ts`). A naive "just add a small local model" runs into two walls: a 384-dim model doesn't fit the 3072-dim column, and a local deployment that kept writing `model_id='gemini-embedding-2-preview'` would poison the content-addressed cache — a provider switch would return another model's vector for the same `content_hash`, exactly the cross-consumer drift [`18912fbd`](https://www.soup.net/traces/18912fbd) warns against.

The full build brief is [`docs/planning/local-embedding-provider.md`](../planning/local-embedding-provider.md) (operator-approved 2026-07-08). This ADR records the durable decisions; the planning doc carries the phase-by-phase implementation detail and the harness setup matrix.

---

## Decision

**Add two new `EMBEDDINGS_PROVIDER` values behind the existing seam, fit their output into the existing `halfvec(3072)` column by zero-padding, and derive `model_id` from the active provider.** `gemini` and `stub` behavior is byte-identical to today.

### 1. Two new providers

- **`local`** — an in-process CPU model via `@huggingface/transformers` (ONNX). Zero external service, zero API key, one env var. Default model **`bge-small-en-v1.5`** (384-dim, ~62 MTEB, no query/passage prefix needed for this symmetric stack). Serves CI smoke tests, tire-kickers, and lowest-friction self-hosters. Loaded as an `optionalDependency` via dynamic `import()` only when `provider === 'local'`, so `gemini`/`stub` deployments neither bloat nor break on install.
- **`openai-compatible`** — an HTTP client for any OpenAI-style `POST /v1/embeddings` endpoint, configured by `EMBEDDINGS_BASE_URL` + `EMBEDDINGS_MODEL` (+ optional `EMBEDDINGS_API_KEY` bearer). Serves self-hosters who want a stronger model through the local-LLM tooling they already run (llama.cpp, LM Studio, Ollama, TEI — all expose `/v1/embeddings`).

Together these satisfy "2+ models supported": a zero-config built-in model **and** an arbitrary SOTA model via the operator's own harness.

### 2. Zero-pad into `halfvec(3072)` — no schema migration (Phase 1)

A local model's native dimension `d` (usually 384) is fit to 3072 by a single central helper, `fitTo3072(v)`, applied at the provider seam (one behavior, one place, per [`18912fbd`](https://www.soup.net/traces/18912fbd)):

- `d < 3072` → **append zeros**.
- `d > 3072` → `slice(0, 3072)` then L2-renormalize (Matryoshka/MRL truncation; only 4096-class models need this).
- `d === 3072` → return as-is.

**Why zero-padding is lossless — the isometric-embedding argument.** For any two `d`-dim vectors `a`, `b`, zero-pad both to `a' = [a, 0…0]`, `b' = [b, 0…0]` in ℝ^3072. Then:

- **Dot product** `a'·b' = Σᵢ aᵢbᵢ + Σ (0·0) = a·b` — the appended coordinates contribute nothing.
- **Norms** `‖a'‖ = √(Σ aᵢ² + Σ 0²) = ‖a‖`, likewise `‖b'‖ = ‖b‖`.
- **Cosine** `a'·b' / (‖a'‖‖b'‖) = a·b / (‖a‖‖b‖)` — **exactly** equal to the `d`-dim cosine.
- **L2 distance and inner product** are preserved by the same argument.

So the map `ℝ^d → ℝ^3072` by zero-padding is an isometry onto a `d`-dimensional subspace: every distance and angle the index cares about is preserved exactly. `0.0` is exact in fp16, so `halfvec` quantization of the padded tail adds no error. **The HNSW graph built on padded vectors is structurally identical to one built in ℝ^d — nearest-neighbor results are correct, with no recall loss.** Both the stored trace vector and the query vector go through the same `fitTo3072`, so the padding is symmetric and the invariant holds end to end.

Consequently **Phase 1 fits every local vector into the existing column and index with no new column and no DDL.** This mirrors the `stub` provider (already 3072-dim) and matches the "choose the in-between, shaped to grow" process ([`e6ae8966`](https://www.soup.net/traces/e6ae8966)); the stored column stays the widest common denominator ([`a845d9ee`](https://www.soup.net/traces/a845d9ee)).

**Exit criterion (the "shaped to grow" part).** Zero-padding a 384-dim vector to 3072 costs ~8× the storage (~6 KB/row) and distance flops of a native 384-dim column. For the target personas (dozens to low-thousands of rows) that is ~10 MB and a few milliseconds — negligible. It does **not** foreclose the efficient path: the `halfvec3072` `customType` is localized in `packages/db/src/schema/vectors.ts`. **If a local-model corpus grows past the point where its padded vectors fit the Postgres buffer-cache tier** (the moment the 8× waste starts causing cache eviction / disk reads on the hot search path), promote the column dimension to an env-driven `customType` parameter and re-embed. Until that threshold, padding is strictly the simpler choice.

### 3. `model_id` becomes provider-derived

Introduce `getEmbeddingModelId(): string`, replacing the hardcoded const/literal in all four call sites:

- `gemini` → `"gemini-embedding-2-preview"`
- `stub` → `"stub-embeddings"`
- `local` → `` `local:${EMBEDDINGS_MODEL}` `` (e.g. `local:bge-small-en-v1.5`)
- `openai-compatible` → `` `oai:${EMBEDDINGS_MODEL}` ``

`model_id` is part of the content-addressed cache key and the `(chunk, model, task_type)` unique constraint, so deriving it per provider makes both cache and search naturally model-scoped. A fail-safe filter (`AND ev.model_id = getEmbeddingModelId()`) is added to both search predicate blocks: after a provider switch on an un-re-embedded corpus, search returns **nothing** (the correct "you must re-embed" signal) rather than silently ranking vectors from an incomparable semantic space.

### 4. One embedding provider per deployment

Vectors from different models occupy different semantic spaces and are never mixed within one corpus. Switching provider or model requires re-embedding the corpus. This was already true conceptually for `stub`→`gemini`, is enforced row-wise by the `model_id` unique-key component, and the corpus-import backlog item already assumes re-embedding on import.

---

## Alternatives considered

**A. Dimension-configurable schema — add a native `halfvec(384)` column (or make the dimension an env-driven `customType` now).** Stores local vectors at their native width, no 8× waste. **Rejected for Phase 1:** it front-loads a schema migration, a second HNSW index, and dimension-routing logic in the search path to buy storage/latency wins that don't matter at the target corpus sizes. The zero-pad exit criterion keeps this path open for exactly the moment it starts to pay — shaped to grow, not a trap ([`e6ae8966`](https://www.soup.net/traces/e6ae8966)).

**B. Keep the stub as the only keyless option.** Zero new code. **Rejected:** the stub's random vectors prove the plumbing but return meaningless rankings, so it cannot answer "does semantic search actually work on my deployment?" — the exact question the three keyless personas have.

**C. One provider only — either just `local` or just `openai-compatible`.** Simpler surface. **Rejected:** the two serve different needs. `local` is the zero-config, download-once, no-service path (CI, tire-kickers); `openai-compatible` is the "I already run llama.cpp and want a SOTA model" path (self-hosters). Shipping both, behind one seam, is a small surface-area addition (two client modules + two `selectProvider` branches) for two distinct personas.

**D. Reuse `model_id='gemini-embedding-2-preview'` for local vectors to avoid touching four files.** **Rejected outright:** `model_id` is part of the content-hash cache key, so a provider switch would return another model's vector for the same content — the cross-consumer poisoning [`18912fbd`](https://www.soup.net/traces/18912fbd) is explicitly about. The `getEmbeddingModelId()` decoupling is not optional cleanup; it is what makes local providers correct.

---

## Consequences

### Positive

- **Full stack runs with no external API.** `EMBEDDINGS_PROVIDER=local` on a fresh DB with no Gemini key gives real semantically-ranked checks in-process. Removes the last hard third-party dependency for the core check path.
- **No schema migration in Phase 1.** The isometry means the existing `halfvec(3072)` column and HNSW index serve local vectors correctly. Nothing to migrate, nothing to roll back at the DB level.
- **A genuine non-stub CI smoke test.** CI can embed a query, a paraphrase, and an unrelated sentence and assert `cosine(query, paraphrase) > cosine(query, unrelated)` — the semantic-similarity assertion the stub can't make.
- **Cache and search become model-scoped by construction.** Deriving `model_id` per provider closes the pre-existing inconsistency where `search-pipeline.ts` filtered `vc.model_id` but the search services didn't.
- **Self-hoster SOTA path.** `openai-compatible` reaches any `/v1/embeddings` model the operator already serves, with no Soup.net-side model integration work.

### Negative / Risks

- **8× storage/flops for small-dim local models.** ~6 KB/row for a padded 384-dim vector vs ~0.75 KB native. Negligible at target sizes; bounded by the buffer-cache exit criterion, at which point the schema promotes to a native dimension.
- **Provider switch on a populated corpus returns empty until re-embedded.** This is intended (fail-safe over silently-wrong rankings), but an operator who flips `EMBEDDINGS_PROVIDER` without re-embedding will see "no results" and must know the re-embed step. Documented in the self-hoster note and this ADR.
- **`local` changes the Docker image for every provider.** `onnxruntime-node` ships glibc-only prebuilt binaries, so **all** stages move from `node:24-alpine` to `node:24-slim` (Debian) — not just the runner — because `node_modules` is built in `deps`/`builder` and copied wholesale into `runner`, so the native addon must be produced on glibc. We ship **one provider-agnostic image**: the optional dependency is installed and the default model is baked unconditionally, so `gemini`/`stub` images also carry `@huggingface/transformers` + `onnxruntime-node` (~100–300 MB) and the ~23 MB baked weights even though they never load them. The dynamic-import gating still means `gemini`/`stub` never *execute* that code (no runtime cost), only the image is larger. Trimming the hosted (gemini) image via a conditional bake or provider-specific image variants is a deferred operator decision (backlog).
- **In-process CPU inference shares the backend process.** The `local` pipeline competes with the in-process pg-boss consumers (ADR-0020) for CPU. Thread count is capped to avoid oversubscription; heavy embedding load on a small task is a tuning concern, not a correctness one.

### Neutral

- **Symmetric stack, no prefix logic.** Because the pipeline only generates the symmetric `SEMANTIC_SIMILARITY` treatment (Gemini ignores `task_type` — see ADR-0005 §Known issues), both stored and query text go through the same `embedQuery`, so no asymmetric query/passage prefix is introduced. A small per-model prefix table defaults to no prefix.
- **`stub` stays the CI gate.** The deterministic, download-free stub remains the default gate; the real `local` smoke test is an opt-in env-gated job.
- **Local models are text-only.** `embedMultimodal` folds file parts into text exactly as the stub does; multimodal embeddings remain a `gemini`-only capability.

---

## Rollback

Phase 1 touches no schema, so there is nothing to migrate back. To disable the feature entirely, keep `EMBEDDINGS_PROVIDER` on `gemini` or `stub` — the new branches are never taken and the new client modules are never imported. Reverting the code is a straight deletion of the two client modules and the two `selectProvider` branches; `getEmbeddingModelId()` and the fail-safe `model_id` filter are correctness improvements worth keeping even if the local providers are removed. The `node:24-slim` base change (all stages) is independent and harmless to retain, though reverting to Alpine would be needed to shed the image-size cost if the local providers are dropped entirely.

---

## Implementation notes

The phase plan, model recommendations, testability matrix, and acceptance sketch live in [`docs/planning/local-embedding-provider.md`](../planning/local-embedding-provider.md). The operator-facing on-ramp (discoverable) is the "Local / offline embeddings" section of the top-level `README.md`; this summary is co-located here for reference.

Self-hoster `openai-compatible` harness setup (verify exact flags/ports at run time — llama.cpp moves fast):

- **llama.cpp (`llama-server`)** — `llama-server -m <model>.gguf --embedding --pooling mean --port 8080`, then `EMBEDDINGS_BASE_URL=http://localhost:8080/v1` + `EMBEDDINGS_MODEL=<id the server reports>`. Note the model's required `--pooling` (mean vs cls differs per model). No API key by default.
- **LM Studio** — load an embedding GGUF, Developer → Start Server, then `EMBEDDINGS_BASE_URL=http://localhost:1234/v1` + `EMBEDDINGS_MODEL=<model shown>`.
- **Ollama** (alternative) — `ollama pull nomic-embed-text`, then `EMBEDDINGS_BASE_URL=http://localhost:11434/v1` + `EMBEDDINGS_MODEL=nomic-embed-text`.
- **TEI** (alternative) — `text-embeddings-router --model-id BAAI/bge-large-en-v1.5`, then point at its `/v1` base URL.

The model's native dimension must be ≤ 3072 (or MRL-capable) so `fitTo3072` stores it without lossy truncation. When Soup.net runs in its own container, `localhost` in these URLs refers to the container — use `host.docker.internal` (Docker Desktop) or the host IP / a shared Docker network for a harness on the host or a sibling container.

---

## Related

- **Extends ADR-0005** (Embedding model selection) — adds providers/models behind the same seam; the single-model-per-deployment assumption is inherited, not changed. Supersedes nothing.
- **Builds on ADR-0020** (Unified embedding service) — the in-process worker and the single provider seam this ADR extends.
- Planning doc: [`docs/planning/local-embedding-provider.md`](../planning/local-embedding-provider.md).
- Decision traces: [`e1bd9b8e`](https://www.soup.net/traces/e1bd9b8e) (zero-pad vs migrate), [`cd1545d9`](https://www.soup.net/traces/cd1545d9) (4-table pipeline built for multiple models behind a clean interface), [`18912fbd`](https://www.soup.net/traces/18912fbd) (one behavior in one place / cross-consumer drift prevention), and the reinforcing [`e6ae8966`](https://www.soup.net/traces/e6ae8966) / [`a845d9ee`](https://www.soup.net/traces/a845d9ee).
