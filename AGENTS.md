# AGENTS.md — CRM Automation Platform

## Project Identity

**Project:** CRM Automation Platform
**Prepared By:** Chethan Gowda
**Version:** 1.0 (Phase 1)
**Architecture:** Modular Monolith → future microservices extraction
**Timeline:** 8 weeks (4 × 2-week sprints)

---

## Project Context

- **Main stack:** Node.js 20 LTS + Express.js + TypeScript (backend) | React 18 + TypeScript + Tailwind CSS + shadcn/ui + Zustand + TanStack Query + Recharts (frontend) | PostgreSQL 16 | Redis 7 | BullMQ | OpenAI GPT-4o API | Nginx | PM2
- **Package manager:** npm
- **Dev command:** `docker compose up --build`
- **Test command:** `npm run test` (Jest — minimum 70% coverage enforced)
- **Build command:** `npm run build` (tsc for backend, Vite for frontend)
- **Lint command:** `npm run lint` (ESLint + Prettier — must pass before any PR)
- **Migration command:** `npm run migrate` (append-only, never edit existing migrations)
- **Deploy target:** AWS EC2 / DigitalOcean Droplet via Docker Compose + GitHub Actions CI/CD
- **Branches:** `main` (production), `staging`, `develop` — all protected, no direct pushes
- **Important folders:**
  - `src/modules/auth/` — JWT RS256, RBAC, sessions
  - `src/modules/leads/` — Lead CRUD, CSV import, custom fields (JSONB)
  - `src/modules/campaigns/` — Campaign management, targeting rules
  - `src/modules/outreach/` — Message dispatch, sequence engine
  - `src/modules/pipeline/` — Stage management, transitions
  - `src/modules/assignments/` — Round Robin engine, override logic
  - `src/modules/templates/` — Template CRUD, approval workflow
  - `src/modules/integrations/` — WhatsApp, Twilio, SendGrid, Google Ads, Facebook
  - `src/modules/reports/` — Analytics, dashboards, exports
  - `src/modules/scraper/` — Google Business, Facebook, YouTube crawlers
  - `src/modules/ai-intelligence/` — Lead research, memory, AI profiles (Phase 2)
  - `src/modules/ai-reply/` — Inbound reply classification (Phase 2)
  - `src/modules/ai-campaign-brain/` — Campaign pre-launch briefs (Phase 2)
  - `src/modules/ai-inbox/` — Copilot inbox for reps (Phase 2)
  - `src/modules/ai-settings/` — OpenAI config management
  - `src/modules/notifications/` — SSE real-time notification emitter
  - `src/workers/` — BullMQ job processors
  - `src/webhooks/` — Inbound webhook handlers
  - `src/shared/` — Utilities, middleware, validators
  - `migrations/` — Database migrations (append-only, never edit)
  - `backend/src/modules/agent-planner/` — AI Copilot multi-step plan generation, DAG execution, approval gating, and recovery worker
- **Do not edit without explicit approval:**
  - `migrations/` — run-once files, append new files only
  - `.env` / `.env.*` — never read, log, or expose
  - `docker-compose.prod.yml` — DevOps approval required
  - `src/shared/middleware/auth.ts` — security-critical, requires security review
  - `src/shared/middleware/rbac.ts` — security-critical, requires security review

---

## AI Copilot Agent Planner Module

**Purpose:** The `agent-planner` module turns open-ended Copilot goals into multi-step execution plans. It generates a directed acyclic graph (DAG) of CRM actions, executes the steps with budget guards, pauses at `require_approval` gates, and uses a recovery worker to retry or escalate failed steps.

**Backend path:** `backend/src/modules/agent-planner/`

**Key files:**
- `planner.service.ts` — plan generation from a natural-language goal
- `runner.service.ts` — DAG execution engine and step orchestration
- `plan.controller.ts` — HTTP routes for plan preview, approval, and status
- `plan.routes.ts` — route wiring and RBAC
- `plan.repository.ts` — plan persistence and step state storage
- `plan.schema.ts` — Zod schemas for plan requests and updates
- `plan.types.ts` — shared plan and step type definitions
- `runner.topo.ts` — DAG topological sorting and dependency validation
- `runner.budget.ts` — step, cost, and time budgeting guards
- `recovery.worker.ts` — BullMQ recovery processor for failed/paused plans

