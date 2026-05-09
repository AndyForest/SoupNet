# Research Foundations

> **Purpose:** Formal mathematical descriptions, research lineage, and verification experiments for each algorithm. This reads like a research paper — LaTeX notation, citation chains, and explicit statements of where we diverge from published work.
>
> **Audience:** Researchers, technically rigorous reviewers, and anyone evaluating whether our algorithmic choices are well-founded. Also useful for engineers who want to understand *why* an algorithm works, not just *how* it's coded.
>
> **Related docs (and how they differ):**
> - [search-algorithms.md](search-algorithms.md) — **What's implemented:** code locations, parameters, endpoint mappings. Same algorithms, but focused on the codebase rather than the math. Read that to change code; read this to understand the theory.
> - [search-strategies.md](search-strategies.md) — **What we considered:** research notes, alternatives, future ideas. This doc covers only what we actually use; search-strategies.md covers the broader landscape.
> - [design-thinking.md](../design-thinking.md) — **Who and why:** product vision, user archetypes. No math.
>
> **Rule of thumb:** If it needs LaTeX, a citation, or a verification experiment, it belongs here. If it's a code snippet or endpoint mapping, put it in search-algorithms.md.

For each technique: the **problem it solves** (with a user experience example), the mathematics of our implementation, the original research, what we adapted, how our implementation differs, and experiments to validate our adaptations.

**Notation conventions:** Vectors are bold lowercase ($\mathbf{v}$). Matrices are bold uppercase ($\mathbf{M}$). Sets are calligraphic ($\mathcal{S}$). We use $\cos(\mathbf{a}, \mathbf{b})$ as shorthand for cosine similarity.

**Implementation links:** Each section references the source file where the algorithm is implemented.

---

## 1. Concept-Direction Projection (Semantic Projection)

### Problem

A user has hundreds of recipes capturing their taste and judgment. They want to understand how their recipes relate to specific concepts they care about — for example, "how do my recipes distribute between accessibility concerns and visual design choices?" The standard dimensionality reduction view (UMAP) produces a scatter plot where the axes are meaningless artifacts of the projection. Users need **interpretable axes** where the position of each recipe tells them something they can reason about.

**User experience:** On the `/map` page, a user switches to "Concept Axes" mode and types "accessibility" as the X axis and "visual design" as the Y axis. They click "Project." Each recipe is positioned by how semantically similar it is to each concept. A recipe about "WCAG contrast ratios for the dashboard" lands high on the accessibility axis and moderate on visual design. A recipe about "As a designer working on the marketing site, I prefer serif fonts for body text so that the brand feels warm" lands high on visual design and low on accessibility. A recipe about "color palettes should meet AA contrast" lands high on both — a natural intersection without any special overlap algorithm.

### Our Implementation

Given a corpus of recipe embeddings $\mathcal{R} = \{\mathbf{r}_1, \mathbf{r}_2, \ldots, \mathbf{r}_n\}$ where each $\mathbf{r}_i \in \mathbb{R}^{3072}$ (Gemini embedding-2-preview), and two user-chosen concept terms $a$ and $b$:

1. Embed each concept term: $\mathbf{c}_a = \text{embed}(a)$, $\mathbf{c}_b = \text{embed}(b)$, where $\mathbf{c}_a, \mathbf{c}_b \in \mathbb{R}^{3072}$

2. For each recipe $\mathbf{r}_i$, compute its position on the concept axes:

$$x_i = \cos(\mathbf{r}_i, \mathbf{c}_a) = \frac{\mathbf{r}_i \cdot \mathbf{c}_a}{\|\mathbf{r}_i\| \|\mathbf{c}_a\|}$$

$$y_i = \cos(\mathbf{r}_i, \mathbf{c}_b) = \frac{\mathbf{r}_i \cdot \mathbf{c}_b}{\|\mathbf{r}_i\| \|\mathbf{c}_b\|}$$

3. The resulting 2D position $(x_i, y_i) \in [-1, 1]^2$ places each recipe on axes with explicit semantic meaning.

This is equivalent to projecting each recipe embedding onto the unit vectors $\hat{\mathbf{c}}_a$ and $\hat{\mathbf{c}}_b$. The cosine similarity measures the component of each recipe's embedding in the direction of the concept vector.

**Implementation:** `apps/backend/src/services/search-pipeline.ts`, function `runSearchPipeline()` with `axes` parameter. Cosine similarity computed in `cosineSimilarity()`.

### Primary Research Lineage: Semantic Projection

