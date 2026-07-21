# Debian "slim" (glibc), not Alpine (musl): the optional `local` embedding
# provider loads onnxruntime-node, whose prebuilt native addon is glibc-only —
# it has no musl build, so it neither installs nor loads on Alpine. node_modules
# is built once in `deps`/`builder` and copied wholesale into `runner`, so every
# stage must be glibc for the native binary to be present and loadable.
#
# ARG EMBEDDINGS_LOCAL (default false) selects the image variant:
#   false (default) — LEAN. Removes @huggingface/* + onnxruntime-* (~150-320 MB)
#                     from node_modules after install and skips the model bake.
#                     gemini never imports them (dynamic import gated on provider;
#                     tsup marks the package external), so the hosted deploy —
#                     which runs `docker build` with NO build-args — is lean.
#   true            — LOCAL-capable. Installs the optional deps and bakes the
#                     default model for offline use. Self-hosters get this via
#                     `docker compose` (sets the arg) or --build-arg EMBEDDINGS_LOCAL=true.
# See docs/adr/0023-local-embedding-providers.md and docs/planning/local-embedding-provider.md §5.
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
# Full install so the build toolchain's own platform-native optional deps
# (@esbuild/*, @rollup/*, …) are present — `--omit=optional` would strip those
# too and break the tsup builds below. The LEAN default then removes ONLY the
# local-embedding ML subtree (@huggingface/* + onnxruntime-*, ~150-320 MB) before
# it is copied into the runner, so gemini/stub images stay small. That's safe:
# the `local` dynamic import is gated on the provider (never reached under
# gemini/stub) and tsup marks the package external, so the build never needs it.
# EMBEDDINGS_LOCAL=true keeps the subtree for the local-capable variant.
ARG EMBEDDINGS_LOCAL=false
RUN npm ci --workspace=apps/backend --workspace=apps/mcp-server --include-workspace-root
RUN if [ "$EMBEDDINGS_LOCAL" != "true" ]; then \
      rm -rf node_modules/@huggingface node_modules/onnxruntime-node \
             node_modules/onnxruntime-web node_modules/onnxruntime-common; \
    fi

# Build
FROM deps AS builder
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
COPY packages/ packages/
COPY apps/backend/ apps/backend/
COPY apps/mcp-server/ apps/mcp-server/
RUN npm run build --workspace=packages/db
# contracts is a RUNTIME import since the canonical Recipe schema (2026-07-18,
# recipe 7945fd8a): its own build must run (tsc + tsup bundle) — domain's
# project-reference tsc pass alone emits extensionless ESM that crashes at
# import time.
RUN npm run build --workspace=packages/contracts
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

# GIT_COMMIT — surfaced by GET /health/version so a benchmark runner can tell
# whether the deployed stack is stale. Passed as a build arg (docker-compose /
# `docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD)`); baked to an env
# var read at runtime. Falls back to "unknown" in the route when unset, so an
# arg-less `docker build` still works.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

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

# ── Local-embedding model bake (LOCAL-capable images only) ───────────────────
# For EMBEDDINGS_LOCAL=true, pre-download the default `local` model into HF_HOME
# at build time so the image runs the `local` provider with no network access to
# the HF hub. Skipped for the lean default (no optional deps installed, nothing
# to bake). The offline flags below are set AFTER the bake so this RUN can fetch.
#
# HF_MODEL must match the model id the `local` provider resolves at runtime
# (apps/backend/src/lib/embeddings/local-client.ts default) AND the dtype it
# loads — HF_HUB_OFFLINE=1 only works if every file the runtime requests is
# already cached here. Override at build with --build-arg HF_MODEL=<repo id>;
# users who swap EMBEDDINGS_MODEL without rebuilding should instead mount an
# HF_HOME volume and unset the offline flags (see .env.example / docker-compose).
ENV HF_HOME=/app/apps/backend/.hf-cache
ARG EMBEDDINGS_LOCAL=false
ARG HF_MODEL=Xenova/bge-small-en-v1.5
RUN if [ "$EMBEDDINGS_LOCAL" = "true" ]; then \
      mkdir -p "$HF_HOME" \
      && HF_MODEL="$HF_MODEL" node -e "import('@huggingface/transformers').then(({ pipeline }) => pipeline('feature-extraction', process.env.HF_MODEL)).then(() => console.log('baked local embedding model:', process.env.HF_MODEL)).catch((err) => { console.error(err); process.exit(1); })" \
      && chown -R node:node "$HF_HOME"; \
    else \
      echo "Lean image (EMBEDDINGS_LOCAL=false): skipping local-model bake"; \
    fi
# Runtime: never reach out to the HF hub — weights are baked above (local variant).
# Inert for the lean/gemini image. Unset both (and mount an HF_HOME volume) to run
# a model that wasn't baked in.
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
