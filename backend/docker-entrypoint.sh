#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Production entrypoint for the API container.
# Runs database migrations, then execs the given command (default: start API).
#
# Migrations are idempotent (node-pg-migrate) — safe to re-run.
# Only the `api` service runs migrations. The `worker` service overrides the
# command and skips migrations to avoid race conditions.
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "[entrypoint] NODE_ENV=${NODE_ENV:-production}"

# Only run migrations if explicitly enabled. Set RUN_MIGRATIONS=true for the
# api service in docker-compose.prod.yml. Workers leave this unset.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] Running database migrations…"
  # node-pg-migrate is configured to read migrations from /migrations
  # (mounted from the host) via node-pg-migrate.dir in package.json.
  # We override the directory at runtime to be safe.
  npm run migrate -- --migrations-dir /migrations --database-url-var DATABASE_URL
  echo "[entrypoint] Migrations complete."
fi

echo "[entrypoint] Starting: $*"
exec "$@"