**Canonical source:** Grand, G., Blank, I. A., Pereira, F., & Fedorenko, E. (2022). "Semantic projection recovers rich human knowledge of multiple object features from word embeddings." *Nature Human Behaviour*, 6, 975–987.
- Published: https://www.nature.com/articles/s41562-022-01316-8
- Preprint: https://arxiv.org/abs/1802.01241

**What Grand et al. do:** Project word vectors onto a line in embedding space defined by a semantic feature (e.g., "small" to "big" for size). The projected scalar score gives each item's position along that feature dimension. They validate that these projections recover human judgments of object properties (size, speed, danger, etc.) across multiple embedding models.

**Our relationship:** Grand et al. use antonym pairs and average over multiple word pairs to build robust feature axes. Our approach uses **single-term embeddings** as concept directions — a unipolar variant where the axis runs from the origin to the concept's embedding. Mathematically, this is a degenerate case of semantic projection where cosine similarity to a single reference vector replaces projection onto a bipolar axis.

| Grand et al. (2022) | Our implementation | Relationship |
|-----|-------------------|-------------|
| Bipolar axes from antonym pairs (e.g., "small"–"big") | Unipolar axes from single concept terms | **Simplification.** Antonym pairs isolate a specific dimension by subtracting shared variance. Single-term axes conflate "similar to concept" with "similar to anything near the concept." For well-separated concepts this works; for similar concepts (e.g., "accessibility" and "usability"), axes will be correlated. |
| Static word embeddings (word2vec, GloVe) | Sentence-level embeddings (Gemini embedding-2-preview) | **Extension.** Grand et al. project individual words. We project multi-sentence recipe texts. Sentence embeddings capture compositional meaning that word embeddings cannot. |
| Validated against human behavioral data | Not yet validated | **Gap.** See Experiment 1 below. |

### Supporting Research

**Kozlowski, Taddy, & Evans (2019).** "The Geometry of Culture: Analyzing the Meanings of Class through Word Embeddings." *American Sociological Review*, 84(5), 905–949.
- Source: https://arxiv.org/abs/1803.09288

Operationalizes the same technique for computational sociology: defines cultural dimensions (affluence, gender, race) as directions in embedding space via word-pair differences, then projects items onto those axes. Demonstrates that multi-axis scatter plots using embedding projection recover culturally meaningful associations validated by survey data. This is the strongest social science precedent for our two-axis scatter plot visualization.

**Concept Mover's Distance — Stoltz & Taylor (2019, 2021).** The closest published match to our **single-term** approach. Their `text2map` R package implements three modes:
- **Centroid** (single concept word as reference point) — closest to our approach
- **Direction** (antonym pair difference vector) — the standard semantic projection method
- **Region** (cluster of concept words)

Our technique is essentially the centroid mode, using cosine similarity rather than Earth Mover's Distance as the proximity metric, applied to dense sentence embeddings rather than bag-of-words.
- CMD paper: https://link.springer.com/article/10.1007/s42001-019-00048-6
- Directions paper: https://link.springer.com/article/10.1007/s42001-020-00075-8
- text2map package: https://culturalcartography.gitlab.io/text2map/

**SemAxis — An, Kwak, & Ahn (2018).** "SemAxis: A Lightweight Framework to Characterize Domain-Specific Word Semantics Beyond Sentiment." ACL 2018. Defines semantic axes as difference vectors between antonym pairs ($\mathbf{v}_{\text{axis}} = \mathbf{v}_{\text{good}} - \mathbf{v}_{\text{bad}}$), scores words by projection onto these axes. Our single-term approach skips the bipolar construction.
- ACL Anthology: https://aclanthology.org/P18-1228/

**Parallax — Molino, Wang, & Zhang (2019, Uber Research).** Interactive embedding visualization tool where users define axes via algebraic formulae on embeddings. Supports cartesian (2 axes) and polar (multiple axes) views. The closest **tool-level** match to our implementation.
- Paper: https://arxiv.org/abs/1905.12099
- Code: https://github.com/uber-research/parallax

### Foundational Work

**Mikolov et al. (2013).** "Efficient Estimation of Word Representations in Vector Space." Demonstrated that embedding spaces encode linear semantic relationships (king − man + woman ≈ queen). Established the theoretical foundation that directions in embedding space encode semantic properties. Our concept axes are a special case: projection onto a single direction.
- Source: https://arxiv.org/abs/1301.3781

