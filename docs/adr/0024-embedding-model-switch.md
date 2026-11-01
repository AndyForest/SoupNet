# ADR-0024: Changing the embedding model is a setting and a rebuild

**Date:** 2026-11-01
**Status:** Proposed

---

## Goal

"It should just be a setting, and then all the vectors rebuild", with search working throughout.

The hosted service runs on `gemini-embedding-2-preview`, which was listed for shutdown as early as 2026-08-10 and still serves. Google doesn't promise that preview and GA (`gemini-embedding-2`) vectors match, so the move is a real rebuild under a new `model_id`, even though every comparison so far was identical. Before this, the id was a constant in three files, `EMBEDDINGS_MODEL` was ignored for `gemini`, and changing the constant gave an HTTP 200 with zero results.

## Decision

**Two settings, read through one path (`lib/embeddings/provider.ts`).**

| Setting | Meaning |
|---|---|
| `EMBEDDINGS_MODEL` | The model search reads and `/check` embeds with. Optional for `gemini`: see below. A value is checked against a known list, and an unknown one stops the process at start. |
| `EMBEDDINGS_REBUILD_TARGET` | A second model to keep a complete set of vectors for. Empty means none. |
| `EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE` | The rebuild's pace across all tasks. Default 600. `0` pauses. |

**Unset, the database says which model.** Upgrading with no new variable has to keep working and can't silently flip. So with `EMBEDDINGS_MODEL` unset on `gemini`, each process decides once, after migrations and before anything reads or embeds, and logs `[embedding-model] read model=<id> source=database reason="<why>"`. It looks only at which `gemini-*` models hold complete vectors, never how many, because a partial rebuild can outnumber the model reads are on:

| Database holds | Target | Reads |
|---|---|---|
| Vectors under one model | none | That model |
| Vectors under two models | one of them | The other one, whichever has more |
| Vectors under two models | none | **Refuses to start**: either could be a partial rebuild |
| Vectors only under the target | that model | **Refuses to start** |
| Vectors only under a model this code doesn't run | any | **Refuses to start** |
| No vectors, one known model in `vector_cache` | any other | That model, so a stack that reset its corpus keeps its paid-for vectors |
| No vectors, otherwise | not `gemini-embedding-2` | `gemini-embedding-2`, the recommended model |
| No vectors, otherwise | `gemini-embedding-2` | **Refuses to start** |

Tasks in a rolling deploy agree. The answer changes only through something an operator did: setting or removing a target, or pruning a model. A task that has started keeps its answer until it exits, and a new task reaching a different answer is the same overlap as an explicit flip, which both tasks answer in full. If two models are present and the target has been removed, the new task refuses and the old ones keep serving. No answer is stored, so there's nothing to drift from the database.

If the lookup fails, the process exits with the cause instead of using a default, since a default after a failed lookup is how reads change model unnoticed. It can't serve without that database anyway. A set value doesn't look anything up.

Flipping needs the setting: reads move only when `EMBEDDINGS_MODEL` names the new model or the target names the old one. Refusing can stop a replacement task on a stack with two models and no target, which is an outage if every old task is gone too. That's the cost of not guessing, it's loud, and the message names the fix. A stack that runs a rebuild should keep `EMBEDDINGS_MODEL` set until the old model is pruned.

**One rule does the rebuild, the catch-up and the flip back.** Every minute, the sweep adds pending rows for chunks missing a row under an active model, the read model first, within the budget. Rows still in flight count against it. New recipes get rows the same way, so vectors written by either side of a deploy are caught up by whichever task runs the sweep.

**Flipping reads is swapping the two values.** `EMBEDDINGS_MODEL=new`, `EMBEDDINGS_REBUILD_TARGET=old`. Search filters on the read id alone, so old and new tasks both give complete answers during a rolling deploy, and the swap keeps the old model current, so flipping back loses nothing, including recipes written since. Removing the target ends that.

