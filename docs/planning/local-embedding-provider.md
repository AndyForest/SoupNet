# Local embedding provider — implementation briefing

**Purpose of this doc**: operator-approved build brief (2026-07-08) for adding local / self-hosted
embedding providers to Soup.net, for the implementing agent. Motivation: give the three keyless
personas (headless CI, self-hosters, tire-kickers) a working vector-search path without a Gemini key.
Decision provenance: recipe trace [`e1bd9b8e`](https://www.soup.net/traces/e1bd9b8e) (zero-pad-vs-migrate
call), reinforced by [`e6ae8966`](https://www.soup.net/traces/e6ae8966) (choose the in-between, shaped
to grow), [`cd1545d9`](https://www.soup.net/traces/cd1545d9) (pipeline designed for multiple models),
[`18912fbd`](https://www.soup.net/traces/18912fbd) (one behavior, one place), and
[`a845d9ee`](https://www.soup.net/traces/a845d9ee) (stored column stays the widest common denominator).
Nearby docs: `docs/adr/0005-embedding-models.md`, `docs/adr/0020-unified-embedding-service.md`,
`docs/backlog.md` (Data portability / corpus-import re-embedding).

## The two providers, and who each serves

This adds **two** new `EMBEDDINGS_PROVIDER` values behind the existing provider seam:

- **`local`** — an in-process CPU model via `@huggingface/transformers` (ONNX). Zero external service,
  zero API key, one env var. Serves **persona 1 (CI smoke test)** and **persona 3 (tire-kicker)**, and
  any **self-hoster** who wants the lowest-friction option. Default model **`bge-small-en-v1.5`**.
- **`openai-compatible`** — an HTTP client for any OpenAI-style `/v1/embeddings` endpoint, configured
  by `EMBEDDINGS_BASE_URL` + `EMBEDDINGS_MODEL`. Serves **persona 2 (self-hoster)** who wants a
  stronger/SOTA model through the local-LLM tooling they already run: **llama.cpp** (`llama-server`)
  and **LM Studio** are the two we document first (a target self-hoster runs `llama.cpp` directly for
  full configurability); **Ollama** and **Hugging Face text-embeddings-inference (TEI)** work
  identically and are documented as alternatives. All expose `/v1/embeddings`.

This satisfies "2+ models supported": a very easy built-in one (bge-small / MiniLM) **and** an
arbitrary SOTA model via the user's own harness. Both existing providers (`gemini`, `stub`) are
untouched.

### Self-hoster harness setup (`openai-compatible`)

The provider is harness-agnostic — it only needs a base URL and a model id. Document these concrete
setups (**verify exact flags/ports at implementation time** — llama.cpp in particular moves fast):

- **llama.cpp (`llama-server`)** — the primary target self-hoster's choice; full configurability, and
  Fedora packages it in Docker so no local build is needed. Serve a GGUF embedding model with the
  embedding endpoint enabled, e.g. `llama-server -m bge-small-en-v1.5-q8_0.gguf --embedding
  --pooling mean --port 8080`, then set `EMBEDDINGS_BASE_URL=http://localhost:8080/v1` +
  `EMBEDDINGS_MODEL=<the id the server reports>`. Note the model's required `--pooling` (mean vs cls
  differs per model). No API key by default (`EMBEDDINGS_API_KEY` unset).
- **LM Studio** — load an embedding model (GGUF), start the local server (Developer → Start Server),
  then `EMBEDDINGS_BASE_URL=http://localhost:1234/v1` + `EMBEDDINGS_MODEL=<model shown in LM Studio>`.
- **Ollama** (alternative) — `ollama pull nomic-embed-text`, then
  `EMBEDDINGS_BASE_URL=http://localhost:11434/v1` + `EMBEDDINGS_MODEL=nomic-embed-text`.
- **TEI** (alternative) — `text-embeddings-router --model-id BAAI/bge-large-en-v1.5`, then point at its
  `/v1` base URL.
- **vLLM** — supports non-GGUF formats but is built for high-concurrency serving; overkill for a
  single-user self-host. Mention as an option, don't lead with it.

Whichever harness, the model's native dimension must be ≤ 3072 (or MRL-capable) so `fitTo3072` can
store it — see Model recommendations. When Soup.net runs in its own container, `localhost` in these
URLs refers to the container, not the host: document `host.docker.internal` (Docker Desktop) or the
host IP / a shared Docker network for a harness running on the host or a sibling container.

**Assumption — one embedding provider per deployment.** Vectors from different models occupy different
semantic spaces and are never mixed within one corpus. Switching providers/models requires
re-embedding the corpus (already true conceptually for `stub`→`gemini`, and the corpus-import backlog
item already assumes re-embedding on import).

## The zero-migration insight (why Phase 1 touches no schema)

The searchable column is `halfvec(3072)` with a single HNSW index (`halfvec_cosine_ops`). A 384-dim
model can't be stored there natively — but **zero-padding to 3072 is an isometric embedding**: for
padded vectors `a' = [a, 0…0]`, `b' = [b, 0…0]`, the dot product, both norms, cosine, L2, and inner
product are all **exactly equal** to their d-dim values (appended zeros contribute nothing; `0.0` is
exact in fp16, so halfvec quantization adds no error). The HNSW graph built on padded vectors is
structurally identical to one built in ℝ^d — nearest-neighbor results are correct, no recall loss.

So **Phase 1 fits every local vector into the existing `halfvec(3072)` column and index — no migration,
no new column, no DDL.** This mirrors the `stub` provider (which already emits 3072-dim) and matches
the operator's documented "choose the in-between, shaped to grow" process (`e6ae8966`).

**The fit rule** (one helper, `apps/backend/src/lib/embeddings/dims.ts`, `fitTo3072(v: number[])`):
- `d < 3072` → append zeros (norm unchanged; lossless for cosine).
- `d > 3072` → `slice(0, 3072)` then L2-renormalize (Matryoshka/MRL truncation; only the 4096-class
  models like Qwen3-8B need this).
- `d === 3072` → return as-is.

**Tradeoff, stated honestly:** a 384-dim vector padded to 3072 costs ~8× the storage (6 KB/row) and
distance flops of a native 384-dim column. For the target personas (dozens to low-thousands of rows)
that's ~10 MB and a few ms — negligible. Zero-pad does **not** foreclose the efficient path: the
`halfvec3072` `customType` is localized in `packages/db/src/schema/vectors.ts`, so making the dimension
env-configurable later is a contained change. **Exit criterion (record in the ADR):** if a local-model
corpus grows past the DB buffer-cache tier, promote the column dimension to an env-driven `customType`
parameter. Shaped-to-grow, not a trap.

## Model recommendations

**Built-in (`local`) default: `bge-small-en-v1.5`** — 384-dim, ~same size/speed as MiniLM, meaningfully
higher retrieval quality (~62 vs ~56 MTEB). Because this stack only generates the symmetric
`SEMANTIC_SIMILARITY` task type (see the known-bug note in `enqueue.ts` — Gemini ignores task_type, so
only one is produced), bge-small needs **no query/passage prefix** and drops in cleanly.
**`all-MiniLM-L6-v2`** stays available as the most-compatible/most-proven fallback — a one-line
`EMBEDDINGS_MODEL` swap (both 384-dim, both fit natively). *Confirm exact ONNX repo ids at
implementation time* (`Xenova/*` vs `onnx-community/*` under transformers.js v3).

**Self-hoster SOTA options via `openai-compatible`** (all fit; prefer native dim ≤ 3072 so no
truncation is needed):
- `nomic-embed-text-v1.5` — 768-dim, the de-facto **Ollama** default (`ollama pull nomic-embed-text`).
- `mxbai-embed-large-v1` — 1024-dim.
- `bge-large-en-v1.5` — 1024-dim.
- `Qwen3-Embedding` — 0.6B→1024, 4B→2560 (fit natively); 8B→4096 needs MRL truncate-to-3072 (Qwen3 is
  MRL-trained, so `fitTo3072`'s truncate path handles it).

**Prefix ↔ task_type:** the stack is symmetric (both stored trace text and query recipe text go through
the same `embedQuery`), so asymmetric query/passage prefixes don't map cleanly. Apply the **same**
treatment to both sides — a symmetric prefix or none. Keep a small per-model prefix table in the local
client keyed on model id, defaulting to no prefix. Do **not** build RETRIEVAL_QUERY-vs-DOCUMENT logic
unless the stack re-introduces the task-type distinction (re-add path already documented in
`enqueue.ts`).

## Implementation

### 1. Provider seam — `apps/backend/src/lib/embeddings/provider.ts`

- Extend the union: `EmbeddingProviderId = "gemini" | "stub" | "local" | "openai-compatible"`.
- Add `local` + `openai-compatible` branches to `selectProvider()` (update the else-throw message).
- Mirror `synthesis/provider.ts` for two new memoized env accessors: `embeddingModel()`
  (`EMBEDDINGS_MODEL` ?? per-provider default) and `embeddingBaseUrl()` (`EMBEDDINGS_BASE_URL`,
  `openai-compatible` only; optional `EMBEDDINGS_API_KEY` bearer).
- Dispatch each of the three functions (`embedQuery`, `embedMultimodal`, `batchEmbed`) to the new
  clients. Both local models are text-only, so `embedMultimodal` folds parts into text exactly as the
  stub does (document: neither bge-small nor a generic `/v1/embeddings` is multimodal). Preserve the
  null-returning contract for `embedQuery`/`embedMultimodal` and throw-on-failure for `batchEmbed`.
- **Apply `fitTo3072` centrally at the seam** — on the dispatch return, `.map(fitTo3072)` for batch —
  **not** inside each client (one behavior, one place, per `18912fbd`). `gemini`/`stub` already emit
  3072 and are untouched.

### 2. `MODEL_ID` must become provider-derived (the real work)

Today `"gemini-embedding-2-preview"` is duplicated as a const in `provider.ts`, `enqueue.ts`,
`embedding-worker/jobs/strategy-check.ts`, and hardcoded as a **string literal in
`search-pipeline.ts` (~line 178, the `vector_cache` JOIN)**. Introduce
`getEmbeddingModelId(): string`:
- `gemini` → `"gemini-embedding-2-preview"`
- `stub` → `"stub-embeddings"`
- `local` → `` `local:${EMBEDDINGS_MODEL}` `` (e.g. `local:bge-small-en-v1.5`)
- `openai-compatible` → `` `oai:${EMBEDDINGS_MODEL}` ``

Replace the consts/literal in those four files with `getEmbeddingModelId()`. **Why mandatory:**
`model_id` is written into `embedding_vectors`/`vector_cache` and is part of the content-addressed
cache key. If a local deployment kept writing `model_id='gemini-embedding-2-preview'`, a provider
switch would return **another model's** vector for the same `content_hash` — exactly the
cross-consumer poisoning `18912fbd` warns about. Deriving the id per provider makes cache and search
naturally model-scoped.

### 3. Two new client modules (mirror `gemini-client.ts` signatures exactly)

- **`apps/backend/src/lib/embeddings/local-client.ts`** — lazy singleton
  `pipeline('feature-extraction', EMBEDDINGS_MODEL, { pooling: 'mean', normalize: true })` from
  `@huggingface/transformers` (v3 — the ONNX-runtime successor to `@xenova/transformers`; *confirm
  package name at implementation time*). Optional per-model symmetric prefix. Returns native-dim
  vectors. Warm the pipeline at boot (a dummy embed in `index.ts` startup) to move the ~0.5–2 s
  model-load off the first real request.
- **`apps/backend/src/lib/embeddings/openai-client.ts`** — `POST {EMBEDDINGS_BASE_URL}/v1/embeddings`
  with `{ input, model }`, optional bearer, `AbortSignal.timeout` like gemini; parse
  `data[].embedding`. Batch maps to array `input`.

### 4. Fail-safe search filter — `apps/backend/src/services/vector-search.service.ts`

Add `AND ev.model_id = ${getEmbeddingModelId()}` to **both** predicate blocks (`hybridSearch`'s
`searchPredicates` and `evidenceSearch`'s `WHERE`). Cross-model cosine is meaningless; after a provider
switch on an un-re-embedded corpus this makes search **fail safe (return nothing)** — the correct "you
must re-embed" signal — instead of silently ranking incomparable vectors. Cost is negligible and it
closes the existing inconsistency where `search-pipeline.ts` already filters `vc.model_id` but the
search services don't.

### 5. Runtime image + dependency — `apps/backend/Dockerfile`

The current runner is `node:24-alpine` (musl); `onnxruntime-node` ships **glibc-only** prebuilt
binaries, so native inference won't load on Alpine. **Switch the runner stage to `node:24-slim`
(Debian)** for full native CPU speed (operator decision this session). Notes:
- Make `@huggingface/transformers` an **`optionalDependency` loaded via dynamic `import()` only when
  `provider === 'local'`**, so `gemini`/`stub` deployments neither bloat (~100–300 MB) nor break on
  `npm ci` if the native addon is unavailable. Cap ORT thread count to avoid oversubscription with the
  in-process pg-boss consumers.
- **Model weights/offline:** first `local` run pulls ~23 MB from the HF hub to `HF_HOME`. Bake weights
  at build (`RUN node -e "import('@huggingface/transformers').then(t=>t.pipeline('feature-extraction', '<model>'))"`)
  for reproducible/offline images, and set `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` at runtime;
  document an `HF_HOME` **volume** as the alternative for users who swap `EMBEDDINGS_MODEL` without
  rebuilding. Pre-create the cache dir with `node` ownership (mirror the F51 uploads-dir pattern).

### 6. Config + docs surface

- **`.env.example`** — add `local` and `openai-compatible` to the `EMBEDDINGS_PROVIDER` enum comment;
  document `EMBEDDINGS_MODEL` (default `bge-small-en-v1.5` for `local`) and `EMBEDDINGS_BASE_URL` /
  `EMBEDDINGS_API_KEY` for `openai-compatible`, with llama.cpp / LM Studio / Ollama / TEI example base
  URLs (see the harness-setup subsection above).
- **`docker-compose.yml`** — pass the new env vars through (default `EMBEDDINGS_PROVIDER` unchanged).
- **`.github/workflows/ci.yml`** + **`scripts/test-ci-local.mjs`** — keep the gate on `stub` (see
  Testability). If a local smoke job is added, cache `HF_HOME` via `actions/cache`. Change CI FIRST,
  mirror into the local script second (per CLAUDE.md sync rule).
- **`CLAUDE.md`** and self-hoster docs — document the three-persona on-ramp and the LM Studio / Ollama /
  TEI setup for `openai-compatible`.
- **ADR** — write a new ADR (`docs/adr/` — next free number; 0022 is reserved in backlog for the OAuth
  connector flow, so coordinate) capturing: the two providers, the zero-pad-into-3072 decision with its
  math and exit criterion, and the one-model-per-deployment assumption. Supersedes nothing; extends
  ADR-0005.

## Testability

- **Keep CI's gate on `stub`** — deterministic, download-free, native-binary-free, exercises the full
  cache/pipeline/search plumbing. Do not replace it.
- **Add opt-in tests:**
  1. `fitTo3072` unit/property test — random d-dim pair; assert cosine equal before/after within fp
     tolerance, padded tail exactly zero, and the `>3072` truncate+renormalize path.
  2. Real `local` acceptance smoke test (env-gated job on the Debian image): with
     `EMBEDDINGS_PROVIDER=local`, embed a query, a paraphrase, and an unrelated sentence; assert
     `cosine(query, paraphrase) > cosine(query, unrelated)` (ordering, not exact scores) and
     `output.length === 3072` with a zero tail. This is the genuine non-stub semantic-similarity smoke
     test persona 1 wants.
  3. `openai-compatible` unit test against a mocked `/v1/embeddings` (undici mock) — no external dep.
  4. `model_id` consistency test — the value `getEmbeddingModelId()` writes to rows equals the value
     the search filter uses.

## Acceptance sketch

`EMBEDDINGS_PROVIDER=local` on a fresh DB with no Gemini key → recipes embed in-process with
bge-small-en-v1.5, vectors are 3072-long with a zero tail, and `check_recipe` returns
semantically-ranked results (paraphrase beats unrelated). `EMBEDDINGS_PROVIDER=openai-compatible` +
`EMBEDDINGS_BASE_URL=http://localhost:8080/v1` (llama.cpp `llama-server --embedding`) or
`http://localhost:1234/v1` (LM Studio) + a matching `EMBEDDINGS_MODEL` → same behavior against the
self-hoster's model. `gemini`/`stub` behavior byte-identical to today. CI
green on `stub`. Switching provider on a populated corpus returns empty results (fail-safe) until
re-embedded, not mismatched rankings.

## Non-goals (Phase 1)

- No dimension-configurable schema / per-model column (deferred behind the buffer-cache exit criterion).
- No multimodal local embeddings (local models are text-only; image parts fold to text like the stub).
- No mixing of multiple embedding models in one corpus (one provider per deployment).
- No asymmetric query/passage prefix logic (stack is symmetric).
- No auto re-embedding on provider switch (manual/backlog corpus-import path owns that).