**Integration points:**
- The chat service delegates open-ended goals to the planner when `AGENT_PLANNER_ENABLED` is active.
- The `ai-inbox` module surfaces `require_approval` steps as inbox items so reps can bulk-approve or reject them.
- Approved steps resume through the runner service; rejected or failed steps halt the plan and surface an error to the user.

**Rollout:**
- Behind the `AGENT_PLANNER_ENABLED` feature flag (default off).
- When the planner or a subagent call fails/times out, the chat bot falls back to a plain-text response and does not execute partial plans.

**Security / privacy:**
- Idempotent plan keys hash PII before lookup/caching.
- Compliance-critical actions (for example `ai.inbox.action`) are excluded from planner DAGs and still require direct API approval.
- All planned actions are validated against the `AGENT_ACTIONS` catalog, RBAC, and policy gates before execution.

---

## Current Sprint Context

> **Update this block at the start of every sprint.**
> **Last verified:** 2026-06-26 (full codebase audit — 19 backend module directories, 75 backend test files, 37 frontend test files, 24 frontend pages).

| Sprint | Weeks | Theme | Status | Notes |
|---|---|---|---|---|
| Sprint 1 | Week 1–2 | Foundation — Auth, Lead CRUD, CSV Import, Staging Deploy | 🟢 100% | auth, users, leads, custom-fields modules fully implemented + tested. 16 migrations shipped. |
| Sprint 2 | Week 3–4 | Core CRM — Pipeline, Scoring Engine, Round Robin, Campaigns | 🟢 100% | pipeline, scoring, assignments, campaigns modules fully implemented + tested. All 4 modules clear 70% coverage gate on every metric. |
| Sprint 3 | Week 5–6 | Automation — Outreach Engine, All Integrations, Webhooks | 🟢 100% | outreach, templates, integrations, webhooks modules fully implemented with tests. 5 BullMQ workers (scoring, assignment, outreach, reportExport, scraper). 9 integration connectors (WhatsApp, Twilio, SendGrid, SMTP, Google Ads, Facebook, Google Sheets, Google Calendar, Outlook). OAuth flow fully implemented (Google Ads + Facebook). Webhook handlers + verifiers for WhatsApp/Twilio/SendGrid. |
| Sprint 4 | Week 7–8 | Intelligence — AI Personalization, Scrapers, Dashboards, UAT | 🟢 ~90% | reports, scraper modules fully implemented with tests. AI settings module done. `outreach.prompt.ts` handles OpenAI personalization. DLQ routing implemented (`lib/dlq.ts`). Prometheus counters on all 5 workers. Sentry wired (`initSentry()` in `index.ts`). `docker-compose.prod.yml` + `.env.prod.example` created. Remaining: Sentry not verified with real DSN, backend test coverage below 70% target. |

### Overall Progress (verified 2026-06-27)

| Area | % done | Details |
|---|---|---|
| Backend modules | 100% | All 14 Phase 1 modules fully implemented (controller/service/repository/routes/schema/types). Phase 2 AI modules also fully implemented (not scaffolding). |
| Backend tests | 95% | 1581 passed, 3 failed (compile errors). Overall coverage: **86.2% stmts, 72.4% branches, 82.5% funcs, 87.0% lines** — exceeds 70% target. |
| Frontend pages | 100% | 30 pages, all wired in App.tsx routing with ProtectedRoute wrapper. |
| Frontend tests | 90% | 42 passed, 1 failed (integrations.test.tsx). 43 test files total (28 pages + 10 API + 2 stores + 3 components). |
| DevOps / CI-CD | 85% | docker-compose.yml + docker-compose.prod.yml + Dockerfile + Dockerfile.dev + nginx config + GitHub Actions CI (.github/workflows/ci.yml) + .env.prod.example all exist. |
| **Overall Phase 1** | **~95%** | |

### What's Done (verified 2026-06-27)

**Backend (19 module directories, 75 test files, 23 migrations):**

