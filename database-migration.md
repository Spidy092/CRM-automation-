# Database Migration Guide
## CRM Automation Platform — PostgreSQL 16
**Prepared By:** Chethan Gowda
**Date:** 18 June 2026
**Version:** 1.0
**Tool:** `node-pg-migrate`
**Reference:** TRD v1.0 | Database Schema v1.0

---

## Current State

| Item | Detail |
|---|---|
| Database | PostgreSQL 16 |
| Migration tool | `node-pg-migrate` |
| DB driver | `node-postgres` (`pg`) — raw parameterized SQL, no ORM |
| Schema version | v1.0 (baseline — greenfield, not yet applied) |
| Tables | 17 |
| ENUM types | 11 |
| Indexes | 30+ (B-tree, GIN, partial) |
| Triggers | 12 (`set_updated_at` on all tables with `updated_at`) |
| Extensions required | `pgcrypto`, `btree_gist` |

---

## Migration Files

| File | Description |
|---|---|
| `migrations/1750000000000_initial-schema.js` | Full schema: extensions, ENUMs, all 17 tables, indexes, trigger function, triggers |
| `migrations/1750000000001_seed-system-user.js` | Seed: internal system user (FK anchor for all seed data) |
| `migrations/1750000000002_seed-default-pipeline.js` | Seed: Default Sales Pipeline + 9 stages |
| `migrations/1750000000003_seed-scoring-config.js` | Seed: scoring config (singleton) + 7 default scoring rules |
| `migrations/1750000000004_seed-integrations.js` | Seed: 10 integration registry rows (all disabled) |

---

## Setup

### 1. Install dependencies

```bash
npm install node-pg-migrate pg
```

Or if using pnpm:

```bash
pnpm add node-pg-migrate pg
```

### 2. Add scripts to `package.json`

```json
{
  "scripts": {
    "migrate:up":     "node-pg-migrate up",
    "migrate:down":   "node-pg-migrate down",
    "migrate:status": "node-pg-migrate status",
    "migrate:create": "node-pg-migrate create"
  },
  "node-pg-migrate": {
    "migrationsTable": "pgmigrations",
    "dir": "migrations",
    "databaseUrlVar": "DATABASE_URL"
  }
}
```

### 3. Set environment variable

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/crm_db
```

Or create a `.env` file (never commit this):

```
DATABASE_URL=postgresql://user:password@localhost:5432/crm_db
```

---

## Running Migrations

### Apply all pending migrations (up)

```bash
npm run migrate:up
# or directly:
DATABASE_URL=postgresql://user:pass@localhost:5432/crm_db npx node-pg-migrate up
```

Expected output:
```
> Migrating files:
> - 1750000000000_initial-schema
> - 1750000000001_seed-system-user
> - 1750000000002_seed-default-pipeline
> - 1750000000003_seed-scoring-config
> - 1750000000004_seed-integrations
> Migrations complete!
```

### Check migration status

```bash
npm run migrate:status
```

### Apply a specific number of migrations

```bash
npx node-pg-migrate up --count 1
```

### Create a new migration file

```bash
npm run migrate:create -- add-lead-deleted-at-column
# Creates: migrations/<timestamp>_add-lead-deleted-at-column.js
```

---

## Rollback

### Roll back the last migration

```bash
npm run migrate:down
# or:
DATABASE_URL=... npx node-pg-migrate down
```

### Roll back all 5 migrations (full teardown)

```bash
DATABASE_URL=... npx node-pg-migrate down --count 5
```

### Rollback order (reverse of apply order)

```
5. 1750000000004_seed-integrations        → DELETE integrations rows
4. 1750000000003_seed-scoring-config      → DELETE scoring_rules + scoring_config rows
3. 1750000000002_seed-default-pipeline    → DELETE pipeline (stages cascade)
2. 1750000000001_seed-system-user         → DELETE system user
1. 1750000000000_initial-schema           → DROP triggers → DROP tables → DROP ENUMs → DROP extensions
```

> ⚠️ **Never run rollback on production** without a full database backup. The schema migration drops all tables.

---

## Verification Queries

Run these after `migrate:up` to confirm the schema is correct.

### 1. Confirm all tables exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

**Expected tables (17):**
```
audit_logs
campaign_leads
campaigns
custom_field_definitions
integrations
leads
outreach_logs
outreach_sequences
pipeline_stages
pipelines
refresh_tokens
report_schedules
scoring_config
scoring_rules
tasks
templates
users
```
*(Note: `pgmigrations` is also present — that's the migration tracking table)*

---

### 2. Confirm all ENUM types exist

```sql
SELECT typname
FROM pg_type
WHERE typcategory = 'E'
ORDER BY typname;
```

**Expected (11):**
```
campaign_status
custom_field_type
lead_classification
lead_status
message_channel
outreach_status
outreach_tone
task_status
task_type
template_approval_status
user_role
```

---


### 3. Confirm all indexes exist

```sql
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

