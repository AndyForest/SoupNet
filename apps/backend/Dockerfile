FROM node:24-alpine AS base
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
RUN npm ci --workspace=apps/backend --workspace=apps/mcp-server --include-workspace-root

# Build
FROM deps AS builder
RUN apk add --no-cache zip
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
FROM node:24-alpine AS runner
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

# Migrations run at startup inside the app (src/index.ts calls runMigrations())
CMD ["node", "dist/index.js"]