**Bolukbasi, Chang, Zou, Saligrama, & Kalai (2016).** "Man is to Computer Programmer as Woman is to Homemaker? Debiasing Word Embeddings." NeurIPS 2016. Showed that projecting word vectors onto concept directions (the "gender direction" via PCA on gendered word-pair differences) yields meaningful scalar scores. Gave the field confidence that cosine similarity to a direction vector is a valid measurement of semantic properties.
- Source: https://arxiv.org/abs/1607.06520

### Distant Relatives (for completeness)

**TCAV — Kim et al. (2018).** "Interpretability Beyond Feature Attribution: Quantitative Testing with Concept Activation Vectors." ICML 2018. Operates in a neural network's internal activation space, trains linear classifiers (SVMs) on positive/negative concept examples to find concept directions, and uses directional derivatives for sensitivity testing. Our approach shares the core insight (projecting onto human-defined directions in a vector space) but differs substantially in mechanism: we use pre-trained embeddings (not internal activations), single-term embeddings (not trained classifiers), and cosine similarity (not directional derivatives).
- Source: https://openreview.net/pdf?id=S1viikbCW

**Post-hoc Concept Bottleneck Models — Yuksekgonul et al. (2023).** ICLR 2023. Closer to our approach than TCAV because it works with frozen representations rather than requiring training access. However, it still trains SVMs to find concept directions.
- Source: https://openreview.net/pdf?id=nA5AZ8CEyow

### Why Unipolar (Single-Term) Rather Than Bipolar (Antonym-Pair) Axes

The literature predominantly uses bipolar axes constructed from antonym pairs (e.g., $\mathbf{v}_{\text{axis}} = \mathbf{v}_{\text{big}} - \mathbf{v}_{\text{small}}$). We use unipolar axes (single concept embedding as direction). This is a deliberate choice:

**Many real-world concepts lack clear antonyms.** What is the antonym of "TODO list"? Of "user experience best practices"? Of "sourdough fermentation"? Forcing bipolar construction requires artificial antonym selection that may introduce more noise than it removes. Grand et al. (2022) acknowledge this — their approach works best for concepts with natural bipolar structure (size, speed, danger) and less well for concepts that are inherently unipolar.

**Our users define concepts interactively.** In a research setting, an experimenter can carefully select antonym pairs. In our system, users type concept terms freely in real time. Requiring them to provide antonym pairs doubles the input burden and requires linguistic knowledge about what constitutes a good antonym in embedding space.

**Unipolar projection is mathematically well-defined.** Cosine similarity to a single reference vector $\hat{\mathbf{c}}$ measures the component of each data point in that direction. This is equivalent to an orthogonal projection onto the 1D subspace spanned by $\hat{\mathbf{c}}$. The operation is interpretable: higher values mean "more semantically related to this concept."

**The cost of unipolar:** Bipolar axes isolate a specific semantic dimension by subtracting shared variance between the two poles. Unipolar axes conflate "similar to the concept" with "similar to anything near the concept in embedding space." For well-separated concepts, this distinction is negligible. For closely related concepts, it manifests as correlated axes (the scatter plot collapses toward the diagonal). We mitigate this by reporting axis correlation.

**Verification plan:** Experiment 3 directly tests whether unipolar axes produce meaningfully different projections than bipolar axes. If they diverge significantly, we may offer an optional bipolar mode where users provide two terms per axis and we use the difference vector. AI agents connected via MCP could construct reasonable antonym pairs for arbitrary concepts, making bipolar mode feasible without burdening human users.

### Known Limitations