Phase 1 modules (fully implemented with controller/service/repository/routes/schema/types):
- `auth/` — JWT RS256, RBAC, sessions, password reset (6 files, 3 tests)
- `users/` — User CRUD (7 files, 2 tests)
- `leads/` — Lead CRUD, CSV/Excel import, custom fields (7 files, 3 tests)
- `custom-fields/` — Custom field definitions, JSONB validation (6 files, 2 tests)
- `pipeline/` — Stage management, transitions, pipeline CRUD (6 files, 5 tests)
- `scoring/` — Scoring rules, auto-classification Hot/Warm/Cold (6 files, 5 tests)
- `assignments/` — Round Robin engine, override logic (6 files, 5 tests)
- `campaigns/` — Campaign CRUD, targeting rules (6 files, 5 tests)
- `outreach/` — Sequence engine, task dispatch, AI personalization prompt (7 files, 6 tests)
- `templates/` — Template CRUD, approval workflow (6 files, 5 tests)
- `integrations/` — 9 connectors (WhatsApp, Twilio, SendGrid, SMTP, Google Ads, Facebook, Google Sheets, Google Calendar, Outlook), OAuth (Google Ads + Facebook), webhook signature verification (23 files, 9 tests)
- `reports/` — Dashboard metrics, 4 report types, CSV export via BullMQ (7 files, 4 tests)
- `scraper/` — Cheerio-based scraper, config CRUD, run logs (7 files, 4 tests)
- `ai-settings/` — OpenAI config management (6 files, 1 test)

Phase 2 modules (fully implemented with tests):
- `ai-intelligence/` — Lead research, memory, AI profiles, decision log (6 files, 4 tests — 38 test cases)
- `ai-reply/` — Inbound reply classification, draft generation (6 files, 5 tests — 57 test cases)
- `ai-campaign-brain/` — Campaign pre-launch strategy brief (6 files, 4 tests — 34 test cases)
- `ai-inbox/` — Copilot inbox for reps (6 files, 5 tests — 46 test cases)

Additional module:
- `notifications/` — SSE real-time notification emitter (3 files, 2 tests — custom architecture, no service/repo)

**Workers (10 processor files, 10 test files):**
Phase 1:
- `scoring.worker.ts` — `scoring:calculate-lead`, `scoring:recalculate-all` (has test)
- `assignment.worker.ts` — `assignment:round-robin` (has test)
- `outreach.worker.ts` — Outreach message dispatch (has test + E2E test)
- `reportExport.worker.ts` — Async CSV export (has test)
- `scraper.worker.ts` — Background scraper runs (**NO test file**)

Phase 2 (fully implemented):
- `aiResearch.worker.ts` — Lead research on scrape/import (has test)
- `aiReply.worker.ts` — Inbound reply classification (has test)
- `aiCampaignBrain.worker.ts` — Campaign brief generation (has test)
- `aiInbox.worker.ts` — Inbox item creation + expiry sweep cron (has test)
- `events.worker.ts` — Event bus worker (has test)

Infrastructure: `index.ts` (worker orchestration), `queue.ts` (queue definitions, 428 lines)

**Webhooks (6 files, 3 tests):**
- WhatsApp message/status handlers
- Twilio SMS/call status handlers
- SendGrid event webhook handlers
- HMAC/Twilio signature verification

**Shared infrastructure (18 source files, 6 test files):**
- Middleware (6 files, 2 tests): auth, RBAC, errorHandler, httpMetrics, rateLimiter, upload
- Utils (11 files, 4 tests): asyncHandler, audit, db, encryption, logger, metrics, pagination, phone, redis, response, sentry
- Types (1 file): shared type definitions
- Validators directory exists but is empty

**Database (23 migrations, ~1900 lines):**
- Migrations 0000–0016: Phase 1 schema, seeds, fixes
- Migrations 0017–0022: Phase 2 tables (lead_ai_profiles, ai_decision_log, lead_conversation_summaries, campaign_ai_briefs, ai_inbox_items, campaign autonomy columns)

