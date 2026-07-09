# Debian "slim" (glibc), not Alpine (musl): the optional `local` embedding
# provider loads onnxruntime-node, whose prebuilt native addon is glibc-only —
# it has no musl build, so it neither installs nor loads on Alpine. node_modules
# is built once in `deps`/`builder` and copied wholesale into `runner` (see the
# COPY below), so every stage must be glibc for the native binary to be present
# and loadable at runtime. This is ONE provider-agnostic image: gemini/stub
# deployments also carry @huggingface/transformers + onnxruntime-node and the
# baked model (they just never load them via the dynamic-import gate) — the cost
# is a larger image, not runtime overhead. Trimming the hosted gemini image is a
# deferred decision (see docs/backlog.md). See docs/adr/0023-local-embedding-providers.md
# and docs/planning/local-embedding-provider.md §5.
FROM node:24-slim AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/backend/package.json apps/backend/
COPY apps/mcp-server/package.json apps/mcp-server/
# Optional deps are included by default: onnxruntime-node's glibc prebuilt
# installs cleanly here (Debian), so the `local` provider's native addon ends up
# in node_modules. gemini/stub don't import it (dynamic import gated on provider).
RUN npm ci --workspace=apps/backend --workspace=apps/mcp-server --include-workspace-root

# Build
FROM deps AS builder
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
COPY packages/ packages/
COPY apps/backend/ apps/backend/
COPY apps/mcp-server/ apps/mcp-server/
RUN npm run build --workspace=packages/db
RUN npm run build --workspace=packages/domain
RUN npm run build --workspace=apps/backend

# Bundle MCP desktop extension (.mcpb) into backend public dir
RUN npx tsup apps/mcp-server/src/index.ts --format esm --target node20 --outDir apps/mcp-server/dist --no-splitting --silent
RUN mkdir -p apps/mcp-server/.bundle/server \
    && cp apps/mcp-server/manifest.json apps/mcp-server/.bundle/ \
    && cp apps/mcp-server/dist/index.mjs apps/mcp-server/.bundle/server/index.js \
    && cd apps/mcp-server/.bundle && zip -r /app/apps/backend/public/soupnet.mcpb .

# Production image
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/apps/backend/dist apps/backend/dist
COPY --from=builder /app/apps/backend/public apps/backend/public
COPY --from=builder /app/apps/backend/package.json apps/backend/package.json
# F48: RDS CA bundle for verified TLS to Postgres. The task definition points
# PGSSLROOTCERT at this path (/app/apps/backend/certs/aws-rds-global-bundle.pem).
COPY --from=builder /app/apps/backend/certs apps/backend/certs
COPY --from=builder /app/packages packages

WORKDIR /app/apps/backend
EXPOSE 3001

# ── Local-embedding model bake (offline-capable images) ──────────────────────
# Pre-download the default `local` provider model into HF_HOME at build time so
# the image runs the `local` provider with no network access to the HF hub. The
# offline flags below are set AFTER the bake so this RUN can still fetch weights.
#
# HF_MODEL must match the model id the `local` provider resolves at runtime
# (apps/backend/src/lib/embeddings/local-client.ts default) AND the dtype it
# loads — HF_HUB_OFFLINE=1 only works if every file the runtime requests is
# already cached here. Override at build with --build-arg HF_MODEL=<repo id>;
# users who swap EMBEDDINGS_MODEL without rebuilding should instead mount an
# HF_HOME volume and unset the offline flags (see .env.example / docker-compose).
ENV HF_HOME=/app/apps/backend/.hf-cache
ARG HF_MODEL=Xenova/bge-small-en-v1.5
RUN mkdir -p "$HF_HOME" \
    && HF_MODEL="$HF_MODEL" node -e "import('@huggingface/transformers').then(({ pipeline }) => pipeline('feature-extraction', process.env.HF_MODEL)).then(() => console.log('baked local embedding model:', process.env.HF_MODEL)).catch((err) => { console.error(err); process.exit(1); })" \
    && chown -R node:node "$HF_HOME"
# Runtime: never reach out to the HF hub — weights are baked above. Unset both
# (and mount an HF_HOME volume) if running a model that wasn't baked in.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# F51 (security-audit-2026-06-11): run as the unprivileged node user instead
# of root. The uploads artifact store is the only path the app writes —
# pre-create it with the right ownership (everything else stays root-owned
# read-only, which is the point). The HF cache above is chown'd to node the
# same way so the baked model is readable (and re-downloadable to a volume).
RUN mkdir -p /app/apps/backend/uploads && chown -R node:node /app/apps/backend/uploads
USER node

# Migrations run at startup inside the app (src/index.ts calls runMigrations())
CMD ["node", "dist/index.js"]