**Lack of contrast (vs. bipolar axes).** Antonym-pair difference vectors (Grand et al.'s preferred method) isolate a specific semantic dimension by subtracting shared variance. Our single-term axis conflates "similarity to the concept" with "similarity to anything semantically near the concept." For well-separated concepts (e.g., "accessibility" and "sourdough"), this works well. For concepts that are themselves similar (e.g., "accessibility" and "usability"), the axes will be highly correlated and the scatter plot collapses toward the diagonal. **Mitigation:** We report axis correlation ($\cos(\mathbf{c}_a, \mathbf{c}_b)$) to warn users when axes are not orthogonal.

**Polysemy.** A single-term embedding conflates all senses of a word ("bank" = financial institution or riverbank). Modern sentence-level embedding models (like Gemini embedding-2-preview) mitigate this for typical concept terms, but it remains a theoretical limitation.

**Anisotropy.** Ethayarajh (2019) showed that embeddings from large language models cluster in a narrow cone (anisotropic), compressing the effective range of cosine similarity. Modern embedding models trained specifically for similarity tasks (contrastive objectives with L2 normalization, as Gemini embedding-2-preview is) significantly reduce this issue, but the caveat applies.
- Source: https://arxiv.org/abs/1909.00512

### Terminology

Our technique does not have a single canonical name in the literature. The most precise descriptions:
- **Unipolar semantic projection** (our variant of Grand et al. 2022)
- **Concept-axis cosine scoring** (descriptive)
- **Centroid-mode Concept Mover's Distance** (Stoltz & Taylor 2019, closest published equivalent)

We use "concept-axis projection" in our UI and API documentation.

### Verification Experiments

**Experiment 1: Concept axis coherence.** For a set of known-category recipes (e.g., recipes about "performance" vs. recipes about "accessibility"), compute their concept-axis positions. Hypothesis: recipes about the concept should cluster at high values on the corresponding axis. Metric: mean cosine similarity of on-topic recipes vs. off-topic recipes on the concept axis. Validates the core claim of Grand et al. (2022) in our domain.

**Experiment 2: Axis orthogonality and correlation warning.** For concept pairs that should be independent (e.g., "accessibility" and "sourdough"), verify that $\cos(\mathbf{c}_a, \mathbf{c}_b) \approx 0$. For related concepts (e.g., "accessibility" and "usability"), measure correlation and verify our UI warning triggers. Metric: Pearson correlation between x and y positions across the corpus.

**Experiment 3: Unipolar vs. bipolar axis quality.** For 10 concepts, compare our single-term axes to bipolar axes constructed from antonym pairs. Metric: correlation between the two projections. If high ($r > 0.8$), the unipolar simplification is justified for this embedding space. If low, consider offering a bipolar axis mode.

**Experiment 4: Comparison to trained concept directions.** Collect 20+ positive and 20+ negative examples for a concept. Train a linear classifier on their embeddings (per TCAV methodology). Compare the learned direction to our single-term embedding direction. Metric: cosine similarity between the two directions. Tests whether the simplification of skipping classifier training costs significant quality.

**Experiment 5: Stability across embedding models.** Repeat experiments 1–4 with different embedding models (e.g., OpenAI text-embedding-3-large, Cohere embed-v3). If results are consistent, the approach generalizes beyond our specific model choice.

*Status: Not yet conducted. Data available in the production corpus. These experiments can be run by any AI agent with access to the `/traces/map` API.*

---

## 2. K-Means Clustering with K-Means++ Initialization

### Problem

A recipe check returns dozens or hundreds of similar recipes. An AI agent with a limited context window cannot process all of them. We need to compress the result set into a small number of representative exemplars that capture the diversity of the results — showing the user or agent "here are the 5 distinct themes in your results" rather than a wall of 200 individually ranked items.

**User experience:** An agent checks a recipe about "deployment strategies." The system finds 87 similar recipes. Rather than returning all 87, it clusters them into 5 groups (infrastructure, CI/CD, edge deployment, containerization, monitoring) and returns one representative recipe from each group with a count of how many similar recipes it represents. The agent gets a concise, diverse summary.

### Our Implementation

Given $n$ result vectors $\mathcal{V} = \{\mathbf{v}_1, \ldots, \mathbf{v}_n\}$ and target cluster count $k$:

**K-Means++ initialization** (Arthur & Vassilvitskii, 2007):

1. Choose first centroid $\boldsymbol{\mu}_1$ uniformly at random from $\mathcal{V}$
2. For $j = 2, \ldots, k$: choose $\boldsymbol{\mu}_j = \mathbf{v}_i$ with probability proportional to $D(\mathbf{v}_i)^2$, where $D(\mathbf{v}_i) = \min_{j' < j} d(\mathbf{v}_i, \boldsymbol{\mu}_{j'})$ is the distance to the nearest already-chosen centroid

**Note on our initialization:** Our implementation uses spread sampling (selecting the point farthest from all existing centroids) rather than probabilistic D² weighting. This is deterministic and produces well-separated initial centroids, but lacks the theoretical $O(\log k)$-competitive guarantee of true K-Means++.

**Distance metric:** Cosine distance, not Euclidean:

$$d(\mathbf{a}, \mathbf{b}) = 1 - \cos(\mathbf{a}, \mathbf{b}) = 1 - \frac{\mathbf{a} \cdot \mathbf{b}}{\|\mathbf{a}\| \|\mathbf{b}\|}$$

This is appropriate for high-dimensional embeddings where angular similarity is more meaningful than Euclidean distance.

