# Visualization Research: Embedding & Cluster Visualization for Recipe Maps

Research compiled 2026-04-01. Informs the design of Soup.net's recipe map visualization.

For formal mathematical descriptions of our algorithms and their relationship to the cited papers, see [research-foundations.md](research-foundations.md).

## Key Findings

### 1. UMAP/t-SNE Axis Meaning Problem

**UMAP and t-SNE axes have no semantic meaning.** The x and y coordinates produced by dimensionality reduction are artifacts of the algorithm, not interpretable dimensions. Rotating the entire plot changes nothing about the data.

More critically, **inter-cluster distances in UMAP are unreliable:**

- "Stop Misusing t-SNE and UMAP for Visual Analytics" (arXiv, June 2025) confirms inter-cluster distances in UMAP/t-SNE projections are misleading. Clusters that appear far apart may be close in the original space, and vice versa.
  - Source: https://arxiv.org/html/2506.08725v2
- "Biologists, stop putting UMAP plots in your papers" (Simply Statistics, Dec 2024) argues UMAP routinely exaggerates cluster separation and creates false visual boundaries.
  - Source: https://simplystatistics.org/posts/2024-12-23-biologists-stop-including-umap-plots-in-your-papers/

**Implication for Soup.net:** UMAP is useful for *discovering* that clusters exist, but should not be the primary visualization. Users will incorrectly read meaning into axes and distances. We should offer interpretable concept axes as the primary view.

### 2. Concept-Axis Projection (TCAV)

**Testing with Concept Activation Vectors (TCAV)** projects data onto directions defined by human-chosen concepts. Originally developed for neural network interpretability.

- **Method:** Compute embedding of concept A and concept B. For each data point, compute `cosine_similarity(point, embed(A))` as X and `cosine_similarity(point, embed(B))` as Y. The axes now have explicit, user-chosen meaning.
- **Original paper:** Kim et al., "Interpretability Beyond Feature Attribution: Quantitative Testing with Concept Activation Vectors" (ICLR 2018)
  - Source: https://openreview.net/pdf?id=S1viikbCW
- **Extension:** GCAV (Global Concept Activation Vectors) extends to cross-layer consistency (ICCV 2025)
  - Source: https://openaccess.thecvf.com/content/ICCV2025/papers/He_GCAV_A_Global_Concept_Activation_Vector_Framework_for_Cross-Layer_Consistency_ICCV_2025_paper.pdf

**Implication for Soup.net:** Users enter two search terms. Each term is embedded via Gemini. Each recipe's position is determined by its cosine similarity to each term. This produces a scatter plot where the axes mean something ("how much is this about X?" vs "how much is this about Y?"). Recipes relevant to both terms land in the upper-right quadrant — a natural "Venn diagram" overlap without any special multi-membership algorithm.

### 3. Notable Visualization Systems

#### Every Noise at Once (Spotify / Glenn McDonald)
- Maps 6,000+ music genres onto a 2D plane derived from 13 audio features
- **Axes have designed meaning:** X = dense/atmospheric (left) to choppy/bouncy (right); Y = organic/acoustic (bottom) to synthetic/mechanical (top)
- Font size encodes current listening activity
- Works because axes were deliberately designed from domain-specific features, not from generic dimensionality reduction
- Source: https://en.wikipedia.org/wiki/Every_Noise_at_Once
- Awards: https://www.informationisbeautifulawards.com/showcase/260-every-noise-at-once

#### TensorFlow Embedding Projector
- Reference implementation for interactive embedding visualization
- Offers PCA, t-SNE, and custom projection methods in 2D/3D
- Key features: data panel (color/label by column), inspector panel showing nearest neighbors, projection switching on same data
- Source: https://projector.tensorflow.org/
- Paper: https://arxiv.org/pdf/1611.05469

#### Nomic Atlas
- Handles massive scale: tens of millions of points via server-side dimensionality reduction
- Google Maps-style pan/zoom with automatic topic labeling at different zoom levels
- For datasets >100K points, effectively the only browser-based option that remains responsive
- Source: https://atlas.nomic.ai/
- Docs: https://docs.nomic.ai/api/embeddings-and-retrieval/guides/how-to-visualize-embeddings

### 4. Overlapping / Soft Clustering

K-Means forces hard assignment — each item belongs to exactly one cluster. Real data often has items that belong to multiple clusters with different strengths.

#### Approaches:
- **Fuzzy C-means:** Assigns membership coefficients (0-1) for every cluster. Standard visualization: opacity-mapped coloring — primary cluster color at full opacity, weaker memberships shown as faded halos or borders.
  - Source: "Cluster-centric fuzzy visualization techniques" (MDPI Applied Sciences, 2024) https://www.mdpi.com/2076-3417/14/3/1102
