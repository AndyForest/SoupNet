# Local Embedding Cache Archive

A long-lived local copy of the embedding cache, so the vectors you paid a provider for outlive the development and test databases they were made in. It's for keeping a copy of the vectors from databases you run yourself.

---

## Why

`claimnet.vector_cache` maps (content hash, model, task type) to a full-precision `vector(3072)`. A check or an import whose text is already in the cache reuses the vector instead of calling the embedding provider. Deleting recipes never touches the cache. Dropping a database does, and development databases get dropped: a `docker compose down -v`, a scratch database for a worktree, a benchmark database rebuilt from scratch. This archive keeps the vectors when that happens.

The cache table never changes a row once written. The app inserts with `ON CONFLICT DO NOTHING` and never updates or deletes, so an archive that only ever gains rows loses nothing the app relies on.

## Pieces

- **The cache database.** `docker-compose.embedding-cache.yml` runs Postgres with pgvector as its own compose project (`soupnet-embedding-cache`), on `127.0.0.1:5733`, with its own named volume. Tearing down the dev stack never touches it.
- **An insert-only writer.** `setup` creates the table (the same shape as the app's) and a `cache_writer` role that may only `SELECT` and `INSERT`. `setup` and `status` both prove the writer is denied `UPDATE`, `DELETE` and `TRUNCATE`.
- **Harvest.** Copies every vector a source database has and the cache lacks. It's idempotent, skips stub vectors, and checks each copied vector against its source exactly.
- **Backups.** Each backup is a `pg_dump` of the table, the sorted list of its keys, and a manifest (row counts per model, checksums, versions). The dump and the key list are read from one snapshot, so the list describes exactly the rows in the dump.
- **Verify and prune.** Before an old backup is deleted, the newest must:
  - match its checksums;
  - be readable by `pg_restore`;
  - still hold every key of the backup before it.

  The cache only grows, so any missing key stops the prune.
- **Restoring.** A backup is a dump of the one table, without its schema. Restore onto a server where `setup` has run: `pg_restore --data-only --no-owner --no-privileges`. That works into the cache database, or into a dev database's own `claimnet.vector_cache` to start it warm.
- **Restore test.** Restores the newest backup into a scratch database. It compares every key against the key list, and a sample of vectors against the live cache, value for value.

## Use

```bash
docker compose -f docker-compose.embedding-cache.yml up -d
npx tsx scripts/embedding-cache.mts setup

# Before dropping a database, copy its vectors in:
npx tsx scripts/embedding-cache.mts harvest --from postgresql://claimnet:claimnet@localhost:5633/claimnet

npx tsx scripts/embedding-cache.mts status
```

Backups need `EMBEDDING_CACHE_BACKUP_DIR`, with room for a little more than the table per backup:

```bash
npx tsx scripts/embedding-cache.mts backup
npx tsx scripts/embedding-cache.mts verify
npx tsx scripts/embedding-cache.mts prune --keep 3
npx tsx scripts/embedding-cache.mts restore-test      # now and then: proves a backup restores
```

`nightly` combines them for a scheduler. It harvests every source in `EMBEDDING_CACHE_SOURCES`, backs up when the newest backup is older than `--backup-every-days` (default 7), then verifies and prunes (`--keep`, default 3). It exits non-zero if anything failed.

The connection settings and their defaults are listed at the top of `scripts/embedding-cache.mts`. The defaults match the compose file.

## Things to know

- **The model is part of the key.** A vector is only reused for the same `model_id`. If a provider changes a model's output without changing its id, cached and fresh vectors stop agreeing, and nothing here can detect it.
- **The hash is part of the key.** The key is a sha256 of the exact text (plus file bytes for images). Changing how text is normalised before hashing makes the archive unreachable, though not wrong.
- **Size and time.** About 13.5 KB per vector in the table and about 15 KB per vector in a backup, because pg_dump writes vectors as compressed text. Measured on 472,644 vectors: 6.4 GB in the table, a 7.2 GB backup taking about 12 minutes, and a first harvest taking about 10 minutes.
- **Not yet: reading the cache directly.** A development backend still uses its own database's `vector_cache`. Harvest copies vectors out; nothing copies them back in. Pointing the app's cache queries at this database is a separate change (see the backlog).