**Provider failures wait; row failures fail.** A 429, a 5xx, a timeout, a bad key or a 404 from a retired model isn't the row's fault. Those rows return to pending and that model cools down fleet-wide (`system_settings`, 30 seconds doubling to 5 minutes, never less than the provider's `Retry-After`). A 400 goes down the existing split path, which isolates the refused row as `failed`. A dead rebuild target holds up only its own rows. Read-model work outranks rebuild work in the queue, and a `/check` that meets a 429 records the cooldown, which pauses the rebuild.

**Images.** A rebuild embeds an image source from its real bytes, re-applying any region of interest, after checking the file hash. If the bytes are gone (uploads live on task-local disk) or the provider isn't multimodal, the source gets a text-only vector labelled `vector_source = 'text_fallback'`, which never enters the cache, because the cache key hashes the image. The source stays in search and the fallback is counted in the progress line. An image written during the rebuild embeds for both models straight away.

**Search going silently empty is now loud.** Every process checks at boot and every 60 seconds: `[embedding-model] READ_MODEL_EMPTY` when the read id has no complete vectors while others do, `READ_MODEL_PARTIAL` when it holds under 99% of another model's. `/health/version` shows `readVectors` and the target. `/health/ready` deliberately ignores it, since replacing the task wouldn't help and a bad model would take the service down.

**`taskType` is no longer sent.** GA's documentation says it isn't supported. With and without it gave byte-identical vectors on both models for text and for an image.

**No migration.** The unique key already allows a row per model, `vector_source` is free text, and the cooldown fits `system_settings`.

## Steps

```
# 1. Deploy this code, with nothing new set. The log shows the model it found.
#    Then in a second deploy set the target. Don't set it while
#    tasks from before this code run: they'd write vectors under the old constant.
EMBEDDINGS_REBUILD_TARGET=gemini-embedding-2

# 2. Watch the log until safe_to_flip=yes, or:
npx tsx scripts/embedding-model.mts status --read gemini-embedding-2-preview --target gemini-embedding-2

# 3. Flip, by deploying the swap.
EMBEDDINGS_MODEL=gemini-embedding-2
EMBEDDINGS_REBUILD_TARGET=gemini-embedding-2-preview

# 4. Flip back at any time by deploying the swap again.

# 5. When settled, deploy with the target empty and EMBEDDINGS_MODEL still set. The
#    old rows stop being written.
EMBEDDINGS_REBUILD_TARGET=

# 6. Later, optionally, remove the old rows. Dry run unless --apply.
npx tsx scripts/embedding-model.mts prune --model gemini-embedding-2-preview --keep gemini-embedding-2
```

Log tokens worth an alarm: `READ_MODEL_EMPTY`, `READ_MODEL_PARTIAL`. Progress is `[embedding-rebuild] ... done=a/b gap=n failed= text_fallback= eta= safe_to_flip=`.

If the old model dies mid-rebuild, the rows it can't serve wait and `/check` fails on queries it can't embed. Flip to the new model if the gap is small enough to accept, or run a wire-only build that sends the new model under the old labels, which relies on a match nobody promises.

How many image sources exist, and how many have a stored file:

```sql
SELECT es.source_type,
       count(*) AS image_sources,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM claimnet.evidence_references er
         JOIN claimnet."references" r ON r.id = er.reference_id
         WHERE er.evidence_id = es.source_id AND r.file_hash IS NOT NULL
       )) AS with_file_hash
FROM claimnet.embedding_sources es
WHERE es.artifact_category = 'multimodal'
GROUP BY 1;
```

A file hash says a file existed, not that the running task can still read it. The `text_fallback` count in the rebuild's progress line is the real answer.

## Costs

**Money.** About $2 for 49,000 vectors (inferred from the published price). A real run of 335 vectors comes to under $0.02 at that price.

**Time.** About 80 minutes for 49,000 vectors at the default 600 a minute (inferred).

**`/check` during the rebuild.** Measured with the production image limited to 0.25 vCPU and 512 MB, a stubbed Gemini answering in 350 ms, and 3,400 vectors. It doesn't show how a 49,000-vector database behaves, and a local CPU isn't Fargate's.

| Budget (vectors/min) | `/check` p50 / p95 | Search p50 / p95 |
|---|---|---|
| paused | 609 / 735 ms | 526 / 643 ms |
| 300 | 662 / 818 ms | 535 / 717 ms |
| 600 | 625 / 772 ms | 540 / 680 ms |
| 1200 | 744 / 887 ms | 543 / 714 ms |

No errors in any phase, and memory stayed near 94 MB.

**Database size.** Measured on a quarter-scale copy (12,250 vectors, 1 GiB container), scaled to production's 49,000 vectors, where the index is 374 MB and the vector table 387 MB:

| Stage | Identical vectors, measured | Scaled | Different vectors, measured | Scaled |
|---|---|---|---|---|
| Before | index 96, table 98 MB | 374, 387 MB | same | same |
| Both models | index 96, table 195 MB | 374, 775 MB | index 191, table 195 MB | 750, 775 MB |
| After removal and `VACUUM` | index 96, table 195 MB | 374, 775 MB | index 191, table 195 MB | 750, 775 MB |
| After `REINDEX CONCURRENTLY` | | | index 96 MB | 374 MB |
| After `VACUUM FULL` | table 98 MB | 387 MB | | |

So expect 1.15 to 1.5 GB of vector pages on the 4 GiB instance while both models exist, and `vector_cache` grows by about 660 MB more (13.5 KB per vector). Fitting in memory is inferred, and more of the index will come from disk. Identical vectors don't grow the index because pgvector's HNSW shares one graph element between them, so the index's size says whether GA really matched.

Removing old rows doesn't shrink anything. Autovacuum frees the pages for reuse, which is enough unless disk is tight. `REINDEX CONCURRENTLY` gets the index back without blocking; `VACUUM FULL` gets the table back and locks it against reads and writes, so it means an outage.

One filtered nearest-neighbour query took 14 ms before and after an identical rebuild, and 39 ms with both models' different vectors in the graph, since a search has to walk past the other model's entries. That's a single query, not a distribution.

## Outage

None planned. The deploys are ordinary rolling ones. A deploy with a bad value, or two models and nothing to choose between them, crashes the new task and the old one keeps serving.

## Rollback

Before step 5, swap the values back: nothing is lost. After step 5, set the old model as the target again and let the catch-up run before flipping. After step 6, the old model needs a full rebuild, if it still serves, and any image whose bytes are gone stays text only: the prune's warning counts those.

The code itself can be reverted while reads are on the old constant's model. It can't be reverted after the flip without first flipping back.

## Alternatives considered

- **Requiring `EMBEDDINGS_MODEL`**, which was this ADR's first draft. It's the most explicit, and it breaks every existing stack on upgrade until someone sets a variable that says what the database already shows.
- **A code default for an unset model.** No lookup, and when the default changes, every stack relying on it flips silently, which is how this began.
- **Choosing the model with the most vectors, or the oldest rows.** Stable-looking, and each picks wrong in a real state: most flips on an overtaking rebuild, and oldest flips back after a flip whose old rows aren't pruned yet.
- **Recording the chosen model in the database at first start.** It would answer the two-model case, with a second source of truth that disagrees with the setting after an explicit flip.
- **A pointer in the database that operators flip**, instead of an environment variable. It would flip without a deploy, but every process would need to re-read it, a process's cache and wire would need to agree mid-request, and a wrong value would have no start-time check. Env is what the rest of the configuration uses.
- **A new column, or a shadow table, for the new model.** The existing key already separates models, and a shadow table doubles the code that reads vectors.
- **Relabelling rows, on the strength of the identical comparisons.** Free and instant, and it depends on a promise Google hasn't made. It remains as the emergency fallback, as a separate held build.
- **Pausing search during a batch re-embed.** Cheaper to write, and search empty for an hour or two is the failure this exists to prevent.
- **Dropping fallback sources until their bytes return.** It keeps the vector honest but removes the recipe from search, for bytes that won't return.

## Known limits

- `openai-compatible` runs both models on one endpoint and one key. During a rolling deploy with differing configuration, a task handed a row for a model it isn't configured for treats that as a row failure.
- `local` and `stub` can't have a target: `local` loads one model into memory.
- Changing provider isn't covered, since two providers would need two sets of credentials and clients.
- Old image vectors are the only record of an image once its bytes are gone. Moving uploads to object storage would end this; see the backlog.
