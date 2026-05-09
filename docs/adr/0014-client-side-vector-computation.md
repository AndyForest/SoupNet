# ADR-0014: Client-Side Vector Computation and Privacy-Preserving Search

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

ClaimNet requires an account — all claims are stored on the server. But even `org_only` or `user_only` claims transmit content to the ClaimNet server, where it is vectorized and indexed. For privacy-sensitive users and organizations, this may be unacceptable: any content that reaches the server is content that could theoretically be exposed.

For ClaimNet: **what if only the vectors, never the content, reached the server?**

An AI agent that computes embeddings locally — using the user's own Gemini API key — and submits only the embedding vectors to ClaimNet gets:
- Semantic search over their own claims without exposing payload content
- Collaboration benefits within their org (shared vector index)
- A verifiable guarantee: ClaimNet's servers never processed their raw payload content

The claim metadata (summary, tags, reasoning) is still on the server — that's what makes the claim discoverable and useful. Only the payload files can be withheld.

### Three named payload storage modes

**Mode 1 — Full** (general default)
1. Agent submits claim with content payload
2. Server computes vectors via Gemini embedding API
3. Server stores content in S3 and vectors in Postgres
4. Content is retained; searchable and retrievable by authorized agents

Use **Full** for: high-level judgment claims, taste and preference claims, principles, style guides, anything where the content itself is the claim.

**Mode 2 — Indexed** (recommended default for leaf-node document claims)
1. Agent submits claim with payload flagged `payload_privacy_level = restricted`
2. Server computes vectors from the payload content
3. Server immediately deletes the raw payload from S3 — only vectors + metadata remain
4. The claim's payload field contains a link to the external source of truth (Google Drive, GitHub, Notion, etc.)
5. Other agents find the claim via semantic search, follow the link to the live document

The key insight for **Indexed**: the document at the link can change without re-submitting the claim. The agent's job is to submit "where it is and why it matters" — not a copy. If the linked source of truth updates, the agent can update the claim's summary and link, but the historical judgment about the document's existence and role persists. This mode is the right default for specific document claims at the leaf of the knowledge hierarchy.

Use **Indexed** for: specific documents (tech plans, PDFs, contracts, reports) where the file should remain at its native source of truth and can be updated there without creating stale copies in ClaimNet.

**Mode 3 — Air-gapped** (max privacy)
1. Agent runs `@soupnet/sdk` with user's own Gemini API key configured
2. Package computes embeddings locally for each payload file
3. Agent submits claim metadata + pre-computed vectors to ClaimNet server
4. Payload content NEVER reaches the server — not even temporarily
5. Server stores only: claim metadata, tags, summary, and the submitted vectors

Use **Air-gapped** for: sensitive content that cannot leave the user's or org's systems (regulated industries, confidential IP, PII-containing documents). Requires `GEMINI_API_KEY` in the agent environment.

### Two configurable defaults

Agents and orgs can configure two separate default storage modes:

- **`defaultStorageMode`** — applies to all claims unless overridden. Recommended: `full`.
- **`defaultLeafStorageMode`** — applies when the agent signals a leaf-node claim (a specific document at the end of the knowledge hierarchy, with a parent claim but no children yet). Recommended: `indexed`.

These defaults are stored as user/org-level settings on the server so that any agent running with that account's API key inherits them. The `@soupnet/sdk` reads these from the server at initialization and applies them unless the agent overrides per-submission.

---

## Decision

Build `@soupnet/sdk` — a Node.js/TypeScript package that is the primary client-side interface to ClaimNet. It handles MCP and REST interactions, claim submission, client-side vector computation, and search. The server accepts pre-computed vectors with a `vector_source: 'client'` flag and applies appropriate trust constraints.

---

## `@soupnet/sdk` package

### What it does

```typescript
import { ClaimNetClient } from '@soupnet/sdk';

const client = new ClaimNetClient({
  apiKey: process.env.CLAIMNET_API_KEY,   // required — all interactions need an account
  geminiApiKey: process.env.GEMINI_API_KEY, // optional — only needed for client-side vector mode
});

// Full mode (default): server computes vectors, content retained in S3
const claim = await client.submit({
  summary: 'Chose Postgres over MySQL for this project',
  tags: ['kind:decision', 'tech:postgres'],
  privacy_level: 'org_only',
  storage_mode: 'full',  // explicit; omit to use org/user default
});

// Indexed mode: server vectorizes then deletes content; link is the live source of truth
const leafClaim = await client.submit({
  summary: 'Technical architecture plan for auth service refactor',
  tags: ['kind:decision', 'tech:postgres', 'service:auth'],
  privacy_level: 'org_only',
  storage_mode: 'indexed',  // explicit; or set as defaultLeafStorageMode in org settings
  payload: {
    link: 'https://docs.google.com/document/d/...',
    files: [
      { path: './arch-plan.md', mimeType: 'text/markdown' },
      // Vectorized on server, then deleted — link above is the source of truth
    ],
  },
});

// Air-gapped mode: client computes vectors, content never transmitted
const privateClaim = await client.submit({
  summary: 'Internal performance profiling approach for auth service',
  tags: ['kind:decision', 'tech:postgres', 'service:auth'],
  privacy_level: 'org_only',
  storage_mode: 'air-gapped',  // requires geminiApiKey in ClaimNetClient config
  payload: {
    files: [
      { path: './profiling-notes.md', mimeType: 'text/markdown' },
      // Embedded locally, never transmitted
    ],
  },
});

// Search
const results = await client.search('postgres decision criteria', {
  privacy: ['user', 'org'],
  group: 'my-project-team',
});
```