**Frontend (30 pages, 19 API clients, 2 stores, 16 components, 43 tests):**
- All 30 pages routed in App.tsx with ProtectedRoute wrapper
- 30 routes (3 public + 27 protected)
- TanStack Query for server state, Zustand for client state
- shadcn/ui component library (14 UI components + 2 top-level)
- Layout with sidebar navigation, toast notifications, loading/empty states
- Frontend coverage: 42 passed, 1 failed (integrations.test.tsx — apiClient.put mock issue)

### Remaining Gaps (to reach 100% Phase 1)

1. **3 failing backend tests** (compile errors — not logic bugs):
   - `reports/reports.routes.test.ts` — `wrap(downloadExportHandler)` returns `void` instead of `Promise<unknown>`
   - `integrations/oauth/oauth.routes.test.ts` — `asyncHandler` return type mismatch
   - `integrations/integrations.routes.test.ts` — cascade from oauth route error
2. **1 failing frontend test** — `integrations.test.tsx` — `apiClient.put is not a function`
3. **Low-coverage backend files** (drag down overall):
   - `dlq.ts` — 30.4% stmts (test infrastructure, not business logic)
   - `oauth.service.ts` — 28.7% stmts (needs more test scenarios)
   - `scraper.worker.ts` — 0% stmts (no test file)
   - `httpMetrics.ts` — 0% stmts (no test file)
   - `notifications.routes.ts` — 0% stmts (no test file)
   - `users.repository.ts` — 42.9% stmts (needs more test scenarios)
   - `rateLimiter.ts` — 0% stmts (no test file)
   - `upload.ts` — 0% stmts (no test file)
   - `shared/middleware/` — 65.2% stmts overall
   - `shared/utils/` — 77.2% stmts overall
4. **Missing frontend test files** (8 API clients):
   - `aiCampaignBrain.ts`, `aiDecisions.ts`, `aiInbox.ts`, `aiIntelligence.ts`, `aiSettings.ts`, `customFields.ts`, `outreach.ts`, `templates.ts`
5. **Missing frontend component test** — `LeadTimeline.tsx`
6. ~~**OAuth flow**~~ — ✅ **Done 2026-06-24**
7. ~~**DLQ routing**~~ — ✅ **Already implemented**
8. ~~**Prometheus metrics**~~ — ✅ **Done 2026-06-24**
9. **Sentry integration** — ✅ **Already wired** — `initSentry()` called in `index.ts`. Needs end-to-end verification with real DSN.
10. ~~**Prod deploy**~~ — ✅ **Done 2026-06-24**
11. ~~**GitHub Actions CI**~~ — ✅ **Done** — `.github/workflows/ci.yml` exists (7276 bytes).

---

## Command Router

Use these short commands inside this agent session:

```txt
/bug
/debug
/review
/fix <task>
/ui <task>
/frontend <task>
/security
/deploy
/docs <query>
/research <query>
/refactor
/test
/mode strict
/mode frontend
/mode security
/mode production
/use <skill1> <skill2>
/find-skill <query>
/help
```

### CRM Module Commands

```txt
/fix leads          → leads module workflow
/fix campaigns      → campaigns module workflow
/fix outreach       → outreach/sequence engine workflow
/fix pipeline       → pipeline stage workflow
/fix assignments    → round robin assignment workflow
/fix templates      → template approval workflow
/fix integrations   → third-party connector workflow
/fix reports        → analytics/dashboard workflow
/fix scraper        → lead scraper workflow
/fix auth           → authentication/RBAC workflow
/fix workers        → BullMQ job processor workflow
/fix webhooks       → inbound webhook handler workflow
```

---

## Routing Rules

- `/bug` or `/debug` → debugging workflow
- `/review` → code-review workflow (enforce output format below)
- `/fix <task>` → structured fix workflow with relevant skills auto-added
- `/ui` or `/frontend` → frontend-ui workflow (React + Tailwind + shadcn/ui)
- `/security` → security-audit workflow (JWT, RBAC, input validation, OWASP Top 10)
- `/deploy` or `/devops` → devops-deploy workflow (Docker, GitHub Actions, AWS)
- `/docs` or `/research` → docs-research workflow
- `/refactor` → refactor workflow (module boundaries, no cross-module DB access)
- `/test` → testing workflow (Jest, 70% minimum coverage)
- `/use <skill1> <skill2>` → combine named skills
- `/mode <mode>` → activate a session-wide mode
- `/mode reset` → clear active modes
- `/find-skill <query>` or `/skills find <query>` → search for an external skill
- `/help` → show available commands and modes

