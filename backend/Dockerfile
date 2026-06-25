# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# Compiles TypeScript → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for any native deps (bcrypt, pg, etc.)
RUN apk add --no-cache python3 make g++ \
 && cp /usr/bin/python3 /usr/bin/python

COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci

COPY src ./src

# Build using the same command CI uses
RUN npm run build

# Drop build-time devDeps to keep the final image small in the next stage
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — production
# Runs as non-root, includes migrations entrypoint
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# wget is used by the HEALTHCHECK below
RUN apk add --no-cache wget

WORKDIR /app

# Create non-root user
RUN addgroup -S crm && adduser -S crm -G crm

# Bring in production node_modules + compiled JS from builder
COPY --from=builder --chown=crm:crm /app/node_modules ./node_modules
COPY --from=builder --chown=crm:crm /app/dist ./dist
COPY --from=builder --chown=crm:crm /app/package.json ./package.json

# Migrations live at the repo root, not inside backend/
# In prod compose, the host ./migrations directory is mounted at /migrations
# and referenced via NODE_PG_MIGRATE_DIR or by symlink. We copy the
# migration runner config but expect /migrations to be present at runtime.
COPY --chown=crm:crm docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER crm

EXPOSE 3000

# Lightweight health check — DB+Redis ping only, per AGENTS.md observability rule
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Default to API server. Worker containers override with:
#   docker run ... <image> node dist/workers/index.js
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
