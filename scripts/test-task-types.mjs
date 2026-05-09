/**
 * Empirical verification: does gemini-embedding-2-preview differentiate task types?
 * Tests whether different task_type values produce different embedding vectors.
 */

import { readFileSync } from "node:fs";

// Load .env
const envText = readFileSync(".env", "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  env[t.slice(0, eq)] = t.slice(eq + 1);
}
const KEY = env.GEMINI_API_KEY;

const BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview";

async function embed(text, taskType) {
  const url = new URL(`${BASE}:embedContent`);
  url.searchParams.set("key", KEY);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-2-preview",
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: 3072,
    }),
  });
  const data = await res.json();
  if (!data.embedding?.values) {
    console.error(`Failed for ${taskType}:`, data);
    return null;
  }
  return data.embedding.values;
}

async function batchEmbed(texts, taskType) {
  const url = new URL(`${BASE}:batchEmbedContents`);
  url.searchParams.set("key", KEY);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: "models/gemini-embedding-2-preview",
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: 3072,
      })),
    }),
  });
  const data = await res.json();
  return data.embeddings?.map((e) => e.values) ?? null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log("=== TEST 1: Task Type Differentiation ===\n");

  const text = "As a designer, I prefer warm earth tones for professional documents";
  const types = ["SEMANTIC_SIMILARITY", "RETRIEVAL_DOCUMENT", "FACT_VERIFICATION", "QUESTION_ANSWERING"];

  const vectors = {};
  for (const t of types) {
    vectors[t] = await embed(text, t);
    console.log(`  ${t}: first 3 dims = [${vectors[t].slice(0, 3).map((v) => v.toFixed(6)).join(", ")}]`);
  }

  console.log("\nCosine similarities between task types:");
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const sim = cosine(vectors[types[i]], vectors[types[j]]);
      const identical = sim > 0.9999;
      console.log(`  ${types[i]} vs ${types[j]}: ${sim.toFixed(6)}${identical ? " ← IDENTICAL" : ""}`);
    }
  }

  console.log("\n=== TEST 2: Negation Problem ===\n");

  const positive = "The treatment improved patient outcomes";
  const negative = "The treatment did NOT improve patient outcomes";
  const unrelated = "The weather forecast predicts rain tomorrow";

  const [vecPos, vecNeg, vecUnrel] = await Promise.all([
    embed(positive, "SEMANTIC_SIMILARITY"),
    embed(negative, "SEMANTIC_SIMILARITY"),
    embed(unrelated, "SEMANTIC_SIMILARITY"),
  ]);

  console.log(`  Positive vs Negative: ${cosine(vecPos, vecNeg).toFixed(6)} (should be high if negation problem exists)`);
  console.log(`  Positive vs Unrelated: ${cosine(vecPos, vecUnrel).toFixed(6)} (baseline dissimilarity)`);

  // Also test with FACT_VERIFICATION
  const [fvPos, fvNeg] = await Promise.all([
    embed(positive, "FACT_VERIFICATION"),
    embed(negative, "FACT_VERIFICATION"),
  ]);
  console.log(`  FV Positive vs FV Negative: ${cosine(fvPos, fvNeg).toFixed(6)} (FACT_VERIFICATION may help)`);

  console.log("\n=== TEST 3: Batch API Correctness ===\n");

  const texts = [
    "I prefer dark mode for coding",
    "The weather is sunny today",
    "PostgreSQL handles concurrent writes well",
  ];

  // Single embeddings
  const singles = [];
  for (const t of texts) {
    singles.push(await embed(t, "RETRIEVAL_DOCUMENT"));
  }

  // Batch embedding
  const batched = await batchEmbed(texts, "RETRIEVAL_DOCUMENT");

  if (!batched) {
    console.log("  Batch API FAILED — returned null");
  } else {
    console.log("  Batch returned", batched.length, "vectors");
    for (let i = 0; i < texts.length; i++) {
      const sim = cosine(singles[i], batched[i]);
      const match = sim > 0.9999;
      console.log(`  Text ${i + 1} single vs batch: ${sim.toFixed(6)}${match ? " ✓ MATCH" : " ✗ MISMATCH"}`);
    }

    // Check if batch vectors are identical to each other (the reported bug)
    console.log(`  Batch[0] vs Batch[1]: ${cosine(batched[0], batched[1]).toFixed(6)} (should be LOW if different texts)`);
    console.log(`  Batch[0] vs Batch[2]: ${cosine(batched[0], batched[2]).toFixed(6)}`);
  }

  console.log("\n=== TEST 4: 100-Result Limit Check ===\n");
  // Check if our search SQL has a LIMIT 100
  console.log("  (This needs to be checked in the SQL, not via API test)");
}

main().catch(console.error);
