# Soup.net Data Flow

All major flows through the system. Read alongside `data-model.md` and `architecture/overview.md`.

---

## 1. Authentication & Authorization

Two separate auth systems serve different user types:

```mermaid
flowchart TB
    subgraph "Human Users (SPA)"
        H[Browser] -->|POST /auth/login| JWT[JWT Token]
        JWT -->|Authorization: Bearer jwt| SPA[SPA API Routes]
        SPA -->|requireAuth middleware| DB[(PostgreSQL)]
    end

    subgraph "AI Agents"
        subgraph "MCP Agents"
            MC[Claude Code / Desktop] -->|Bearer api-key| MCP["/mcp endpoint"]
            MCP -->|validateKey| DB
        end
        subgraph "Web Agents"
            WA[ChatGPT / Stitch] -->|?key=api-key in URL| CHECK["/check endpoint"]
            CHECK -->|validateKey| DB
        end
        subgraph "API Agents"
            AA[Custom scripts] -->|?key=api-key&format=json| CHECK
        end
    end

    style JWT fill:#e8f5e9
    style MCP fill:#e3f2fd
    style CHECK fill:#fff3e0
```

**JWT auth (human users):**
- `POST /auth/login` returns a JWT signed with `JWT_SECRET` (7-day expiry)
- Used for all SPA API routes (`/recipe-books` — legacy `/groups` 308-redirects, `/keys`, `/traces`, `/admin`)
- `requireAuth` middleware validates JWT and sets `c.get("user")`

**API key auth (AI agents):**
- Two types: daily (`cn_d_` prefix, expires midnight UTC) and scoped (`cn_s_` prefix, user-set expiry up to 1 year)
- Stored as SHA-256 hash in `claimnet.api_keys` table
- Raw key returned only once at creation — never stored
- Each key has: `read_group_ids[]`, `write_group_ids[]`, `default_write_group_id`
- `validateKey()` hashes the incoming key, queries DB, checks expiry, returns group scoping

---

## 2. MCP Request Lifecycle (Stateless)

The MCP endpoint runs in **stateless mode** — every incoming request creates a fresh transport+server pair, processes the request, and discards them. There are no sessions, no session map, no `Mcp-Session-Id` validation. The API key is the only auth state that persists across requests, and it lives in the database.

See [ADR-0021](../adr/0021-stateless-mcp.md) for the full rationale (broken-client epidemic across Claude Code, VSCode, Cursor, LibreChat, Antigravity).

```mermaid
sequenceDiagram
    participant C as Any MCP Client
    participant S as Backend (/mcp)
    participant DB as PostgreSQL

    Note over C,S: Every request is independent
    C->>S: POST /mcp (Authorization: Bearer api-key, body: any JSON-RPC method)
    S->>DB: validateKey(sha256(api-key))
    DB-->>S: {keyId, userId, groups...} or null
    S->>S: new transport + new McpServer (per-request, stateless)
    S->>S: Register tools, dispatch JSON-RPC method
    S-->>C: Response (no Mcp-Session-Id header issued)

    Note over C,S: After server restart — same flow, no recovery needed
    C->>S: POST /mcp (Bearer api-key, possibly with stale Mcp-Session-Id)
    S->>S: Stale Mcp-Session-Id header is ignored (SDK no-ops in stateless mode)
    S-->>C: Response succeeds — no 404, no re-init dance
```