**Iteration (Lloyd's algorithm):**

1. **Assign:** Each $\mathbf{v}_i$ to the cluster $c$ with nearest centroid: $c_i = \arg\min_j d(\mathbf{v}_i, \boldsymbol{\mu}_j)$
2. **Update:** Recompute centroids as the arithmetic mean of assigned vectors: $\boldsymbol{\mu}_j = \frac{1}{|C_j|} \sum_{\mathbf{v}_i \in C_j} \mathbf{v}_i$
3. **Converge:** Repeat until assignments are unchanged or 20 iterations reached

**Exemplar selection:** For each cluster $C_j$, the exemplar is the real data point nearest to the centroid:

$$\text{exemplar}_j = \arg\min_{\mathbf{v}_i \in C_j} d(\mathbf{v}_i, \boldsymbol{\mu}_j)$$

**Auto-k estimation** (when `maxChars` is specified):

$$k = \max\left(2, \min\left(n, \left\lfloor \frac{\text{maxChars}}{\bar{c} \times 3.5} \right\rfloor\right)\right)$$

where $\bar{c}$ is the mean character length of result texts and 3.5 is the evidence overhead multiplier (empirically determined for HTML rendering).

**Implementation:** `apps/backend/src/services/clustering.service.ts`.

### Research Lineage

**Source:** Arthur, D. & Vassilvitskii, S. (2007). "k-means++: The Advantages of Careful Seeding." *Proceedings of the 18th Annual ACM-SIAM Symposium on Discrete Algorithms (SODA)*. https://theory.stanford.edu/~sergei/papers/kMeansPP-soda.pdf

**Our divergence from the paper:**

| K-Means++ paper | Our implementation | Impact |
|-----------------|-------------------|--------|
| D² probabilistic sampling | Deterministic spread sampling (farthest-first) | Loses the $O(\log k)$-competitive guarantee. Gains determinism (identical inputs → identical outputs). For our use case (interactive visualization, not optimization benchmarks), determinism is more valuable than the theoretical guarantee. |
| Euclidean distance | Cosine distance | Standard practice for text embeddings. Euclidean distance in high dimensions is dominated by norm differences; cosine normalizes for this. |
| No exemplar concept | Nearest real point to centroid | Following Manning et al. IR textbook (ch. 16). K-Means produces synthetic centroids that may not correspond to real data. Exemplars ensure we always display a real recipe. |

**Additional reference:** Manning, C., Raghavan, P., & Schütze, H. (2008). *Introduction to Information Retrieval*, Chapter 16. https://nlp.stanford.edu/IR-book/html/htmledition/k-means-1.html — Our exemplar selection follows this textbook's approach of using cluster centroids for the algorithm but displaying nearest real documents.

### Verification Experiments

**Experiment 5: Cluster quality metrics.** Compute silhouette scores for clustered recipe check results. Silhouette $s_i = \frac{b_i - a_i}{\max(a_i, b_i)}$ where $a_i$ is mean intra-cluster distance and $b_i$ is mean nearest-cluster distance. Report distribution across recipe checks. Hypothesis: median silhouette > 0.3 (moderate structure).

**Experiment 6: Determinism verification.** Run clustering 100 times on the same input. Verify identical output each time (our spread sampling should guarantee this).

**Experiment 7: Spread sampling vs. D² sampling quality.** For a sample of 50 recipe checks, run both initialization strategies. Compare silhouette scores. If D² produces significantly better clusters, consider switching (with a fixed random seed for reproducibility).

*Status: Experiment 6 is covered by existing unit tests. Experiments 5 and 7 not yet conducted.*

---

## 3. Contextual Retrieval

### Problem

Evidence entries are short fragments ("User's tsconfig.json has strict mode enabled") that lose their meaning without the parent recipe context ("As a developer working on the Acme API, I prefer strict TypeScript configuration so that type errors are caught at compile time"). When we embed evidence entries in isolation, the vector captures the fragment's meaning but not what it supports. When we search for related evidence across recipes, we need fragments that are topically relevant to the recipe being checked — not just fragments that happen to use similar words.

**User experience:** A user checks a recipe about accessible color palettes. The evidence discovery pipeline finds an evidence entry from another recipe: "WCAG 2.1 requires 4.5:1 contrast for normal text." Because this evidence was embedded with its parent recipe context ("I chose high-contrast themes for accessibility"), the system knows it's relevant to accessibility — not just to contrast ratios in general.

### Our Implementation

When embedding evidence entries, we prepend the parent recipe text as context:

```
Recipe context: "[parent trace claim text]"
Supporting evidence: [interpretation]
> "[quote]"
-- [source]
```

This enriched text is embedded as a single vector. The parent context ensures that evidence fragments retain the semantic context of what they support.

**Implementation:** `apps/backend/src/services/trace.service.ts`, function `insertEvidenceEntries()`.

### Research Lineage

**Source:** Anthropic. (2024). "Contextual Retrieval." https://www.anthropic.com/news/contextual-retrieval

**Relationship:** Anthropic's approach prepends document-level context to chunk-level embeddings before indexing. They report 35–67% improvement in retrieval quality. Our implementation is a **direct application** of this technique: evidence entries are our "chunks" and the parent recipe is our "document context."

**Divergence:** Anthropic's implementation uses an LLM to generate a brief context summary for each chunk. We prepend the raw parent text without LLM summarization (we don't run LLMs on the server). This means our context is longer and less focused than Anthropic's approach, but avoids the cost and latency of an LLM call per evidence entry.

