# Eval-infra reset contract — requirements from the evals workstream (2026-07-20)

**Audience**: the SoupNet implementation agent. **Author**: the evals side, at the operator's direction: *"I don't want you making code changes to the soupnet repo. I don't want you manually cleaning dbs with sql — that should be through some kind of contract like an api… How about you ask for a clean way to reset, and the soupnet agent implements that?"* (Andy, 2026-07-20). This brief is that ask. Requirements only — design and implementation are yours.

## 1. First, a retraction: the "cascade delete gap" was ours, not yours

The evals side reported phantom retrieval hits (deleted recipes still served by MMR search) and initially flagged a possible product bug. Read-only code review settled it: **your deletion paths are complete.** `trace-delete.service.ts` removes the full embedding chain (sources → strategies → chunks → vectors) transactionally with the sweep/delete race locked out; `user-delete.service.ts` routes all teardown through it and its header already records — and fixes — the exact drift failure we hypothesized. The phantoms were caused by the evals side deleting traces with raw SQL, bypassing your service layer. The operator has now barred eval-side write-SQL entirely (read-only investigation stays allowed); this contract is what replaces it.

Residue to be healed: the gate store (`soupnet-freplay-gate`, :3104) currently holds ~476 orphaned trace-type embedding sources + 68 orphaned evidence rows from that raw-SQL purge — damage your per-trace API can't reach (no trace left to delete through). Item 2b below covers it.

## 2. Requested contracts, priority-ordered

**(a) Purge a recipe book** — empty a book's contents (traces + the full per-trace cascade you already implement) while **preserving the book row, its slug, and every api-key scope binding**. Rationale: benchmark runs need "reset to clean" between every run (a fidelity-gate sim's own deposits provably contaminate the next run's retrieval); deleting the *book* would break stored key scopes and force re-minting, which is the expensive part on a headless stack. Response should return per-layer deleted counts (traces / evidence / references / embedding sources / chunks / vectors) so a runner can assert completeness without SQL. Bulk (one call per book), audited like `DELETE /traces/:id`.

**(b) Retrieval-index integrity: check (read) + repair (admin)** — (b1) a read-only endpoint reporting orphaned embedding rows (sources whose `(source_type, source_id)` no longer resolves) per book/user, for run-validity gates; (b2) an admin repair that sweeps them. Rationale: the polymorphic reference can't FK-cascade by construction, so orphans are always *possible* (crashed imports, external tampering, our past sins); a validity gate needs to prove index-consistency cheaply, and the current gate store needs the one-time heal.

**(c) Import with exclusion list** — import an export minus a supplied set of trace ids. Rationale: held-out evaluation stores ("FULL-minus-20") currently exist only as fossilized docker volumes — the reason a second stack exists at all. With (a)+(c), a held-out store becomes *a book on the shared stack, rebuilt from the canonical export on demand*, and the second stack retires.

**(d) Version introspection on `/health`** (or a sibling) — git commit, `RANKING_ALGORITHM_VERSION`, migration head (count + latest id), embeddings provider + model id. Rationale: the operator's direct concern — *"is this a real bug or an old bug in a stale postgres db? … that's hard for me to verify."* One GET should answer "is this stack stale" for humans and agents alike. (Checks already echo `data.ranking`; this extends the same self-description to the infra level.)

**(e) Vector-cache sync** — export/import of `vector_cache` rows keyed by `(content_hash, model_id, task_type)`, dedup on conflict — a CLI or endpoint contract replacing ad-hoc `pg_dump` (mechanism proven by the ~511 MB `rankeval_p6` dump; the paid gemini vectors are an asset both sides reuse). Rationale: one shared benchmark stack still needs cheap re-warming from the dev db's cache after resets or fresh imports.

**(f) Headless key lifecycle** — mint/renew scoped api keys via CLI or admin API (no browser login), and expiry visibility (expiresAt in auth-probe responses; a 4xx that names expiry as the cause). Rationale: a silently expired key cost a full stack-provisioning round before anyone learned expiry was the issue; renewal required operator SQL — the class of intervention this contract exists to end.

(Items (d)–(f) restate `SoupNet-evals/evals/hygiene-gap-report.md` items 1–4 with this week's added evidence; (a) sharpens its item 7 now that per-trace deletion is confirmed complete product-side.)

## 3. What this enables: one benchmark stack

Once (a)–(c) exist, the evals side consolidates to **a single benchmark stack** (pinned image, explicitly tagged, bumped only between runs): the held-out gate corpus becomes a rebuildable book beside the FULL books, isolation stays key-scoped (already proven with three accounts on the uni stack), and the container inventory the operator flagged shrinks to one stack plus its postgres. `deleteUserCascade` (existing) covers whole-arm teardown; (a) covers between-run resets; (b1) becomes a standard pre-run validity gate.

## 4. The evals side's half of the seam (already in force)

No code changes in this repo; no write-SQL against any database — resets and teardown only through these contracts once they exist (interim: the operator runs any remaining manual cleanup himself); read-only SQL for investigation and reports only; every run ledgers its deposits; retrieval-layer validity gates before every scored run.

---

*Restoration note (2026-07-21, SoupNet implementation agent): this file was delivered by the evals workstream as an untracked file and was lost from the working tree before ever being committed; restored verbatim from the implementation side's read of 2026-07-20 so that [eval-reset-contract-response.md](eval-reset-contract-response.md)'s references resolve. The response doc is the ruled design; this document is the requirements record it answers.*
