# Code Review — 2026-06-19

> **Skill applied:** `code-review`
> **Reviewer:** MiniMax-M3 (pi agent)
> **Scope:** Initial commit `c6801c4` (amended to `7157835` on `main`) — all 264 tracked files after the hygiene cleanup that removed `node_modules/`, `dist/`, `.env`, and agent runtime dirs from history.
> **Tag for rollback:** `backup-before-cleanup` (still contains the original tree, including `.env` — delete after credential rotation).

## Table of Contents

1. [Cleanup summary](#cleanup-summary)
2. [Critical security action](#critical-security-action-required-from-you)
3. [Review goal & scope](#review-goal--scope)
4. [Tier 1 — Security-critical middleware + migrations](#tier-1--security-critical-middleware--migrations)
5. [Tier 2 — Backend modules](#tier-2--backend-modules)
6. [Tier 3 — Frontend](#tier-3--frontend) (not yet performed)
7. [Missing tests summary](#missing-tests-summary)
8. [Merge readiness verdict](#merge-readiness-verdict)

---

## Cleanup summary

The single commit was amended to remove ~15,400 files of bloat and secrets.

| Metric | Before | After |
|---|---|---|
| Tracked files | 15,646 | **264** |
| Repo size on disk | ~500M+ | 28M |
| Branch | `master` | **`main`** |
| `.gitignore` | Missing | Present |
| `.env` tracked | **Yes** | **No** |
| `backend/node_modules` | 178M | No |
| `backend/dist` | Yes | No |
| Agent runtime dirs | Tracked | Untracked |

No code was modified — only tracked paths were removed from the index via `git rm --cached`, then the initial commit was rewritten with `git commit --amend`.

---

## Critical security action required from you

Even though `.env` is no longer in the current commit, the original commit SHA `c6801c4` and the tag `backup-before-cleanup` still reference a tree that contains `.env`. Anyone with local access can run:

```bash
git show backup-before-cleanup:.env
```

…and recover every secret.

**Action steps (you, not the agent):**

1. **Rotate every credential in `.env`** — database password, JWT key pair, OpenAI key, WhatsApp/Twilio/SendGrid/etc. API keys.
2. Delete the backup tag and expire reflog:
   ```bash
   git tag -d backup-before-cleanup
   git reflog expire --expire=now --all
   git gc --prune=now
   ```
3. Update `.env` locally with the new rotated values.

The agent has **not** read or exposed the contents of `.env` (per AGENTS.md absolute rules). The file remains on disk in the working tree (intentionally — it's gitignored but still present).

---

## Review goal & scope

**Goal:** Identify blocking correctness, security, and project-standards violations across the committed codebase.

**Scope tiers:**

- **Tier 1** (security-critical): `backend/src/shared/middleware/*`, all 7 migrations
- **Tier 2** (modules): 13 backend modules
- **Tier 3** (frontend): 11 pages + shared components (not yet performed)

**Done criteria:** Per-tier report with Blocking / Important / Minor / Missing-tests / Merge-readiness verdict.

---

## Tier 1 — Security-critical middleware + migrations

### Files reviewed

| File | Lines | Test exists? |
|---|---|---|
| `backend/src/shared/middleware/auth.ts` | 49 | ❌ |
| `backend/src/shared/middleware/rbac.ts` | 36 | ❌ |
| `backend/src/shared/middleware/errorHandler.ts` | 35 | ❌ |
| `backend/src/shared/middleware/rateLimiter.ts` | 19 | ❌ |
| `backend/src/shared/middleware/upload.ts` | 17 | ❌ |
| `backend/src/modules/auth/auth.service.ts` | 159 | ✅ (`auth.service.test.ts`) |
| `backend/src/modules/auth/auth.controller.ts` | 74 | ✅ (via `auth.routes.test.ts`) |
| `backend/src/modules/auth/auth.routes.ts` | 41 | ✅ (`auth.routes.test.ts`) |
| `backend/src/modules/auth/auth.schema.ts` | 16 | ❌ |
| `backend/src/modules/auth/auth.repository.ts` | — | ❌ |
| `backend/src/shared/utils/encryption.ts` | 75 | ✅ (`encryption.test.ts`) |
| `migrations/1750000000000_initial-schema.js` | 348 | ❌ |
| `migrations/1750000000001_seed-system-user.js` | 31 | ❌ |
| `migrations/1750000000002_seed-default-pipeline.js` | 51 | ❌ |
| `migrations/1750000000003_seed-scoring-config.js` | 56 | ❌ |
| `migrations/1750000000004_seed-integrations.js` | 41 | ❌ |
| `migrations/1750000000005_add-soft-delete-columns.js` | 75 | ❌ |
| `migrations/1750000000006_add-assignments-table.js` | 67 | ❌ |
| `migrations/1750000000007_rename-user-role-sales-rep-to-sales.js` | 148 | ❌ |

### Blocking issues

#### B1 — `EXCLUDE USING btree` is invalid SQL

**File:** `migrations/1750000000000_initial-schema.js`, lines 100–105

```js
pgm.sql(`
  ALTER TABLE pipeline_stages
    ADD CONSTRAINT one_won_per_pipeline
      EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_won = TRUE),
    ADD CONSTRAINT one_lost_per_pipeline
      EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_lost = TRUE)
`);
```

`EXCLUDE` constraints require `USING gist` or `USING spgist`, **not** `btree`. The author created the `btree_gist` extension earlier in the same migration, indicating the intent was `gist`. As written, this DDL will **error when applied**.

**Fix:** New append-only migration `1750000000008_fix-pipeline-exclude-index-method.js` that:
1. Drops both broken constraints.
2. Re-adds with `EXCLUDE USING gist`.

---

#### B2 — Login timing allows user enumeration

**File:** `backend/src/modules/auth/auth.service.ts`, lines 67–76

```ts
const user = await findUserByEmail(email);
if (!user || !user.is_active) {
  await recordFailedLogin(email);
  throw new AppError('Invalid email or password', 401);
}

const passwordMatches = await bcrypt.compare(password, user.password_hash);  // ~100ms
```

When the user does not exist, bcrypt is skipped (~1ms). When the user exists, bcrypt always runs (~100ms). An attacker can enumerate valid emails via response-time analysis. Additionally, `recordFailedLogin(email)` keys the failed-login counter on attacker-supplied input, which is a DoS vector (an attacker can lock any account by submitting wrong passwords).

**Fix:**
1. Always call `bcrypt.compare(input, DUMMY_HASH)` regardless of whether the user exists.
2. Key the failed-login counter on `user.id` (only when user exists) or use a hashed email to prevent targeted lockout.

---

#### B3 — `.env` was committed (already flagged)

See [Critical security action required from you](#critical-security-action-required-from-you).

---

### Important issues

#### I1 — Security-critical middleware is untested

AGENTS.md requires **90%+ coverage** for auth/RBAC modules. None of the five middleware files have unit tests:

| File | Test |
|---|---|
| `backend/src/shared/middleware/auth.ts` | ❌ |
| `backend/src/shared/middleware/rbac.ts` | ❌ |
| `backend/src/shared/middleware/errorHandler.ts` | ❌ |
| `backend/src/shared/middleware/rateLimiter.ts` | ❌ |
| `backend/src/shared/middleware/upload.ts` | ❌ |

Without tests, refactoring these files is high-risk and the 90% rule cannot be verified.

---

#### I2 — `upload.ts` delegates MIME validation to the import handler (unverified)

**File:** `backend/src/shared/middleware/upload.ts`

```ts
export const leadImportUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },  // 10MB
});
```

The comment states MIME-type validation happens in `leads.import.ts`. Per AGENTS.md: *"File uploads: max 10MB, allowed MIME types: `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`."* This needs verification when Tier 2 reviews `leads/`.

---

#### I3 — Migration 0006 uses `text[]` instead of `user_role[]`

**File:** `migrations/1750000000006_add-assignments-table.js`, line 17

```js
eligible_roles: { type: 'text[]', notNull: true, default: "'{sales_rep}'" },
```

Compare with `report_schedules.target_roles` in migration 0000, which correctly uses `user_role[]`. Type-safety regression: any string can be inserted into `assignment_config.eligible_roles` with no DB-level constraint.

**Fix:** New migration to alter the column type:
```js
ALTER TABLE assignment_config
  ALTER COLUMN eligible_roles TYPE user_role[]
  USING eligible_roles::user_role[];
```

---

#### I4 — Migrations 0001–0004 use raw string interpolation

Files: `1750000000001_seed-system-user.js`, `1750000000002_seed-default-pipeline.js`, `1750000000003_seed-scoring-config.js`, `1750000000004_seed-integrations.js`. All use:

```js
`... VALUES ('${SYSTEM_USER_ID}', ...)`
```

Values are hardcoded constants so injection is impossible today. However, this trains a bad pattern and later migrations (`1750000000007`) use proper `pgm.sql` with `DO $$` blocks. **Standardise on parameterised patterns.**

---

#### I5 — `getMeHandler` has stray `await Promise.resolve()` and inconsistent wrap helper

**File:** `backend/src/modules/auth/auth.controller.ts`, lines ~67–74

```ts
await Promise.resolve();   // dead code, no effect
sendSuccess(res, req.user);
```

**File:** `backend/src/modules/auth/auth.routes.ts`, lines 9–18

Defines a local `wrapLocal` AND imports `wrap` from `asyncHandler`. Only `getMeHandler` uses the imported `wrap`; everything else uses `wrapLocal`. Two helpers, same behaviour.

**Fix:** Remove the local `wrapLocal`, use the shared `wrap` everywhere.

---

#### I6 — `errorHandler.ts` leaks raw Zod error messages

**File:** `backend/src/shared/middleware/errorHandler.ts`, lines 27–29

```ts
sendError(res, err.errors.map((e) => e.message).join(', '), 422);
```

Acceptable in dev, but Zod messages can echo internal field names. Consider mapping to generic "Invalid input" in production with a debug flag.

---

#### I7 — `audit_logs` table exists but `audit.ts` helper is untested

`backend/src/shared/utils/audit.ts` is unverified — cannot confirm it correctly writes to `audit_logs` from controllers.

---

### Minor issues

| # | Issue | Location |
|---|---|---|
| M1 | `auth.ts` does not warn at boot if `JWT_PUBLIC_KEY` is missing | `backend/src/shared/middleware/auth.ts` line 23–25 |
| M2 | System seed user has `password_hash = 'not-a-real-hash'` literal | `migrations/1750000000001` |
| M3 | `auth.service.refresh()` does not rotate the refresh token | `backend/src/modules/auth/auth.service.ts` lines 96–108 |
| M4 | Migration 0006 `assignment_config.updated_by` lacks `onDelete` clause | `migrations/1750000000006` line 14 |
| M5 | `rbac.ts` exports three named conveniences but no per-resource guard helpers | `backend/src/shared/middleware/rbac.ts` lines 25–35 |

---

## Tier 2 — Backend modules

### Files reviewed

13 modules: `auth`, `users`, `custom-fields`, `leads`, `assignments`, `pipeline`, `scoring`, `campaigns`, `outreach`, `integrations`, `templates`, `reports` (empty — Sprint 4), `scraper` (empty — Sprint 4).

All controller, service, repository, routes, schema, types files read. Shared utilities (`audit.ts`, `db.ts`, `redis.ts`, `response.ts`, `logger.ts`, `asyncHandler.ts`, `phone.ts`, `pagination.ts`, `metrics.ts`) also read.

### Blocking issues

#### B4 — Scoring engine ignores 4 of 7 seed rules (silent failure)

**File:** `backend/src/modules/scoring/scoring.service.ts`, lines 121–164

```ts
for (const rule of rules) {
  let matched = false;
  switch (rule.factor) {
    case 'has_website':     matched = !!lead.website; break;
    case 'has_google_rating': matched = lead.google_rating !== null && lead.google_rating >= 3; break;
    case 'high_review_count': matched = lead.review_count !== null && lead.review_count >= 10; break;
    case 'has_email':       matched = !!lead.email; break;
    case 'has_phone':       matched = !!lead.phone; break;
    case 'industry_match':  ... break;
    case 'country_match':   ... break;
    default: matched = false;
  }
  if (matched) totalScore += rule.score_value;
  ...
}
```

The seed rules in migration `1750000000003_seed-scoring-config.js` define 7 rules, but only the rules with factor names matching the switch above are evaluated:

| Seed factor | Service switch case | Evaluated? |
|---|---|---|
| `industry_relevance` (condition `{"match":"target_industry"}`) | `industry_match` reads `condition.industries` | ❌ Mismatch — different factor name AND different condition shape |
| `google_rating` (condition `{"gte":4.0}`) | `has_google_rating` reads hardcoded threshold 3 | ❌ Threshold ignored |
| `review_count` (condition `{"gte":50}`) | `high_review_count` reads hardcoded threshold 10 | ❌ Threshold ignored |
| `has_website` (condition `{"exists":"website"}`) | `has_website` | ✅ Matches |
| `social_presence` (condition `{"exists":"social_links"}`) | none | ❌ Always 0 |
| `source_reliability` (condition `{"source":["google_business","google_ads"]}`) | none | ❌ Always 0 |
| `previous_engagement` (condition `{"replied":true}`) | none | ❌ Always 0 |

The `condition` JSONB column is **never evaluated** anywhere in the scoring engine. Rules defined via the API would have the same fate — only the factor name is inspected.

**Fix:** Replace the switch with a generic rule evaluator that interprets `rule.condition` against the lead row (e.g. `{"gte": <field>}` → numeric compare, `{"exists": <field>}` → not null check, `{"match": [...]}`, `{"replied": true}` → check `replied_at IS NOT NULL`).

---

#### B5 — `campaigns` are hard-deleted (violates soft-delete rule)

**File:** `backend/src/modules/campaigns/campaigns.repository.ts`, line 49

```ts
export async function deleteCampaign(id: string): Promise<void> {
  await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
}
```

AGENTS.md: *"All soft-deletes use `deleted_at` timestamp — never hard-delete lead or campaign records."* The `campaigns` table has a `deleted_at` column (added in migration `1750000000005`), but this repo function bypasses it. Also:
- `findCampaigns()` does not filter `WHERE deleted_at IS NULL` (line 6).
- `findCampaignById()` does not filter `deleted_at IS NULL` (line 12).
- `launchCampaign`, `pauseCampaign`, `resumeCampaign`, `updateCampaign` all bypass the filter.

**Fix:**
1. Change `deleteCampaign` to `UPDATE campaigns SET deleted_at = NOW() WHERE id = $1`.
2. Add `WHERE deleted_at IS NULL` to every SELECT/UPDATE in the campaigns repo.

---

### Important issues

#### I8 — `marketing` role can read all leads (RBAC violation)

**File:** `backend/src/modules/leads/leads.routes.ts`, lines 17–18

```ts
router.use(authenticate, authenticatedLimiter);
router.get('/', wrap(listLeadsHandler));
router.get('/:id', wrap(getLeadHandler));
```

No `authorize()` middleware on `GET /leads` or `GET /leads/:id`. Combined with `leads.service.ts applyScope()`:

```ts
function applyScope(filters: LeadListFilters, actor: Actor): LeadListFilters {
  if (actor.role === 'sales') {
    return { ...filters, assigned_to: actor.id };
  }
  return filters;  // marketing, viewer, manager, admin see ALL
}
```

AGENTS.md RBAC reference says `marketing` has no lead access. The current code lets `marketing` and `viewer` read every lead in the system.

**Fix:**
```ts
router.get('/', authorize('admin', 'manager', 'sales', 'viewer'), wrap(listLeadsHandler));
router.get('/:id', authorize('admin', 'manager', 'sales', 'viewer'), wrap(getLeadHandler));
```
Plus in `applyScope`, also restrict `viewer` to read-only (already partly enforced in `assertAccess`).

---

#### I9 — Lead import validates file extension, not MIME type

**File:** `backend/src/modules/leads/leads.controller.ts`, lines 99–101

```ts
if (!req.file) throw new AppError('No file uploaded (field name must be "file")', 400);
if (!isSupportedFile(req.file.originalname)) {
  throw new AppError('Unsupported file type. Allowed: .csv, .xlsx, .xls', 400);
}
```

`isSupportedFile` (in `leads.import.ts`) checks the filename extension only. AGENTS.md requires:
> *"allowed MIME types: `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`"*

A malicious actor could upload e.g. `evil.exe` renamed to `evil.xlsx`. The `xlsx` parser would attempt to read it and may crash or have a parser bug. The multer middleware (`upload.ts`) does not enforce MIME either.

**Fix:** Add a check using `req.file.mimetype` against the whitelist before parsing.

---

#### I10 — Inconsistent error handling across controllers

Several controllers (assignments, pipeline, scoring, campaigns, integrations) declare handlers with bare `async (req, res) => ...` and use `res.json(...)` directly with no try/catch. Other modules (auth, leads, custom-fields, outreach, templates) wrap in try/catch and call `next(err)`.

When an exception occurs in a non-wrapped handler, Express's default error handler returns HTML (not the standard JSON envelope). The `errorHandler` middleware is not invoked.

**Affected files (non-wrapped):**
- `backend/src/modules/assignments/assignments.controller.ts` (all 6 handlers)
- `backend/src/modules/pipeline/pipeline.controller.ts` (all 10 handlers)
- `backend/src/modules/scoring/scoring.controller.ts` (all 8 handlers)
- `backend/src/modules/campaigns/campaigns.controller.ts` (all 12 handlers)

**Fix:** Wrap each handler in try/catch with `next(err)` or use the shared `wrap()` helper consistently.

---

#### I11 — `req.user!` non-null assertions bypass type safety

Affected files:
- `backend/src/modules/assignments/assignments.controller.ts` (6 handlers)
- `backend/src/modules/pipeline/pipeline.controller.ts` (7 handlers)
- `backend/src/modules/scoring/scoring.controller.ts` (5 handlers)
- `backend/src/modules/campaigns/campaigns.controller.ts` (10 handlers)

Pattern: `const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };`

If `req.user` is undefined (which the type system says is possible — Express types it as optional), this throws `TypeError: Cannot read properties of undefined (reading 'id')`. The error message would leak as 500.

**Fix:** Replace with a guard:
```ts
if (!req.user) throw new AppError('Unauthorized', 401);
```

---

#### I12 — Repository `UPDATE … RETURNING *` returns undefined for 0 rows

Multiple repository functions return `result.rows[0]` without checking. When 0 rows are affected, `result.rows[0]` is `undefined`. The service then writes `newValue: undefined` to `audit_logs`.

**Affected:**
- `backend/src/modules/pipeline/pipeline.repository.ts` `updatePipeline`, `updateStage`
- `backend/src/modules/scoring/scoring.repository.ts` `updateScoringConfig`, `updateScoringRule`
- `backend/src/modules/campaigns/campaigns.repository.ts` `updateCampaign`, `launchCampaign`, `pauseCampaign`, `resumeCampaign`

**Fix:** Check `if (!row) throw new AppError('<Entity> not found', 404);` after every `RETURNING *`.

---

#### I13 — `assignments.routes.ts` exposes config and per-user history to all roles

```ts
router.get('/config', wrap(getConfigHandler));                            // no authorize
router.get('/user/:userId', wrap(getUserAssignmentsHandler));             // no authorize
```

Any authenticated user can read the assignment config (threshold, eligible roles) and any user's assignment history. `PUT /config`, `POST /manual`, `POST /override` are correctly restricted to admin/manager.

**Fix:** Add `authorize('admin', 'manager')` to both reads.

---

#### I14 — `pipeline.moveLead` allows sales but skips ownership check

`backend/src/modules/pipeline/pipeline.routes.ts`, line 36:
```ts
router.post('/move-lead', authorize('admin', 'manager', 'sales'), wrap(moveLeadHandler));
```

But `pipeline.service.moveLead` does not call `assertAccess`. A sales rep can move any lead — including leads not assigned to them — by passing any `lead_id`.

**Fix:** In `moveLead`, fetch the lead first, verify `assigned_to === actor.id` for `sales` role.

---

#### I15 — `assignments` operations don't verify the lead exists

`backend/src/modules/assignments/assignments.service.ts` `assignManually`, `overrideAssignment`, `autoAssignLead` all skip a lead existence check. `updateLeadAssignment` (`UPDATE leads SET assigned_to WHERE id = $1`) silently updates 0 rows if the lead doesn't exist, then `insertAssignment` fails with a Postgres FK violation (23503). The error bubbles up as a 500.

**Fix:** Add `findLeadById(leadId)` check before the assignment write, return 404 cleanly.

---

#### I16 — `campaigns` queries bypass `deleted_at` filter

**File:** `backend/src/modules/campaigns/campaigns.repository.ts`

- `findCampaigns()` line 6 — no `WHERE deleted_at IS NULL`
- `findCampaignById()` line 12 — no `WHERE deleted_at IS NULL`
- `updateCampaign()`, `launchCampaign()`, `pauseCampaign()`, `resumeCampaign()`, `addLeadsToCampaign()`, `removeLeadFromCampaign()`, `findCampaignLeads()`, `getCampaignStats()` — none filter `deleted_at IS NULL`

**Fix:** Add `AND deleted_at IS NULL` to all SELECTs; add `AND deleted_at IS NULL` to all UPDATEs; add `AND deleted_at IS NULL` to `DELETE` operations (or convert to soft-delete — see B5).

---

#### I17 — `assignments.updateLeadAssignment` doesn't filter `deleted_at`

**File:** `backend/src/modules/assignments/assignments.repository.ts`, line 73

```ts
await pool.query('UPDATE leads SET assigned_to = $1 WHERE id = $2', [userId, leadId]);
```

A soft-deleted lead can be re-assigned. The `assignments` row gets created against a deleted lead.

**Fix:** `UPDATE leads SET assigned_to = $1 WHERE id = $2 AND deleted_at IS NULL`.

---

#### I18 — `campaigns.addLeadsToCampaign` swallows all errors silently

**File:** `backend/src/modules/campaigns/campaigns.repository.ts`, lines 95–110

```ts
for (const leadId of leadIds) {
  try {
    const result = await pool.query<CampaignLead>(...);
    ...
  } catch (error) {
    // Skip duplicates or invalid leads
  }
}
```

Empty catch block. A DB outage, an FK violation on a non-existent lead, or a permissions issue would all be silently swallowed. The function returns `results` which may be empty with no indication of failure.

**Fix:** At minimum, log the error with `logger.warn(...)` and aggregate skipped IDs into a returned array. Better: separate the duplicate-skip case from genuine errors.

---

#### I19 — `outreach.routes.ts` missing `authenticatedLimiter`

**File:** `backend/src/modules/outreach/outreach.routes.ts`, line 12

```ts
router.use(authenticate);
```

All other modules apply `authenticatedLimiter` after `authenticate`. Without it, authenticated outreach endpoints are not rate-limited.

**Fix:** `router.use(authenticate, authenticatedLimiter);`

---

#### I20 — `assignments.repository.ts` queries don't filter `users.deleted_at`

`findEligibleUsers` queries `users` but does not filter `WHERE deleted_at IS NULL`. The `users` table does not have a `deleted_at` column in the current schema (only `leads` and `campaigns` do — see migration 0005). If/when soft-delete is added to `users`, this query will need updating.

**Fix:** Add `AND deleted_at IS NULL` when the column is added.

---

### Minor issues

| # | Issue | Location |
|---|---|---|
| M6 | Controllers return via `res.json` directly instead of `sendSuccess`/`sendError` | assignments, pipeline, scoring, campaigns |
| M7 | `customFields.service.ts` re-exports `findActiveDefinitions` from repository — service layer should not pass through repository functions | `backend/src/modules/custom-fields/customFields.service.ts` line 167 |
| M8 | `customFields.controller.ts actorFromReq` falls back to system user UUID if `req.user` is undefined | `customFields.controller.ts` lines 7–12 |
| M9 | `integrations.controller.ts actorFromReq` same fallback pattern | `integrations.controller.ts` lines 7–11 |
| M10 | `audit.ts writeAuditLog` swallows DB errors silently — audit gaps can go undetected | `audit.ts` line 26 |
| M11 | `scoring.service.recalculateAllScores` runs serially over all leads | `scoring.service.ts` lines 218–233 |
| M12 | `pipeline.service.updateStageById` may write `undefined` to audit log when 0 rows affected | `pipeline.service.ts` lines 134–147 |
| M13 | `phone.ts` explicitly documents limitation — local national numbers without country code are not normalised to E.164 | `phone.ts` lines 6–11 |
| M14 | `customFields.repository.ts definitionKeyExists` is exported but never used | `customFields.repository.ts` line 86 |
| M15 | `integrations.repository.ts findAll`, `findByName` exported but never used in current codebase | `integrations.repository.ts` lines 13–24 |
| M16 | `outreach.repository.ts` does not check `deleted_at` on `outreach_logs` or `tasks` (the schema has no `deleted_at` on these tables — by design, they are append-only/atomic) | (acceptable, noted for clarity) |

---

### Tests observed per module

| Module | Service test | Routes test | Schema test | Repository test |
|---|---|---|---|---|
| `auth` | ✅ | ✅ | ❌ | ❌ |
| `users` | ❌ | ❌ | ❌ | ❌ |
| `custom-fields` | ✅ | ❌ | ❌ | ❌ |
| `leads` | ✅ | ✅ | ❌ | ❌ |
| `assignments` | ✅ | ✅ | ✅ (in `__tests__/`) | ❌ |
| `pipeline` | ✅ | ✅ | ✅ (in `__tests__/`) | ❌ |
| `scoring` | ✅ | ✅ | ✅ (in `__tests__/`) | ❌ |
| `campaigns` | ✅ | ✅ | ✅ (in `__tests__/`) | ❌ |
| `outreach` | ✅ | ❌ | ❌ | ❌ |
| `integrations` | ✅ | ❌ | ❌ | ❌ |
| `templates` | ✅ | ❌ | ❌ | ❌ |

**Notable:** No module has a dedicated repository-layer test. Per AGENTS.md, integration tests must use a real PostgreSQL — repositories should have integration tests against a real DB. Currently the routes/service tests likely mock the DB (would need to inspect each test file to confirm — out of scope for this pass).

---

## Tier 3 — Frontend

_(Not yet performed.)_

---

## Missing tests summary

| Required by AGENTS.md | Status |
|---|---|
| Auth middleware 90%+ coverage | ❌ None of 5 middleware files have unit tests |
| RBAC middleware 90%+ coverage | ❌ No test for `rbac.ts` |
| Migration integration tests | ❌ No migration test harness visible |
| Repository tests per module | Partial — only service + routes tests visible; no repository tests |
| Webhook signature tests (Sprint 3) | N/A — not yet written |
| BullMQ worker tests (Sprint 3) | N/A — not yet written |

**Recommended additions:**
- Unit tests for all 5 middleware files (auth, rbac, errorHandler, rateLimiter, upload)
- Repository-layer tests for each module (real DB integration, no mocks)
- Migration test that replays all migrations on a clean PG16 schema — would have caught **B1**
- Tests for `audit.ts` and `response.ts` shared utilities

---

## Merge readiness verdict

| Criterion | Status |
|---|---|
| Branch name correct | ⚠️ Initial commit on `main`; AGENTS.md says feature work branches from `develop`. Confirm intent. |
| `.gitignore` present | ✅ |
| `.env` not tracked | ✅ (rotation still pending) |
| `node_modules` / `dist` not tracked | ✅ |
| Lint passes | Unverified — run `npm run lint` |
| Test suite passes | Unverified — run `npm test` |
| 70% coverage minimum | Unverifiable until coverage run + middleware tests added |
| Security-critical middleware tested | ❌ |
| Migration correctness (B1) | ❌ |

### Verdict: **NOT READY TO MERGE**

**Must do before merge (Blocking):**
1. Fix B1 (EXCLUDE USING gist) in a new migration.
2. Fix B2 (constant-time login, hash-keyed lockout).
3. Fix B4 (scoring engine — replace switch with generic condition evaluator).
4. Fix B5 (campaigns soft-delete + `deleted_at` filters in all repo queries).
5. Rotate `.env` secrets + delete `backup-before-cleanup` tag + expire reflog.

**Must do before merge (Important — correctness):**
6. Fix I8 (lead route RBAC — exclude `marketing` from lead listings).
7. Fix I10 (consistent try/catch + next(err) across all controllers).
8. Fix I11 (remove `req.user!` non-null assertions).
9. Fix I12 (404 handling for 0-row UPDATEs in all repos).
10. Fix I13 (authorize assignment config and per-user reads).
11. Fix I14 (ownership check in `pipeline.moveLead`).
12. Fix I15 (lead existence check in assignments).
13. Fix I16 (campaigns `deleted_at` filters).
14. Fix I17 (assignments lead `deleted_at` filter).

**Should do before merge:**
15. Fix I3 (assignment_config column type — `text[]` → `user_role[]`).
16. Fix I9 (lead import MIME-type validation).
17. Fix I18 (campaigns `addLeadsToCampaign` error visibility).
18. Fix I19 (outreach rate limiter).
19. Standardise migration string-interpolation patterns (I4).
20. Remove `wrapLocal` duplication in `auth.routes.ts` (I5).
21. Add unit tests for all 5 middleware files (I1).
22. Add repository-layer integration tests for every module.

**Decide before merge:**
23. Keep initial commit on `main`, or move to `develop` per AGENTS.md.
24. Run `npm run lint && npm test` and confirm both pass.

---

## How to use this document

- Each issue has a unique ID (B1, I2, M3, etc.) — refer to them in commit messages and PR descriptions.
- Severity legend: **B** = Blocking, **I** = Important, **M** = Minor.
- When an issue is fixed, mark it with ✅ in a "Status" column or remove the entry in a follow-up commit that updates this file.