### Verification Experiments

**Experiment 10: Contextual vs. non-contextual retrieval.** For 30 recipe checks, compare the evidence discovery pipeline's results with and without parent context prepended. Metric: human-judged relevance of the top-5 related evidence results. Hypothesis: contextual evidence retrieval surfaces more relevant cross-recipe evidence.

*Status: Not yet conducted. The infrastructure supports A/B comparison by toggling context prepending.*

---

## 4. Stigmergic Coordination

### Problem

AI agents working on behalf of different users (or the same user in different sessions) need to benefit from each other's accumulated judgment without explicit communication. A recipe checked by one agent on Monday should improve search results for a different agent on Wednesday — without anyone manually curating or sharing knowledge. The system needs to grow smarter through use, not through administration.

**User experience:** Developer A's agent checks a recipe about "I prefer Hono over Express for edge deployment." A week later, Developer B's agent checks a recipe about "choosing a web framework for Cloudflare Workers." Developer A's recipe appears as a relevant result — not because anyone tagged it or shared it, but because the act of checking deposited a trace that future searches discover. The more developers check recipes about edge frameworks, the richer this region of the corpus becomes.

### Our Model

Soup.net's core mechanism is stigmergic: each recipe check is simultaneously a search query and a trace deposit. Formally:

Let $\mathcal{C}$ be the corpus of traces at time $t$. A recipe check with recipe $r$ and evidence $e$ produces:
1. A **search result** $\mathcal{S}(r, \mathcal{C})$ — the traces in $\mathcal{C}$ most similar to $r$
2. A **trace deposit** $\mathcal{C}' = \mathcal{C} \cup \{(r, e)\}$ — the corpus grows

