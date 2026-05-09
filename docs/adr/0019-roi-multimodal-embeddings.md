# ADR-0019: ROI-aware multimodal embeddings

**Date:** 2026-04-17
**Status:** Accepted (first-pass; empirical A/B against Gemini pending)

---

## Context

AI agents submit taste/judgment recipes to Soup.net with reference evidence. For visual artifacts (design mockups, screenshots, photos), the agent often cares about a *specific region* of the image — the CTA button position, a color detail, a layout proportion — not the whole frame. Multimodal embedding quality on the region matters more than on the surrounding pixels.

Antigravity's inline-artifact-annotation UX and the broader "visual prompting" research direction both point at this pattern: the agent marks a box; the system should embed the image in a way that weights the marked region heavily. We use `gemini-embedding-2-preview` (per ADR-0005), which is natively multimodal but has no documented region-of-interest parameter.

The question for this ADR: when an agent submits an image with a region box, **how should the pipeline process the image before embedding** so that the resulting vector reflects the ROI rather than the whole image equally?

---

## Decision

**Blur-reverse-mask + text hint + store-original-separately.**

Concretely:

1. **Input shape.** `check_recipe` accepts an optional `region.image_box` parameter with normalized coordinates `{ x0, y0, x1, y1 }`, each a fraction in `[0, 1]` with top-left origin. Normalized (not pixel) because the agent often doesn't know the image's pixel dimensions, especially when submitting by URL.

2. **Cropping and padding.** Before embedding, the image is cropped to the ROI plus a padding margin (first-pass: 15% of image dimensions on each side, clamped to the image bounds). The crop preserves surrounding context; the padding ratio is an informed guess, documented as an open empirical question below.

3. **Visual cue: gaussian blur on the padding region.** After cropping, a gaussian blur is applied to the padding area (sigma ~8-12px depending on crop size) while leaving the ROI rectangle pixel-sharp. This is the "blur-reverse-mask" technique from FGVP (NeurIPS 2023).

4. **Text hint alongside the multimodal parts.** The embedding's text part receives a short appended note:

   > *"(ROI applied: padding outside the user-marked region has been artificially blurred during pipeline processing to focus attention on the sharp central region. The blur is a pipeline artifact, not a property of the original image.)"*

   Rationale: Gemini's embedding model is substantially richer than CLIP (the model most visual-prompting research was developed against). Without a text cue, the model might interpret blur as a property of the original image ("out of focus photo") rather than a processing signal. The text hint gives it a prior to interpret the blur correctly.

5. **Storage preserves reversibility.** The reference row stores:
   - The *original* (unmodified) image bytes in the payload bucket (keyed by original content hash).
   - `region_meta` JSONB: `{ image_box: {x0, y0, x1, y1} }` (extensible to future `time_range`, `page_range` for video/audio/PDF).
   - The processed (cropped + blurred) bytes are recomputed at embed time; they are NOT durably stored. If the visual-cue technique changes later, re-embedding regenerates the processed bytes from originals + region_meta.

6. **Content hash includes region metadata.** The embedding cache key is `sha256(sourceText || processed_bytes)`, where `processed_bytes` is derived from `(original_bytes, region_meta, visual_cue_version)`. Changing either the region or the visual-cue technique produces a different cache key, avoiding stale-vector hits.

7. **Swappable visual cue.** The processing step is a single function (`applyVisualCue(image, region, version)`) so future empirical A/B tests can swap techniques without touching the API contract.

---

## Alternatives considered

**A. Plain padding (no visual cue).** Crop to ROI+padding, no blur, no outline. Simplest. Rejected because the ROI gets no extra weight — padding features and ROI features land in the embedding with equal salience. Doesn't answer the "right weight" question.

**B. Drawn outline (rectangle on padded crop).** Simple with Sharp (composite an SVG over the image). Debuggable (humans see the marker). Initially my recommendation before the research came back. Rejected for the first pass because FGVP's benchmarks show circles scoring 24.9/29.8/32.4 vs blur at 40.8/44.9/49.6 on RefCOCO — a 12-17 absolute point gap. FALIP (ECCV 2024) also flagged that drawn markers can occlude target pixels and introduce out-of-distribution artifacts.

