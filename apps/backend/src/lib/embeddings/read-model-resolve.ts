/**
 * Which model search reads when EMBEDDINGS_MODEL is unset on gemini (ADR-0024).
 *
 * An upgrade with no new variable has to keep working and must not silently flip
 * reads, so the answer comes from what the database already holds, and never from
 * how much of it there is: a partial rebuild can outnumber the model reads are on.
 * Each process decides once, at start, and keeps that answer until it exits. When
 * the database can't settle it, or can't be read, the process refuses to start.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  GEMINI_MODELS,
  RECOMMENDED_GEMINI_MODEL,
  getEmbeddingProviderId,
  getRebuildTargetModelId,
  setResolvedGeminiReadModel,
} from "./provider";

export interface ReadModelEvidence {
  /** Every gemini-* model_id with complete vectors, known to this code or not. */
  vectorModels: string[];
  /** Models in vector_cache. A stack that reset its corpus keeps these. */
  cachedModels: string[];
  target: string | null;
}

const SET_IT = "Set EMBEDDINGS_MODEL to the model search should read.";

/** The rule itself. Throws when the evidence doesn't settle it. */
export function chooseGeminiReadModel({
  vectorModels,
  cachedModels,
  target,
}: ReadModelEvidence): { modelId: string; why: string } {
  const known = vectorModels.filter((m) => GEMINI_MODELS.has(m));
  const held = known.filter((m) => m !== target);

  if (held.length === 1) {
    return {
      modelId: held[0]!,
      why: target
        ? `the only model with vectors other than the rebuild target ${target}`
        : "the only model with vectors",
    };
  }
  if (held.length > 1) {
    throw new Error(
      `EMBEDDINGS_MODEL is unset and vectors exist under ${known.join(" and ")}. Refusing to guess, because ` +
        `either could be a partial rebuild. ${SET_IT} To resume a rebuild, set EMBEDDINGS_REBUILD_TARGET to the ` +
        "model being rebuilt instead.",
    );
  }
  if (known.length > 0) {
    throw new Error(
      `EMBEDDINGS_MODEL is unset and the only vectors are under the rebuild target ${target}, so reads have no ` +
        `other model to stay on. ${SET_IT}`,
    );
  }
  if (vectorModels.length > 0) {
    throw new Error(
      `EMBEDDINGS_MODEL is unset and the only Gemini vectors are under ${vectorModels.join(" and ")}, which this ` +
        `code doesn't run. Refusing to guess. ${SET_IT}`,
    );
  }

  const cached = cachedModels.filter((m) => GEMINI_MODELS.has(m) && m !== target);
  if (cached.length === 1) {
    return { modelId: cached[0]!, why: "no vectors yet, and the only model in vector_cache" };
  }
  if (RECOMMENDED_GEMINI_MODEL === target) {
    throw new Error(
      `EMBEDDINGS_MODEL is unset, the database holds no vectors, and the rebuild target is the recommended model ` +
        `${target}. ${SET_IT}`,
    );
  }
  return { modelId: RECOMMENDED_GEMINI_MODEL, why: "no vectors yet, so the recommended model" };
}

async function readEvidence(db: PostgresJsDatabase): Promise<Omit<ReadModelEvidence, "target">> {
  const vectors = await db.execute(sql`
    SELECT DISTINCT model_id FROM claimnet.embedding_vectors
    WHERE status = 'complete' AND model_id LIKE 'gemini-%'
  `);
  const cache = await db.execute(sql`
    SELECT DISTINCT model_id FROM claimnet.vector_cache WHERE model_id LIKE 'gemini-%'
  `);
  const ids = (rows: Iterable<Record<string, unknown>>) => [...rows].map((r) => String(r["model_id"]));
  return { vectorModels: ids(vectors), cachedModels: ids(cache) };
}

/**
 * Settle the read model for this process. Call once after migrations, before anything
 * reads or embeds. Logs the id and why, and throws rather than falling back: a default
 * after a failed lookup is how reads silently change model.
 */
export async function resolveEmbeddingReadModel(db: PostgresJsDatabase): Promise<void> {
  const unset = !(process.env["EMBEDDINGS_MODEL"] ?? "").trim();
  if (getEmbeddingProviderId() !== "gemini" || !unset) {
    console.warn("[embedding-model] read model source=setting");
    return;
  }
  let evidence: Omit<ReadModelEvidence, "target">;
  try {
    evidence = await readEvidence(db);
  } catch (err) {
    throw new Error(
      `EMBEDDINGS_MODEL is unset and the database could not be read to find the model in use, so this process ` +
        `won't start on a guess. ${SET_IT} Cause: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const { modelId, why } = chooseGeminiReadModel({ ...evidence, target: getRebuildTargetModelId() });
  setResolvedGeminiReadModel(modelId);
  console.warn(`[embedding-model] read model=${modelId} source=database reason="${why}"`);
}