The key property: $\mathcal{S}(r, \mathcal{C}') \neq \mathcal{S}(r, \mathcal{C})$ for future queries. The newly deposited trace influences future searches, just as an ant's pheromone deposit influences future ant navigation.

**Reinforcement:** When a similar recipe is checked again (possibly by a different agent), the region of embedding space near both recipes becomes denser. Future searches in that region return more results with higher diversity — the "trail" is reinforced by traffic.

**Decay (planned, not implemented):** In ant colony optimization, pheromones evaporate over time. We plan to apply temporal decay to recipe relevance scores (see `search-algorithms.md` for the decay function design). Recipes that are not re-checked or reinforced with new evidence gradually contribute less to search results.

### Research Lineage

**Source:** Heylighen, F. (2016). "Stigmergy as a Universal Coordination Mechanism I: Definition and Components." *Cognitive Systems Research*, 38, 4–13. https://doi.org/10.1016/j.cogsys.2015.12.002

**Also:** Dorigo, M. & Stützle, T. (2004). *Ant Colony Optimization*. MIT Press. — The canonical reference for pheromone-based optimization algorithms.

**Relationship:** Our system implements **digital stigmergy** as defined by Heylighen: indirect coordination through modifications to a shared environment. The corpus is the environment, traces are the deposits, and search is the sensing mechanism. This is a **direct application** of the stigmergy concept, not a metaphor.

**Divergence from ACO:** Ant Colony Optimization uses stigmergy to solve optimization problems (shortest path, TSP). Our system uses stigmergy for **knowledge coordination** — accumulating and surfacing taste and judgment. There is no optimization objective; the system doesn't converge to a single "best" answer. Instead, it grows a landscape of diverse positions that may support or contradict each other. This is closer to Heylighen's general stigmergy framework than to ACO specifically.

### Verification Experiments

**Experiment 11: Corpus growth impact.** Track search quality metrics (result relevance, diversity) as the corpus grows from 100 to 1000 to 10000 recipes. Hypothesis: search quality improves monotonically as the corpus grows (the stigmergic property).

**Experiment 12: Reinforcement effect.** For a topic with multiple recipes from different agents, compare search recall to a topic with a single recipe. Hypothesis: multi-agent reinforced topics have higher recall and more diverse evidence.

*Status: Not yet conducted. Early qualitative observation supports the hypothesis — recipe checks return richer results as the corpus grows.*

---

## 5. UMAP Projection (Discovery View)

### Problem

Before a user knows what concepts to project onto (Section 1), they need a way to see the overall shape of their corpus — where the clusters are, how many distinct themes exist, whether there are isolated outliers. This is a discovery task: "show me what's here" rather than "show me how these relate to X."

**User experience:** A new user with 200 recipes opens the Recipe Map in Discovery mode. Five colored clusters appear, each with a count. They can see at a glance that most of their recipes are about frontend development (large cluster), with smaller clusters for deployment, design taste, team collaboration, and personal productivity. They click a cluster to drill in. This overview informs their subsequent concept-axis explorations.

### Our Implementation

We use UMAP (Uniform Manifold Approximation and Projection) for the "discovery" view in the recipe map visualization. UMAP runs **client-side** in a Web Worker using the `umap-js` library.

Parameters: `nNeighbors = 15`, `minDist = 0.1`, `spread = 1.0`, `nComponents = 2`.

### Research Lineage

**Source:** McInnes, L., Healy, J., & Melville, J. (2018). "UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction." https://arxiv.org/abs/1802.03426

### Known Limitations (We Document These to Users)

**Inter-cluster distances are unreliable.** UMAP preserves local neighborhood structure but can arbitrarily distort global distances. Two clusters that appear far apart in UMAP space may be close in the original 3072-dimensional space, and vice versa.

- Nguyen, L. H. & Holmes, S. (2024). "Biologists, stop putting UMAP plots in your papers." *Simply Statistics*. https://simplystatistics.org/posts/2024-12-23-biologists-stop-including-umap-plots-in-your-papers/
- Wang, Y. et al. (2025). "Stop Misusing t-SNE and UMAP for Visual Analytics." *arXiv*. https://arxiv.org/html/2506.08725v2

**Our mitigation:** UMAP is the **secondary** discovery view, not the primary visualization. The primary view uses concept-axis projection (Section 1), which has interpretable axes. The UMAP view includes a caveat in the UI about distance interpretation. The concept axes view is preferred for drawing conclusions about recipe relationships.

---

## 6. Cosine Similarity in High Dimensions

### Caveat

**Source:** Zimek, A. (2024). "Is Cosine-Similarity of Embeddings Really About Similarity?" *arXiv*. https://arxiv.org/abs/2403.05440

In high-dimensional spaces (our embeddings are 3072-dimensional), cosine similarity values compress toward a narrow range. The absolute value of $\cos(\mathbf{a}, \mathbf{b})$ becomes less discriminating as dimensionality increases. **Relative** differences remain meaningful — if $\cos(\mathbf{a}, \mathbf{b}) > \cos(\mathbf{a}, \mathbf{c})$, then $\mathbf{a}$ is more similar to $\mathbf{b}$ than to $\mathbf{c}$ — but the absolute values should not be over-interpreted.

**Implication for our system:** When we display similarity percentages (e.g., "73% similar"), users should interpret them as relative rankings, not as "73% of the meaning is shared." The concept-axis positions (Section 1) inherit this caveat — the percentage values on the axes represent relative proximity to the concept, not an absolute measure of relevance.

---

## Summary of Research Relationships

| Technique | Relationship to source | Key divergence |
|-----------|----------------------|----------------|
| Concept-axis projection | **Unipolar variant of** Semantic Projection (Grand et al. 2022), **equivalent to centroid mode of** CMD (Stoltz & Taylor 2019) | Single-term embedding instead of bipolar antonym-pair axes; sentence embeddings instead of word embeddings |
| K-Means clustering | **Direct application** of Lloyd's algorithm with K-Means++ init (Arthur 2007) | Spread sampling instead of D² probabilistic sampling; cosine distance instead of Euclidean |
| Exemplar selection | **Direct application** of Manning et al. (2008) Ch. 16 | No divergence |
| Reciprocal Rank Fusion | **Direct application** of Cormack et al. (2009) | No divergence ($k = 60$ as recommended). **Paused (2026-04-11)** — simplified to pure vector baseline. See Appendix. |
| Contextual Retrieval | **Direct application** of Anthropic (2024) | Raw parent text instead of LLM-generated context summary |
| Stigmergic coordination | **Direct application** of Heylighen (2016) general framework | Knowledge coordination, not optimization (diverges from ACO) |
| UMAP | **Standard usage** of McInnes et al. (2018) | Client-side only, secondary to concept axes, with documented limitations |

---

## Open Questions for Researcher Review

1. **Is single-term concept embedding a valid proxy for a trained CAV?** Our Experiment 3 is designed to test this, but we would value guidance on methodology.

2. **Is spread sampling (deterministic farthest-first) an acceptable substitute for D² probabilistic sampling in our use case?** We prioritize determinism for reproducible recipe checks. What do we lose?

3. **How should we handle cosine similarity compression in 3072-dimensional space?** Should we apply a nonlinear rescaling (e.g., percentile rank) to concept-axis positions for more discriminating visualizations?

4. **Is temporal decay of recipe relevance (stigmergic evaporation) well-modeled by exponential decay, or would a reinforcement-aware function be more appropriate?** See `search-algorithms.md` for our proposed decay functions.

5. **What statistical tests should we apply to concept-axis positions to verify they are meaningful?** TCAV uses a two-sided t-test across examples. What is the equivalent for our embedding-based projection?

---

*Last updated: 2026-04-11. Contributions and corrections welcome — this document is designed to evolve with the system.*

---

## Appendix: Paused Techniques

### Reciprocal Rank Fusion (RRF)

> **Status: Paused (2026-04-11).** RRF was implemented as the hybrid merge layer combining semantic (pgvector) and lexical (tsvector) search results. Simplified to pure vector similarity baseline because the hybrid layer added complexity without validated improvement over semantic-only search. The math and citations are preserved here for reference — RRF may be reintroduced if future experiments demonstrate a quality benefit.

#### Problem

We had two independent search systems: semantic search (vector similarity — catches meaning and paraphrasing) and lexical search (tsvector — catches exact keyword matches). Each produces a ranked list. RRF merged them into a single ranking that benefits from both systems' strengths without being biased by their different score scales.

#### Implementation (as it was)

Given two ranked lists from semantic search ($L_s$) and lexical search ($L_l$), compute a fused score for each document $d$:

$$\text{RRF}(d) = \sum_{L \in \{L_s, L_l\}} \frac{1}{k + \text{rank}_L(d)}$$

where $k = 60$ (standard constant from the original paper) and $\text{rank}_L(d)$ is the 1-based rank of document $d$ in list $L$. If $d$ does not appear in a list, that term is omitted (not zero — the document simply doesn't receive a boost from that system).

Documents appearing in both lists are naturally boosted (two terms summed). The final ranking is by descending $\text{RRF}(d)$.

**Why RRF over linear combination:** Score distributions from semantic search (cosine similarity, roughly 0.3–0.9) and lexical search (ts_rank_cd, roughly 0.001–0.5) are incomparable in scale. RRF operates on ranks, making it immune to score distribution differences.

#### Research Lineage

**Source:** Cormack, G. V., Clarke, C. L. A., & Buettcher, S. (2009). "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods." *Proceedings of the 32nd International ACM SIGIR Conference on Research and Development in Information Retrieval*. https://dl.acm.org/doi/10.1145/1571941.1572114

**Our implementation was a direct application** of the paper's RRF formula. The only parameter choice was $k = 60$, which the paper found robust across datasets.

**Divergence:** The paper evaluates RRF against Condorcet fusion and learning-to-rank methods on TREC collections. We did not conduct this comparison. Our use case (blending semantic + lexical on short recipe texts) may have different characteristics than TREC document collections.

#### Verification Experiments (not conducted)

**Experiment 8: RRF k-sensitivity.** Vary $k \in \{10, 30, 60, 100, 200\}$ and measure search quality (manual relevance judgments on 50 recipe checks). The paper found $k = 60$ robust, but our domain may differ.

**Experiment 9: RRF vs. semantic-only vs. lexical-only.** For 50 recipe checks with known relevant results, compare precision@5 for: (a) hybrid RRF, (b) semantic only, (c) lexical only. Hypothesis: RRF outperforms both individual systems, matching the paper's findings.

*These experiments were not conducted before the technique was paused. They remain relevant if RRF is reintroduced.*