**C. Vignette/darken padding.** Similar intent to blur but preserves more features in the padding. Less research support.

**D. Pure crop (no padding).** Maximum ROI signal but loses compositional context. The Antigravity research plan noted *"preserves what else was on screen"* as a user value — pure crop sacrifices that.

**E. Dual embedding (crop + full image).** Embed both separately, concatenate or average vectors. Doubles embedding cost per reference, questionable marginal signal.

**F. Per-region embedding model (ObjEmbed).** Single forward pass produces per-region embeddings. Would eliminate the crop-vs-mark tradeoff entirely. Rejected for first pass — we're not building a custom embedding model, we're using Gemini's preview. Worth flagging as a future path if ROI becomes a major surface.

---

## Research citations

Quoted excerpts and URLs for reader verification:

**FGVP — Fine-Grained Visual Prompting (NeurIPS 2023)**
- Yang, L., Wang, Y., Li, X., Wang, X., & Yang, J. (2023).
- [arxiv.org/abs/2306.04356](https://arxiv.org/abs/2306.04356)
- Key finding: *"a single Blur Reverse Mask... significantly outperforms other types of visual prompts"* and *"existing coarse approaches using colorful boxes or circles often result in sub-optimal performance"*.
- RefCOCO / RefCOCO+ / RefCOCOg benchmark numbers: drawn circle 24.9/29.8/32.4 vs Blur Reverse Mask 40.8/44.9/49.6.

**Red Circle — What does CLIP know about a red circle? (ICCV 2023)**
- Shtedritski, A., Rupprecht, C., & Vedaldi, A. (2023).
- [arxiv.org/abs/2304.06712](https://arxiv.org/abs/2304.06712)
- Key finding: a red circle "can direct the model's attention to that region while maintaining global information." Achieved SOTA zero-shot referring-expression comprehension. Important caveat acknowledged by authors: red circles "are rare" in CLIP's training data (YFCC15M) — an emergent model-specific property that may not transfer to Gemini.

**FALIP — Visual Prompt as Foveal Attention (ECCV 2024)**
- Wen, J. et al. (2024).
- [ECCV 2024 paper](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/01558.pdf)
- Argues against pixel-level markers in favor of attention-layer intervention, specifically because drawn markers can occlude target pixels and introduce out-of-distribution artifacts in dense scenes.

**SoM — Set-of-Mark Prompting (arxiv 2023)**
- Yang, J., Zhang, H., Li, F., Zou, X., Li, C., & Gao, J. (2023).
- [arxiv.org/abs/2310.11441](https://arxiv.org/abs/2310.11441)
- Numbered-region annotations for Grounded Vision Models (primarily GPT-4V). Relevant as prior art on visual annotations but not directly applicable to pure embedding models.

**Visual Prompting in Multimodal LLMs: A Survey**
- Wu, J. et al. (2024).
- [arxiv.org/abs/2409.15310](https://arxiv.org/abs/2409.15310)
- Broader context on the space.

**ObjEmbed — Universal Multimodal Object Embeddings**
- Fu, S. et al. (2026).
- [arxiv.org/abs/2602.01753](https://arxiv.org/abs/2602.01753)
- Future-path alternative: per-region embeddings in one forward pass.

**Gemini Embedding 2 Preview (Google)**
- [ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview)
- Documents tiling (768×768), Matryoshka 3072-dim output, unified cross-modal space. **Silent on visual-prompt behavior** — any visual-cue choice is Gemini-untested.

---

## Consequences

### Positive

- **Research-backed first-pass** on the strongest cue technique tested across CLIP-family VLMs.
- **Reversibility.** Original bytes + region_meta are stored untouched; if empirical testing later reveals a better cue for Gemini, re-embed without re-collecting data.
- **Extensibility.** `region_meta` as JSONB accommodates future `time_range` (video, audio), `page_range` (PDF), or other per-media cues without schema migration.
- **Swappable.** The processing function is isolated — `applyVisualCue` — so A/B testing visual-cue variants is an in-place swap.
- **Text hint compensates for model-prior mismatch.** Gemini's broader training likely includes annotated images, technical diagrams, and photographic blur. The text note tells it which interpretation applies here.

### Negative / Risks

- **Sync-only by design (drift structurally resolved).** A pre-existing drift between the sync check-time embedding path and the async pg-boss pipeline was discovered during this ADR's implementation: the async path's `VectorCheckItem` carries `{ vectorId, chunkId, chunkText, chunkHash, taskType, modelId }` only — no file bytes, no MIME type, no ROI metadata. A deferred multimodal chunk would produce a **text-only vector** written to `vector_cache` under the multimodal content hash, corrupting the cache for that hash. ADR-0020 collapsed the worker into the backend so the sync and async code now live in one process; the structural enforcement lives in `enqueueEmbedding`, which throws if `deferToWorker && fileBuffer`. Multimodal embeddings are deliberately sync-only — the ~500ms Gemini latency at check time is acceptable, and the async path doesn't need multimodal support until that latency materially matters. **A/B testing path:** `scripts/reembed-multimodal.ts --strategy-id <id>` loads original bytes from `references.file_url`, re-applies the current `VISUAL_CUE_VERSION`, and writes a parallel strategy's embeddings (idempotent; skips already-regenerated evidence). `--audit` reports pre-mitigation cache entries that may hold text-only vectors under a multimodal hash.
- **Gemini-untested.** All cited research is on CLIP and GPT-4V. No published evidence that blur-reverse-mask works on `gemini-embedding-2-preview` specifically. Acceptable first-pass risk given reversibility at the storage layer.
- **Padding ratio is unvalidated.** 15% is a guess. Could be too tight (loses context) or too loose (dilutes ROI). Empirical tuning needed.
- **Small-ROI degenerate case.** When the ROI is <5% of the image area, after cropping + 15% padding, the ROI still dominates the visible area but small absolute pixel counts may interact badly with Gemini's 768×768 tiling.
- **Dense-scene out-of-distribution risk** (per FALIP): a heavily blurred padding region is itself an unusual image statistic. Gemini's behavior on such images isn't documented.
- **Additional processing cost.** Sharp crop + blur adds ~50-200ms per image depending on size. Acceptable for recipe checks; not a hot-path concern.

### Neutral

- **Content-hash change.** The vector cache key depends on processed bytes, which depend on the visual-cue version. If we bump the version (new cue technique), existing cached vectors won't match new requests — correct behavior but a cache-warmth reset.

---

## Open empirical questions

These are not blockers for shipping the first-pass implementation but should be resolved before we harden the choice:

1. **Does blur-reverse-mask actually help `gemini-embedding-2-preview` retrieval?** Ship first-pass, then run a small A/B on a held-out query set comparing blur vs drawn outline vs plain-padded vs pure-crop, once we have ≥50 multimodal recipes to score.
2. **Optimal padding ratio.** Sweep 0%, 5%, 15%, 30%, 50% on the same held-out set.
3. **Blur sigma.** Test sigma scaling with crop size. Softer blur may preserve padding features that help retrieval; harder blur may over-emphasize ROI.
4. **Text-hint wording.** Does the exact phrasing of the hint matter? Test with and without the hint entirely.
5. **Interaction with Gemini's 768×768 tiling.** If the cropped image (padding included) is resized to fit Gemini's tile grid, does the blurred region land cleanly inside a tile or does it get split?

---

## Implementation notes

- `applyVisualCue(image, region, version)` lives in a backend module and is imported wherever embedding is prepared (both sync check_recipe path and async worker path).
- `version` tag on the function lets us mark old cached vectors as stale when the cue changes.
- Sharp is added as a backend dependency for cropping + blurring. First time Sharp is installed despite being referenced in prior backlog items.
- Text hint is appended to the agent's `sourceText` with a blank line separator, so it doesn't blend into the evidence body visually.

See `apps/backend/src/lib/image-roi.ts` (to be created) for the implementation.