- **Cosine similarity as soft membership:** For our system, computing `cosine_similarity(recipe_vector, centroid_i)` for all centroids naturally produces soft membership scores. No additional algorithm needed — our existing vectors already encode the information.
- **Visual encoding:** Primary cluster color + secondary cluster color as border/halo, with thickness proportional to secondary membership. More legible than Venn diagrams (which break down beyond 3-4 sets).

**Implication for Soup.net:** We can compute soft membership from existing data (cosine similarity to all centroids). The concept-axis view naturally handles overlap — items close to both axes land in shared space. The UMAP view can add colored halos for secondary membership.

### 5. Multi-Perspective Views

How tools let users "look from different angles":

- **Brushing + Linking:** Select points in one view, highlight in all others. D3's `d3-brush` module handles this. (Observable blog, Jan 2025: https://observablehq.com/blog/linked-brushing)
- **Faceted views:** Same data, different projections side by side. E.g., UMAP + concept-axis linked.
- **Filter-driven re-projection vs. highlighting:** Re-projection changes point positions (disorienting). Highlighting within a fixed projection preserves spatial memory. Best practice: highlight for exploration, re-project only when explicitly requested.

**Implication for Soup.net:** The recipe check log provides natural entry points for different perspectives. "Map from here" re-runs the same query on the current corpus — same concept, different moment in time. Concept axes let users choose their own analytical lens.

### 6. Automatic Cluster Labeling

**BERTopic pattern:** Cluster with HDBSCAN → extract representative documents → use LLM to generate a human-readable label per cluster.
- Source: https://medium.com/data-science-collective/bertopic-with-local-llm-labeling-llama-cpp-ollama-a-practical-guide-45314e80d723

**Implication for Soup.net:** We don't run LLMs on the server. Instead, the user's AI agent walks the cluster hierarchy via MCP and generates labels using its own LLM context. The workflow is idempotent — agents can incrementally label new clusters or refresh stale labels. Labels are stored on the cluster record and displayed in the visualization.

### 7. Scale Considerations

| Library | Max Points (responsive) | Notes |
|---------|------------------------|-------|
| D3.js (SVG) | ~10K | Full interaction control, brushing/linking, axes labels. Current choice. |
| deck.gl (WebGL/WebGPU) | 100K-2M | ScatterplotLayer for massive datasets. v9 adds WebGPU. https://deck.gl/ |
| Three.js (WebGL 3D) | Variable | 3D is almost always worse for comprehension — occlusion, disorientation. Avoid. |
| Observable Plot | ~50K | Good for faceted views, less control than D3 for custom interactions. |

**Implication for Soup.net:** D3 SVG is fine for our current scale (hundreds of recipes). If we reach 10K+, swap rendering to deck.gl while keeping D3 for scales/axes/interaction.

### 8. Hard Truths

1. **3D is worse.** Research consistently shows 2D projections with interaction outperform 3D for insight generation. The rotation required to understand 3D is cognitive overhead that kills glanceability.

2. **Non-technical users need labels, not scatter plots.** Labeled clusters with zoom (Atlas-style) work. Raw scatter plots don't. Every Noise at Once works because of labeled, meaningful axes.

3. **The "crowding problem"** — many points collapse to the same region in projection. Solved by zoom + detail-on-demand (our hierarchical approach) or jittering.

4. **Cosine similarity is not really about similarity** in high dimensions (arXiv 2024: https://arxiv.org/abs/2403.05440). It measures angular proximity, which becomes less discriminating in high-dimensional spaces. Our 3072-dim vectors are high enough that this matters — relative differences in cosine similarity are meaningful, but absolute values should not be over-interpreted.

## How This Informs Our Design

### Two complementary views (toggle):

1. **Concept Axes (primary):** User enters two terms → axes have meaning → natural overlap regions for multi-cluster items. Based on TCAV (Kim et al. 2018). Most interpretable view for directed exploration.

2. **UMAP Discovery (secondary):** "Show me the shape of my corpus" — useful for discovering clusters exist, but with clear caveat that distances and axes are not meaningful. Based on McInnes et al. 2018, with awareness of limitations per 2024-2025 critique.

### Hierarchical navigation:
Clustering as pagination (our existing approach), validated by Nomic Atlas's design. Progressive detail on zoom.

### Soft membership:
Cosine similarity to all centroids provides natural fuzzy membership. Displayed as colored halos in both views.

### Agent-generated labels:
Remote agents walk the hierarchy via MCP, generate labels bottom-up. Stored and displayed. No server-side LLM.

### References displayed in the UI:
The visualization pages themselves cite the research basis (TCAV, BERTopic labeling pattern, UMAP limitations) so users understand the proven foundations.