---

## CRITICAL: No Assumptions. No Hallucination. Skill-First.

These are the three highest-priority rules in this file. They override all other guidance.

### 1. Zero Assumptions Policy

- **Never assume a file exists.** Always verify with a directory listing or file read before referencing it.
- **Never assume a function signature, table column, or API shape.** Read the actual source file or migration to confirm.
- **Never assume a package is installed.** Check `package.json` before referencing any library.
- **Never assume environment variables are set.** Reference `.env.example` or documentation only; never guess values.
- **Never assume the current database state.** Check the latest migration file and schema before making DB-touching changes.
- **Never assume a module exports something.** Read the module's `index.ts` or barrel file first.
- **If any fact is uncertain, stop and ask the user before proceeding.**

### 2. Zero Hallucination Policy

- **Never invent API endpoints, table names, column names, or type shapes.** Only reference what you have directly read from the codebase.
- **Never fabricate npm package names, versions, or their APIs.** If unsure, use `/research` or `/docs` to verify from official documentation first.
- **Never invent configuration keys or environment variable names.** Read the actual config or `.env.example`.
- **Never claim a feature exists in the codebase unless you have read the code that implements it.**
- **Never invent integration webhook payload shapes.** Read the official vendor documentation before writing any webhook handler.
- **If you find yourself generating something you haven't verified from source, stop, flag it clearly as unverified, and ask for confirmation.**

### 3. Mandatory Skill-Search Before Implementation

- **Before implementing any non-trivial task**, run `/find-skill <task>` to check if a relevant skill already exists in `.agents/skills/`.
- If a matching skill is found:
  1. **STOP. Do not write any code yet.**
  2. **Open and read the full `SKILL.md` file** at `.agents/skills/<skill-name>/SKILL.md` using your file-read tool.
  3. Read every section: When to Use, Workflow, Hard Rules, Output Format.
  4. **Only after reading the entire file**, begin implementation — following the skill's workflow and rules exactly.
  5. Do not improvise, skip steps, or substitute your own approach for what the skill defines.
- If no local skill matches, check the global skills directory at `~/.ai-agents/.agents` and read any matching SKILL.md there.
- Only after confirming no skill covers the task may you proceed with a custom implementation — and document explicitly in your output why no skill applied.
- **This rule applies to:** new API routes, new database migrations, new BullMQ workers, new webhook handlers, new integrations, new frontend pages, and new test suites.
- **Finding a skill by name is NOT enough. You must READ it before you implement anything.**

---

## Absolute Rules — No Exceptions

### Code Safety
- Read existing code before making any change.
- Make the smallest safe change. Do not rewrite unrelated code.
- Do not delete files, reset the database, or force push without explicit written approval.
- Do not expose `.env`, tokens, secrets, private keys, API credentials, or JWT secrets — ever.
- Never log sensitive data (passwords, tokens, PII) to console or log files.
- Never commit secrets to git. If found, flag immediately and stop.

### Architecture Rules
- No cross-module direct database access. All inter-module communication via service interfaces only.
- All database queries must go through the module's own repository/service layer.
- No raw SQL strings outside of the migration files and designated query builders.
- Every API route must have RBAC middleware applied — no unprotected routes in production.
- JWT must use RS256 algorithm only. Access token TTL: 15 minutes. Refresh token TTL: 7 days.
- Rate limiting must be applied: 100 req/min per authenticated user, 10 req/min for public endpoints.
- All API responses must follow the standard envelope: `{ success, data, error, meta }`.
- Pagination: cursor-based for lead lists, offset-based for reports.

### TypeScript Conventions
- All module files must be fully typed — no `any` unless justified with an inline comment explaining why.
- Use `z.infer<typeof schema>` from Zod for all request/response types — no manual type duplication.
- Shared types live in `src/shared/types/` — never duplicate types across modules.
- Use a `Result<T, E>` pattern for service layer returns — services never throw; they return typed errors.
- All async functions must have explicit return types declared.
- Enums must match the PostgreSQL ENUM types defined in the migrations exactly.