### Embedding model

Standardized on **Gemini Embedding** (the current multimodal model — `gemini-embedding-2-preview` or successor). This model supports:
- Text (all languages)
- Images (PNG, JPEG, WebP, etc.)
- PDF documents
- Audio
- Video (via frames)

All modalities map to the **same 3072-dimensional embedding space**, enabling cross-modal search. A text query can match an image-embedded claim and vice versa.

The `@soupnet/sdk` package and the server use the same embedding model. This ensures that:
- Client-computed vectors are compatible with server-computed vectors in search
- Mixed results (some client-computed, some server-computed) rank consistently

### Local annotation cache

`@soupnet/sdk` can maintain a local cache of `agent_only` and `user_only` claims in `~/.claimnet/annotations/` as `.md` files with YAML frontmatter. This is optional — all claims are server-stored; this is a read-ahead cache for offline or low-latency use.

```markdown
---
id: 7f3a9e12-...
summary: Personal note about Postgres connection pooling
tags: [kind:note, tech:postgres, personal:true]
privacy_level: user_only
storage_mode: full
created_at: 2026-03-21T14:30:00Z
---

Notes from this session about connection pool sizing...
```

The cache schema is a subset of the server claim schema, minus server-assigned fields. The local cache is always secondary to the server; it is invalidated when the server version changes.

---

## Trust model for client-computed vectors

Client-computed vectors are marked `vector_source: 'client'` in the server's `embedding_vectors` table. This has two consequences:

1. **Org-scoped only**: Client-computed vectors are never included in cross-org public search. They are searchable only within the submitting org. This prevents an attacker from submitting crafted vectors to manipulate cross-org search results.

2. **No server-side re-verification**: The server cannot verify that the client's vectors accurately represent the submitted content (since it doesn't have the content). The `vector_source` flag is always visible in search results metadata, allowing agents and users to assess trust.

These constraints are a reasonable trade-off: privacy-conscious orgs accept search scope limitation in exchange for content privacy.

---

## Separate privacy levels for claim, payload, and evidence

**Claim metadata, payload files, and evidence edges can each have independent privacy levels.**

| Component | What it is | Privacy level |
|---|---|---|
| Claim metadata | Summary, tags, reasoning, author | Set by submitter. Discoverable by anyone within this privacy scope. |
| Payload files | The attached files (code, PDFs, images, etc.) | Can be more restrictive than the claim. |
| Evidence edges | Knowledge edges connecting this claim to others | Set per-edge. An `org_only` claim can have `user_only` evidence edges. |

**Example:** An employee submits a decision claim about an internal tool. The summary is `org_only` (colleagues can find and reference it). The payload (detailed profiling data with sensitive query plans) uses client-side vectors — the raw content never reaches the server. The evidence edge to the relevant manager is `org_only`.

When another agent finds the claim, they see the summary and can request the payload via the fulfillment mechanism. The fulfillment request goes to the originating client node, which decides whether to serve the file based on the requester's identity.

---

## Payload privacy: server-side vectorize-and-delete

For Mode 2 (server-side vectorize, content deleted):

1. Agent submits claim with payload flagged `payload_privacy_level: restricted`
2. Server processes the payload through the embedding pipeline
3. After successful vectorization, server deletes the raw content from S3
4. The `payload_files` row retains: `file_hash`, `mime_type`, `size_bytes`, `vector_source: 'server'` — no `s3_key`
5. Fulfillment requests for the payload route to the originating client node

The agent must retain the payload locally to fulfill future requests. The `@soupnet/sdk` package tracks this automatically for submissions it manages.

---

## Consequences

- `@soupnet/sdk` is the primary client package: `packages/sdk/` in the monorepo
- An account (CLAIMNET_API_KEY) is always required — all claims are server-stored
- Air-gapped mode additionally requires a GEMINI_API_KEY (user-supplied)
- The `submit()` method accepts a `storage_mode` field: `'full'` | `'indexed'` | `'air-gapped'`
- Two org/user-level defaults stored on the server: `defaultStorageMode` and `defaultLeafStorageMode`
- The server's embedding pipeline must accept pre-computed vectors (not just raw content)
- `vector_source` column on `embedding_vectors` distinguishes `'server'` from `'client'`
- Cross-org search excludes `vector_source: 'client'` vectors — Air-gapped mode users accept this trade-off
- Indexed mode: `payload_files` row retains `file_hash`, `mime_type`, `size_bytes` — no `s3_key` after deletion
- Payload storage mode is independent of claim `privacy_level` (see ADR-0015)