**Expected count:** 30+ indexes across all tables.

---

### 4. Confirm triggers are attached

```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
```

**Expected (12 triggers):**
```
trg_campaigns_updated_at              → campaigns
trg_custom_field_definitions_updated_at → custom_field_definitions
trg_leads_updated_at                  → leads
trg_outreach_logs_updated_at          → outreach_logs
trg_outreach_sequences_updated_at     → outreach_sequences
trg_pipeline_stages_updated_at        → pipeline_stages
trg_pipelines_updated_at              → pipelines
trg_report_schedules_updated_at       → report_schedules
trg_scoring_rules_updated_at          → scoring_rules
trg_tasks_updated_at                  → tasks
trg_templates_updated_at              → templates
trg_users_updated_at                  → users
```

---

### 5. Confirm seed data

```sql
-- System user
SELECT id, name, email, role FROM users WHERE id = '00000000-0000-0000-0000-000000000001';

-- Default pipeline
SELECT id, name, is_default FROM pipelines WHERE id = '00000000-0000-0000-0000-000000000010';

-- Pipeline stages (expect 9 rows)
SELECT name, position, is_terminal_won, is_terminal_lost
FROM pipeline_stages
WHERE pipeline_id = '00000000-0000-0000-0000-000000000010'
ORDER BY position;

-- Scoring config (expect 1 row)
SELECT hot_min_score, warm_min_score, assignment_threshold FROM scoring_config;

-- Scoring rules (expect 7 rows)
SELECT factor, weight, score_value, is_active FROM scoring_rules ORDER BY weight DESC;

-- Integrations (expect 10 rows, all disabled)
SELECT name, display_name, is_enabled FROM integrations ORDER BY name;
```

---

### 6. Confirm EXCLUDE constraints on pipeline_stages

```sql
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'pipeline_stages'::regclass
  AND contype = 'x';
```

**Expected:**
```
one_won_per_pipeline   | x
one_lost_per_pipeline  | x
```

---

### 7. Confirm deduplication indexes on leads

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads'
  AND indexname IN ('idx_leads_dedup_email', 'idx_leads_dedup_phone');
```

---

### 8. Smoke test: updated_at trigger fires

```sql
-- Insert a test user
INSERT INTO users (name, email, password_hash, role)
VALUES ('Test User', 'test@example.com', 'hash', 'sales_rep')
RETURNING id, created_at, updated_at;

-- Wait 1 second, then update
UPDATE users SET name = 'Test User Updated' WHERE email = 'test@example.com';

-- Confirm updated_at changed
SELECT name, created_at, updated_at FROM users WHERE email = 'test@example.com';