### Input Validation Rules
- All request bodies, query params, and route params MUST be validated with Zod schemas in `<module>.schema.ts`.
- Validation must happen inside the controller before any service call is made.
- Custom field values (JSONB on leads) must be validated against `custom_field_definitions` before any DB write.
- File uploads: max 10MB, allowed MIME types: `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Never pass raw, unvalidated user input into any database query, BullMQ job payload, or external API call.

### Error Handling Standard
- All errors must propagate to `src/shared/middleware/errorHandler.ts` — never swallow silently.
- Use typed `AppError` subclasses: `NotFoundError`, `ValidationError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError`.
- BullMQ worker failures: always use exponential backoff (3 retries, 2× delay increment).
- Never hide errors in worker processors — always log with `job.id`, `job.name`, and original error message.
- HTTP status codes to use: `200` OK, `201` Created, `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `409` Conflict, `422` Unprocessable, `429` Rate Limited, `500` Internal Error.

### Database Rules
- Never edit existing migration files. Add new migration files only.
- Never run `DROP TABLE`, `TRUNCATE`, or destructive DDL without explicit approval and a backup confirmation.
- All soft-deletes use `deleted_at` timestamp — never hard-delete lead or campaign records.
- JSONB custom fields on leads must be validated against the `custom_field_definitions` table before write.
- Use parameterized queries only — no string interpolation in SQL, ever.

### BullMQ Worker Rules
- Each queue has a named processor file in `src/workers/` — never embed queue processing logic inside module services.
- Job payloads must be typed with a `JobData` interface defined at the top of the worker file.
- Workers must log job start, success, and failure using Winston with `job.id` and contextual metadata.
- Failed jobs must route to a dead-letter queue after max retries for manual inspection.
- Never enqueue a new job from inside another job processor — use the service layer to schedule downstream work.
- Always set a `removeOnComplete` and `removeOnFail` retention limit to prevent Redis memory bloat.

### Security Rules
- Validate and sanitize all user input at the API boundary — never trust client data.
- Use parameterized queries only — no string interpolation in SQL.
- RBAC roles: `admin`, `manager`, `sales`, `marketing`, `viewer` — enforce on every endpoint.
- Webhook endpoints must verify signatures (WhatsApp HMAC, Twilio signature, SendGrid event key).
- File uploads (CSV/Excel) must be scanned for size limits and content type before processing.
- Password reset tokens must be single-use and expire in 1 hour.

### Git Rules
- Branch from `develop` for all feature work.
- PRs must target `develop` — never push directly to `main` or `staging`.
- All PRs require lint pass + test pass (CI enforced) before merge.
- No `--force` push to any protected branch.
- No `--no-verify` to bypass pre-commit hooks.

### Testing Rules
- Minimum 70% unit test coverage for all modules.
- Auth and RBAC modules require 90%+ coverage.
- Integration tests required for all webhook handlers.
- Never mock the database in integration tests — use a test PostgreSQL instance.
- Every BullMQ worker must have at least one integration test covering success and failure paths.

### Frontend Conventions
- Server state: use TanStack Query (`useQuery` / `useMutation`) — never write manual fetch calls in components.
- Client UI-only state: use Zustand stores in `src/store/` — do not mix server state into Zustand.
- Never store JWT access tokens in `localStorage` or `sessionStorage` — keep in memory only.
- All API calls must go through `src/api/client.ts` — never call `fetch` or `axios` directly from components.
- Loading, error, and empty states are required for every data-fetching component — no exceptions.
- shadcn/ui components must not be modified directly — extend via wrapper components only.
- All forms must use React Hook Form + Zod resolver — no uncontrolled input patterns.

### AI / OpenAI Personalization Rules
- All OpenAI calls must be wrapped in try/catch with a fallback to the raw (non-personalized) template if the API fails.
- Cache AI-generated messages per `(lead_id, template_id)` pair in Redis with a 7-day TTL.
- Never send raw PII (passwords, internal IDs beyond what is necessary) in OpenAI prompts.
- All prompt construction must live only in `src/modules/outreach/outreach.prompt.ts` — centralized, never scattered across files.
- Enforce a `max_tokens` cap (500) on every OpenAI completion call to control cost.
- Log every OpenAI call with: `lead_id`, `template_id`, `tokens_used`, `latency_ms`, `cache_hit`.