**Why stateless:**
- Stateful sessions per the MCP spec require clients to handle 404 by re-initializing. Almost no major MCP client does this correctly today — it's a documented, ecosystem-wide bug ([Claude Code #27142](https://github.com/anthropics/claude-code/issues/27142), [VSCode #253854](https://github.com/microsoft/vscode/issues/253854), Cursor, LibreChat, Antigravity).
- The only feature we shipped that needed sessions — `elicit_divergent_check`, which used `elicitation/create` over the SSE channel — was unusable in practice (Claude Code rendered it as broken UI; Antigravity didn't surface it at all).
- Stateless mode sidesteps the entire class of stale-session bugs and matches the reference pattern from [`mhart/mcp-hono-stateless`](https://github.com/mhart/mcp-hono-stateless).

**Implications for tool design:**
- Tools must be self-contained per request. No per-session state, no progress notifications, no server→client round trips.
- The `Mcp-Session-Id` header is allowed in CORS so clients that always send it don't trigger preflight failures, but the SDK's `validateSession()` short-circuits when `sessionIdGenerator` is undefined.
- If we ever need elicitation or streaming progress, we'll need to reintroduce sessions — likely with DB-persisted state (canonical reference: [`example-remote-server`](https://github.com/modelcontextprotocol/example-remote-server)). Until then, the divergent-check pattern is described in agent briefings as a natural-conversation move (present 2-4 framings to the user, then `check_recipe` only the chosen one).

---

## 3. Recipe Check Flow (Search-as-Logging)

The core flow — every recipe check is simultaneously a search and a contribution.

```mermaid
sequenceDiagram
    participant A as Agent
    participant S as Backend
    participant DB as PostgreSQL
    participant G as Gemini API
    participant Q as pg-boss

    A->>S: Recipe check (MCP tool / GET-POST /check / JSON API)
    S->>S: Validate API key → get group scoping
    S->>S: Format adherence check (heuristic score 0-1)

    alt Score < 0.3 (reject)
        S-->>A: Error: not a recipe (question/command detected)
    else Score 0.3-0.6 (warn)
        S->>S: Continue with format warning
    end

    S->>DB: Idempotency check (SHA-256 of recipe text)
    alt Existing trace found
        S->>S: Reuse existing trace ID
    else New trace
        S->>DB: INSERT trace (claim_text, group_id, api_key_id)
        S->>DB: INSERT evidence entries + references
        S->>Q: Enqueue embedding job (trace + contextual evidence)
    end

    Note over S: Search pipeline begins
    S->>G: Embed recipe text (RETRIEVAL_QUERY)
    S->>DB: Lexical search (tsvector, ts_rank_cd)
    S->>DB: Semantic search (pgvector HNSW, cosine)
    S->>S: RRF merge (k=60)
    S->>S: Cluster results (K-Means++ if needed)

    opt Concept axes requested
        S->>G: Embed axis terms (2 API calls)
        S->>S: Compute cosine similarity positions
    end

    S->>DB: Enrich results (evidence, references, groups)
    S->>DB: Audit log entry
    S-->>A: Results (HTML / JSON / MCP text)
```

**Three surfaces, same pipeline:**
- **MCP** (`check_recipe` tool): Bearer API key in auth context, text response
- **Web** (`GET/POST /check`): API key in URL, HTML or JSON (`?format=json`)
- **SPA** (`/check` page): Proxied through backend, same pipeline

---

## 4. Embedding Pipeline (Async)

Embeddings never block the recipe check response. They are processed asynchronously by the worker.

```mermaid
flowchart TD
    A[Recipe check creates trace] --> B["INSERT embedding_sources<br/>INSERT embedding_chunk_strategies<br/>status=pending"]
    B --> C["pg-boss: embeddings.process"]
    C --> D["Worker picks up job"]
    D --> E["Chunk: whole trace text<br/>+ contextual evidence chunks<br/>(each prefixed with parent trace)"]
    E --> F["Gemini embedding-2-preview<br/>3072-dim, batch up to 200"]
    F --> G["INSERT embedding_vectors<br/>(halfvec for HNSW search)<br/>INSERT vector_cache<br/>(float32 full precision)"]

    style B fill:#f9f,stroke:#333
    style D fill:#bbf,stroke:#333
```

**Contextual evidence embeddings** (per Anthropic 2024): each evidence chunk is embedded with its parent recipe text prepended, so the embedding captures how the evidence supports the specific claim.

---

## 5. Recipe-Book-Scoped Access Model

The user-facing concept is "recipe book"; the schema-level table is still `groups` per the deferred rename in ADR-0016. The diagram below uses the schema-level names because it describes the literal table layout.

```mermaid
flowchart LR
    U[User] -->|member of| GM[group_members<br/>role: owner/admin/member]
    GM -->|belongs to| G[Recipe Book<br/>table: groups<br/>slug, name, description]
    G -->|org_id| O[Organization]

    AK[API Key] -->|read_group_ids| G
    AK -->|write_group_ids| G
    AK -->|default_write_group_id| G

    T[Trace] -->|group_id| G
    T -->|api_key_id| AK

    subgraph "Per-call recipe-book selection"
        direction TB
        P1["Agent sends recipe_book=slug<br/>(legacy: group=slug)"] --> P2["Resolve slug within key's write recipe books"]
        P3["No recipe book specified"] --> P4["Use key's default_write_group_id"]
    end
```

**Privacy-narrow by default:** Keys default to the most private write recipe book. Agents must explicitly specify `recipe_book=slug` to write to a shared book. Read access spans all readable recipe books unless restricted with `read_recipe_books` (legacy alias: `read_groups`).

---

## Historical: Pre-Pivot Architecture (Payload CMS)

<details>
<summary>Sections below are from the pre-pivot architecture (2026-03-24). Kept for historical reference — they do not reflect the current system. The current system uses Hono, traces/evidence/references, and search-as-logging.</summary>

### User Signup → Personal Org Creation (ACID)

Personal org must exist before the response is returned. Org creation is synchronous within the Payload `afterChange` hook on the Users collection.

```mermaid
sequenceDiagram
    participant C as Client
    participant B as Backend (Payload)
    participant DB as PostgreSQL

    C->>B: POST /api/users (email, password)
    B->>DB: INSERT users (Payload manages)
    Note over B,DB: afterChange hook fires synchronously
    B->>DB: INSERT claimnet.organizations (personal=true, owner=userId)
    B->>DB: INSERT claimnet.org_members (userId, orgId, role=owner)
    DB-->>B: both inserts committed
    B-->>C: 201 {user, token}
    Note over C,B: User now has a personal org — ACL is ready
```

### Claim Submission (Write Path)

Claim submission varies by storage_mode. All modes write the claim record first;
the embedding pipeline and payload handling differ.

```mermaid
sequenceDiagram
    participant A as Agent (MCP/REST)
    participant B as Backend
    participant DB as PostgreSQL
    participant S as S3
    participant Q as pg-boss

    A->>B: POST /api/v1/claims {summary, tags, privacyLevel, storageMode, ...}
    B->>B: Validate org membership (ACL)
    B->>B: Validate storage_mode - public blocked, returns 400

    alt storageMode = full or indexed
        Note over B: Content submitted with claim
        B->>DB: INSERT claimnet.claims (moderationState=pending)
        B->>DB: INSERT claimnet.payload_bundles + payload_files
        B->>DB: INSERT claimnet.embedding_sources (source_type=claim)
        B->>DB: INSERT claimnet.embedding_chunk_strategies
        B->>Q: SEND embeddings.chunk (embeddingSourceId, strategyId)
        DB-->>B: committed (claim write + job enqueue atomic via pg-boss txn)
        B-->>A: 201 {claimId}

        Note over B: For indexed mode only — after vectorization complete
        B->>S: DELETE s3Key, app-managed, no lifecycle rule
        B->>DB: UPDATE payload_files SET s3_key=NULL

    else storageMode = air-gapped
        Note over A: Agent pre-computes vectors via SDK + own Gemini key
        A->>B: POST /api/v1/claims {summary, tags, storageMode=air-gapped, vectors=[...]}
        B->>DB: INSERT claimnet.claims
        B->>DB: INSERT claimnet.embedding_vectors (vector_source=client, status=complete)
        Note over B: No payload_files row — content never transmitted
        DB-->>B: committed
        B-->>A: 201 {claimId}
    end
```

### Embedding Pipeline (Four-Table Worker Chain)

The main app writes `embedding_sources` and `embedding_chunk_strategies` rows. Two workers process them asynchronously.

```mermaid
flowchart TD
    A[Claim/Validation/Request created] --> B[INSERT embedding_sources<br>INSERT embedding_chunk_strategies<br>status=pending]
    B --> C[Worker 1: embeddings.chunk<br>polls chunk_strategies WHERE status=pending]
    C --> D[Run strategy<br>full_document + overlap_256_64 + ...]
    D --> E[INSERT embedding_chunks<br>+ INSERT embedding_vectors stubs<br>status=pending, vector=NULL]
    E --> F[Worker 2: embeddings.vector<br>polls embedding_vectors WHERE status=pending]
    F --> G[Batch Gemini embedding-2-preview<br>up to 200 inputs per API call<br>task_type=RETRIEVAL_DOCUMENT]
    G --> H[UPDATE embedding_vectors<br>vector=halfvec 3072-dim<br>status=complete]
    H --> I[SEND ranking.recompute]

    style B fill:#f9f,stroke:#333
    style C fill:#bbf,stroke:#333
    style F fill:#bbf,stroke:#333
```

### Search / Retrieval Flow (Pre-Pivot)

```mermaid
sequenceDiagram
    participant A as Agent
    participant M as MCP Server
    participant B as Backend
    participant DB as PostgreSQL

    A->>M: call search_claims {query, tags, privacyScopes}
    M->>B: POST /api/v1/search {q, tags, ...}
    B->>B: requireUser (validate Bearer token)
    B->>B: Embed query via Gemini embedding-2-preview
    B->>DB: FTS query (tsvector) → lexical matches
    B->>DB: pgvector HNSW ANN search, halfvec cosine, ACL-scoped
    B->>DB: JOIN ranking_signals → composite score
    B->>B: Merge + rank
    DB-->>B: ranked claim rows
    B-->>M: [{claimId, summary, rankingScore, privacyLevel, storageMode, ...}]
    M-->>A: formatted claim card list
```

### Validation Submission

```mermaid
sequenceDiagram
    participant A as Agent
    participant M as MCP Server
    participant B as Backend
    participant DB as PostgreSQL
    participant Q as pg-boss
    participant W as Worker

    A->>M: call submit_validation {claimId, outcome, confidence, ...}
    M->>B: POST /api/v1/claims/{id}/validate {body}
    B->>B: requireUser + validate org membership
    B->>DB: INSERT claimnet.validations
    B->>DB: INSERT claimnet.embedding_sources (source_type=validation)
    B->>DB: INSERT claimnet.embedding_chunk_strategies
    B->>Q: SEND embeddings.chunk + ranking.recompute {claimId}
    B-->>M: 201 {validationId}
    M-->>A: Validation submitted

    W->>Q: receive ranking.recompute {claimId}
    W->>DB: SELECT validations, knowledge_edges WHERE claim_id=...
    W->>DB: SELECT knowledge_edge_closure → maxAncestorTrustScore
    W->>W: compute RankingSignals
    W->>DB: UPSERT claimnet.ranking_signals
    W->>DB: UPDATE claimnet.claims SET rankingScore=...
```

### Knowledge Edge Creation + Graph Closure

```mermaid
sequenceDiagram
    participant A as Agent
    participant B as Backend
    participant DB as PostgreSQL
    participant Q as pg-boss
    participant W as Worker

    A->>B: POST /api/v1/edges {sourceId, targetId, relationType, ...}
    B->>B: Validate privacy_level + org membership
    B->>DB: SELECT knowledge_edge_closure WHERE ancestor_id=targetId AND descendant_id=sourceId
    Note over B: Cycle check: if sourceId is already a descendant of target → reject 422
    B->>DB: INSERT knowledge_edges
    B->>Q: SEND graph.closure.rebuild {edgeId, sourceId, targetId}
    B-->>A: 201 {edgeId}

    W->>Q: receive graph.closure.rebuild
    W->>DB: Compute new closure rows
    W->>DB: INSERT knowledge_edge_closure (skip duplicates)
    W->>Q: SEND ranking.recompute for affected claims
```

### Payload Fulfillment (Indexed + Air-Gapped — Future)

For indexed-mode claims (S3 content deleted after vectorization) and air-gapped claims
(content never uploaded), payload requests route back to the originating client node.

```mermaid
sequenceDiagram
    participant A as Requester Agent
    participant B as Backend
    participant DB as PostgreSQL
    participant S as S3
    participant N as Originating Client Node
    participant W as Worker

    A->>B: POST /api/v1/claims/{id}/payload
    B->>DB: SELECT payload_files WHERE bundle_id=... AND s3_key IS NOT NULL
    alt Full mode and content available
        B->>S: GeneratePresignedGetUrl
        B-->>A: {downloadUrl, expiresAt}
    else Indexed or air-gapped — no s3_key
        B->>DB: INSERT fulfillment_attempts {nodeId, requesterId, status=pending}
        B->>W: SEND payload.fulfillment {fulfillmentAttemptId, nodeId, claimId}
        B-->>A: 202 {status: fulfillment_requested, retryAfter: 30}

        W->>N: Notify — payload request for claim from requester
        Note over N: Node decides whether to fulfill based on requester identity
        N->>S: PUT payload (presigned upload URL)
        N->>B: POST /api/v1/client-nodes/{id}/fulfill {claimId, sha256}
        B->>DB: UPDATE fulfillment_attempts SET status=complete
        B->>A: Notify requester — payload ready
        A->>B: GET /api/v1/claims/{id}/payload
        B->>S: GeneratePresignedGetUrl
        B-->>A: {downloadUrl, expiresAt}
    end
```

### ACL / Privacy Model (Pre-Pivot)

```mermaid
flowchart LR
    U[User] -->|belongs to| OM[OrgMember<br>role: owner/admin/member]
    OM -->|belongs to| O[Organization]
    O -->|owns| C[Claim]
    O -->|owns| V[Validation]
    O -->|owns| R[Request]

    C -->|privacy_level| PL{Privacy Level}
    PL -->|agent_only| P1[Submitting agent only]
    PL -->|user_only| P2[Submitting user only]
    PL -->|group| P3[Group members<br>via claim_group_shares]
    PL -->|org_only| P4[Org members]

    subgraph Cross-org search
        XO[org_only claims: searchable within org<br>vector_source=client: org-scoped only<br>public: blocked at API]
    end
```

### Two-Schema DB Boundary (Pre-Pivot)

```mermaid
flowchart TB
    subgraph pg[PostgreSQL]
        subgraph pub[public schema — Payload managed]
            U2[users]
            OR[organizations]
            GR[groups + group_members]
            CN[client_nodes]
            AC[api_clients]
        end
        subgraph cn[claimnet schema — Drizzle managed]
            CL[claims]
            VA[validations]
            RE[requests]
            KE[knowledge_edges<br>+ edge_closure]
            NS[neutral_summaries]
            PB[payload_bundles<br>+ payload_files]
            CGS[claim_group_shares]
            ES[embedding_sources<br>→ chunks → vectors]
            RS[ranking_signals]
            FA[fulfillment_attempts]
            AL[audit_log]
        end
    end

    Payload -->|manages migrations| pub
    Drizzle -->|manages migrations| cn

    CL -.->|UUID ref, no FK| U2
    CL -.->|UUID ref, no FK| OR
    VA -.->|UUID ref| CL
    RE -.->|UUID ref| OR
    CGS -.->|UUID ref| GR
```

</details>

---

*Last updated: 2026-04-04.*