-- Clean up
DELETE FROM users WHERE email = 'test@example.com';
```

---

## Risks & Notes

| Risk | Severity | Detail |
|---|---|---|
| `btree_gist` extension required | Medium | Needed for EXCLUDE constraints on `pipeline_stages`. Migration enables it automatically. If running on a restricted PG instance (e.g., AWS RDS), ensure the extension is available. |
| Seed system user is an FK anchor | High | Migrations 2–4 reference `00000000-0000-0000-0000-000000000001`. Always run migration 1 before 2–4. Rollback must reverse this order. |
| `scoring_config` singleton | Low | The `idx_scoring_config_singleton` unique index on `(TRUE)` enforces one row. Attempting to insert a second row will fail. |
| `outreach_logs` partitioning | Low | The schema includes a comment noting Phase 2 will partition `outreach_logs` by month on `sent_at`. This is **not** applied in this migration. A separate migration will handle it when volume warrants it. |
| `pgcrypto` extension | Low | Required for `gen_random_uuid()`. Available on all standard PostgreSQL 16 installations including AWS RDS and Supabase. |
| Production migrations | Critical | Always take a `pg_dump` backup before running migrations on production. Never run `migrate:down` on production without explicit approval. |

---

## Phase 2 Migration Candidates

These are deferred from Phase 1 per the Development Roadmap:

| Future Migration | Trigger |
|---|---|
| Partition `outreach_logs` by month on `sent_at` | When monthly outreach volume exceeds ~100k rows |
| Add `deleted_at` soft-delete column to `leads` | If hard-delete is replaced with soft-delete |
| Add `outreach_logs` read replica routing | When reporting queries impact write performance |
| Add `leads.last_contacted_at` computed column | If activity timeline queries become slow |
| Add full-text search index on `leads.business_name` | If search performance degrades |

---

## Docker Compose (Local Development)

The `docker-compose.yml` for local dev should include:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: crm
      POSTGRES_PASSWORD: crm_dev_password
      POSTGRES_DB: crm_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Then run migrations against it:

```bash
DATABASE_URL=postgresql://crm:crm_dev_password@localhost:5432/crm_db npm run migrate:up
```

---

## Manual Rollback Procedure (Emergency)

If `node-pg-migrate down` fails mid-way, use these manual SQL commands in order:

```sql
-- Step 1: Drop all triggers
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
DROP TRIGGER IF EXISTS trg_templates_updated_at ON templates;
DROP TRIGGER IF EXISTS trg_outreach_sequences_updated_at ON outreach_sequences;
DROP TRIGGER IF EXISTS trg_outreach_logs_updated_at ON outreach_logs;
DROP TRIGGER IF EXISTS trg_pipelines_updated_at ON pipelines;
DROP TRIGGER IF EXISTS trg_pipeline_stages_updated_at ON pipeline_stages;
DROP TRIGGER IF EXISTS trg_scoring_rules_updated_at ON scoring_rules;
DROP TRIGGER IF EXISTS trg_custom_field_definitions_updated_at ON custom_field_definitions;
DROP TRIGGER IF EXISTS trg_report_schedules_updated_at ON report_schedules;
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;

-- Step 2: Drop trigger function
DROP FUNCTION IF EXISTS set_updated_at();

-- Step 3: Drop tables in reverse FK dependency order
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS report_schedules;
DROP TABLE IF EXISTS integrations;
DROP TABLE IF EXISTS outreach_logs;
DROP TABLE IF EXISTS campaign_leads;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS outreach_sequences;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS scoring_rules;
DROP TABLE IF EXISTS scoring_config;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS leads;
DROP TABLE IF EXISTS custom_field_definitions;
DROP TABLE IF EXISTS pipeline_stages;
DROP TABLE IF EXISTS pipelines;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

-- Step 4: Drop ENUM types
DROP TYPE IF EXISTS custom_field_type;
DROP TYPE IF EXISTS task_status;
DROP TYPE IF EXISTS task_type;
DROP TYPE IF EXISTS template_approval_status;
DROP TYPE IF EXISTS outreach_status;
DROP TYPE IF EXISTS message_channel;
DROP TYPE IF EXISTS outreach_tone;
DROP TYPE IF EXISTS campaign_status;
DROP TYPE IF EXISTS lead_status;
DROP TYPE IF EXISTS lead_classification;
DROP TYPE IF EXISTS user_role;

-- Step 5: Drop extensions (only if safe to do so)
DROP EXTENSION IF EXISTS "btree_gist";
DROP EXTENSION IF EXISTS "pgcrypto";

-- Step 6: Clear migration tracking table
DROP TABLE IF EXISTS pgmigrations;
```

---

*Document prepared by: Chethan Gowda | Migration Guide v1.0 | 18 June 2026*