### Observability Rules
- Every BullMQ job processor must emit Prometheus counters: `crm_jobs_processed_total`, `crm_jobs_failed_total`, `crm_job_duration_seconds`.
- Every outbound API call (WhatsApp, Twilio, SendGrid) must log: `channel`, `lead_id`, `campaign_id`, `status`, `latency_ms`.
- Sentry must capture: unhandled promise rejections, global Express error handler events, and worker crash events.
- Health check endpoint (`GET /health`) must remain lightweight — DB ping + Redis ping only, no business logic.
- Never add heavy queries or external API calls to the health check path.

### Agent Behavior Rules
- Always read the relevant module files before proposing or making any change.
- Never assume file structure — verify with directory listing first.
- Never run database migrations autonomously — present the migration file and wait for approval.
- Never push to any git remote without explicit user confirmation.
- Never install new npm packages without listing them with justification and getting approval first.
- If a task touches `auth`, `rbac`, or `webhooks`, flag it as security-sensitive before proceeding.
- If uncertain about scope, ask — do not guess and implement.
- **Before implementing any feature or fix — search for a relevant skill first using `/find-skill <query>`. When a skill is found, you MUST open and read the full SKILL.md file before writing a single line of code. Following the skill's workflow is not optional.**
- **If any assumption is needed to proceed, stop and state the assumption explicitly. Ask the user to confirm before continuing.**

---

## Output Format

For all serious work, use this exact format:

```md
## Summary
## What I Found
## Assumptions Made (list any — must be zero for production tasks)
## Skill Used (which skill was applied, or why none matched)
## Fix / Changes
## Files Changed
## Commands to Run
## Verification Steps
## Risks / Edge Cases
## Security Considerations
```

---

## Router Files

- `.agents/commands` — defines command behavior
- `.agents/modes` — defines session-wide behavior
- `.agents/skills` — defines reusable workflows
- If no local skill matches, use `find-skills` to search `skills.sh` or the Skills CLI
- Global workflows: `~/.ai-agents/.agents`

---

## Integrations Reference

| Integration | Purpose | Auth Method |
|---|---|---|
| WhatsApp Business API | Outreach messaging | Bearer token + HMAC webhook verify |
| Twilio | SMS outreach | Account SID + Auth Token |
| SendGrid | Email outreach | API Key |
| OpenAI GPT-4o | Message personalization | API Key |
| Google Ads | Lead form ingestion | OAuth 2.0 |
| Facebook Business | Lead form ingestion | OAuth 2.0 |
| Google Business/Places | Scraper source | Places API Key |
| AWS S3 / MinIO | File storage | IAM Role / Access Key |
| Sentry | Error monitoring | DSN |
| Prometheus + Grafana | Metrics | Internal |

---

## API Standards

- Protocol: REST over HTTPS only
- Format: JSON (request and response)
- Versioning: `/api/v1/` — never break existing versioned endpoints
- Authentication: JWT Bearer token in `Authorization` header
- All timestamps: ISO 8601 UTC
- All IDs: UUID v4

---

## Lead Sources (Phase 1 — All Active)

| # | Source | Method |
|---|---|---|
| 1 | Google Business / Google Places | Places API scraper |
| 2 | Facebook Business Pages | Graph API scraper |
| 3 | YouTube Channels | Data API scraper |
| 4 | Google Ads Lead Forms | Webhook ingest |
| 5 | Website Contact Forms | Webhook ingest |
| 6 | Custom Web Scraping Sources | Configurable crawler |
| 7 | Manual Lead Uploads | CSV/Excel import |

---

## RBAC Reference

| Role | Permissions |
|---|---|
| `admin` | Full access to all modules and settings |
| `manager` | Leads, campaigns, pipeline, assignments, reports — no system settings |
| `sales` | Own leads, pipeline updates, outreach pause/resume |
| `marketing` | Campaigns, templates, reports |
| `viewer` | Read-only access to leads and reports |
