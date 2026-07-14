# CLAUDE.md — AI Sales Operator / CRM Automation Platform

## Project Identity

**Project:** AI Sales Operator — CRM Automation Platform
**Prepared By:** Chethan Gowda
**Version:** 2.0 (Phase 2 — AI Sales Operator)
**Phase 1:** Complete (8 weeks, Sprints 1–4, ~85–90% done as of 2026-06-26)
**Phase 2:** In Progress (8 weeks, Sprints 5–8, ~10–15% scaffolded as of 2026-06-26)
**Architecture:** Modular Monolith → future microservices extraction
**Timeline:** Phase 1: 8 weeks | Phase 2: 8 weeks | Total: 16 weeks

> **Full Phase 2 spec:** `docs/phase-2-ai-sales-operator.md` — read this before implementing any Phase 2 module.

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
  - `src/modules/campaigns/` — Campaign management, targeting rules, autonomy config (Phase 2)
  - `src/modules/outreach/` — Message dispatch, sequence engine
  - `src/modules/pipeline/` — Stage management, transitions
  - `src/modules/assignments/` — Round Robin engine, override logic
  - `src/modules/templates/` — Template CRUD, approval workflow
  - `src/modules/integrations/` — WhatsApp, Twilio, SendGrid, Google Ads, Facebook
  - `src/modules/reports/` — Analytics, dashboards, exports
  - `src/modules/team-metrics/` — Team dashboard, per-member aggregates, response-time tracking
  - `src/modules/activities/` — Lead-scoped activity timeline, stage/assignment auto-logging
  - `src/modules/scraper/` — Google Business, Facebook, YouTube crawlers
  - `src/modules/ai-intelligence/` — *(Phase 2)* Lead AI profiles, memory, research agent, decision log
  - `src/modules/ai-reply/` — *(Phase 2)* Inbound reply classifier, intent detection, draft generator
  - `src/modules/ai-campaign-brain/` — *(Phase 2)* Pre-launch campaign strategy brief
  - `src/modules/ai-inbox/` — *(Phase 2)* AI Sales Copilot inbox for reps
  - `src/modules/ai-settings/` — OpenAI config management
  - `src/modules/notifications/` — SSE real-time notification emitter
  - `src/workers/` — BullMQ job processors (Phase 2 adds: aiResearch, aiReply, aiDecision, aiCampaignBrain, aiInbox)
  - `src/webhooks/` — Inbound webhook handlers
  - `src/shared/` — Utilities, middleware, validators
  - `migrations/` — Database migrations (append-only, never edit)
- **Do not edit without explicit approval:**
  - `migrations/` — run-once files, append new files only
  - `.env` / `.env.*` — never read, log, or expose
  - `docker-compose.prod.yml` — DevOps approval required
  - `src/shared/middleware/auth.ts` — security-critical, requires security review
  - `src/shared/middleware/rbac.ts` — security-critical, requires security review

---

## Current Sprint Context

> **Update this block at the start of every sprint.**
> **Last verified:** 2026-06-26 (full codebase audit — 19 backend module directories, 75 backend test files, 37 frontend test files, 24 frontend pages).

### Phase 1 — Automation CRM (Weeks 1–8) — ~85–90% Complete

| Sprint | Weeks | Theme | Status | Notes |
|---|---|---|---|---|
| Sprint 1 | Week 1–2 | Foundation — Auth, Lead CRUD, CSV Import, Staging Deploy | 🟢 100% | auth, users, leads, custom-fields modules fully implemented + tested. 16 migrations shipped. |
| Sprint 2 | Week 3–4 | Core CRM — Pipeline, Scoring Engine, Round Robin, Campaigns | 🟢 100% | pipeline, scoring, assignments, campaigns modules fully implemented + tested. All 4 modules clear 70% coverage gate on every metric. |
| Sprint 3 | Week 5–6 | Automation — Outreach Engine, All Integrations, Webhooks | 🟢 100% | outreach, templates, integrations, webhooks modules fully implemented with tests. 5 BullMQ workers (scoring, assignment, outreach, reportExport, scraper). 9 integration connectors (WhatsApp, Twilio, SendGrid, SMTP, Google Ads, Facebook, Google Sheets, Google Calendar, Outlook). OAuth flow fully implemented (Google Ads + Facebook). Webhook handlers + verifiers for WhatsApp/Twilio/SendGrid. |
| Sprint 4 | Week 7–8 | Intelligence — AI Personalization, Scrapers, Dashboards, UAT | 🟢 ~90% | reports, scraper modules fully implemented with tests. AI settings module done. `outreach.prompt.ts` handles OpenAI personalization. DLQ routing implemented (`lib/dlq.ts`). Prometheus counters on all 5 workers. Sentry wired (`initSentry()` in `index.ts`). `docker-compose.prod.yml` + `.env.prod.example` created. Remaining: Sentry not verified with real DSN, backend test coverage below 70% target. |

### Phase 2 — AI Sales Operator (Weeks 9–16) — 🟡 ~10–15% Scaffolded

> **Feature 3 (Team Dashboard + Response Time Tracking) and Feature 4 (Activity Timeline)** are implemented end-to-end in this branch: `GET /api/v1/team/metrics`, `GET/POST /api/v1/leads/:id/activities`, auto-logging of stage/assignment changes, and LeadDetailPage timeline UI. See `src/modules/team-metrics/` and `src/modules/activities/`.

> **Full spec:** `docs/phase-2-ai-sales-operator.md` — read before implementing anything in Phase 2.

| Sprint | Weeks | Theme | Status | Notes |
|---|---|---|---|---|
| Sprint 5 | Week 9–10 | AI Foundation + Memory — Lead AI profiles, event bus, research agent, next-action engine | 🟡 ~30% scaffolded | Migrations 017–022 done. 4 AI modules scaffolded (ai-intelligence, ai-reply, ai-campaign-brain, ai-inbox). 4 AI workers + events.worker.ts created. `src/shared/events/` NOT yet created (eventBus.ts missing). No frontend Phase 2 pages. No aiDecision.worker.ts. |
| Sprint 6 | Week 11–12 | AI Reply Handler + Campaign Brain — inbound classification, pre-launch brief | 🔴 Not started | ai-reply and ai-campaign-brain have repo+service+types but no controller/routes/schema, no tests |
| Sprint 7 | Week 13–14 | AI Copilot Inbox + Autonomy Engine — rep inbox, autopilot/guarded/supervised modes | 🔴 Not started | ai-inbox has full module structure (6 files) but zero tests. No autonomy engine logic. |
| Sprint 8 | Week 15–16 | Polish + Coverage + Production Hardening — 70% coverage, observability, UAT | 🔴 Not started | All Phase 2 modules ≥70%. Prometheus AI metrics. Grafana dashboard. Load test. |

### Overall Progress

#### Phase 1 (verified 2026-06-27)

| Area | % done | Details |
|---|---|---|
| Backend modules | 100% | All 14 Phase 1 modules fully implemented (controller/service/repository/routes/schema/types). Phase 2 AI modules also fully implemented (not scaffolding). |
| Backend tests | 95% | 1581 passed, 3 failed (compile errors). Overall coverage: **86.2% stmts, 72.4% branches, 82.5% funcs, 87.0% lines** — exceeds 70% target. |
| Frontend pages | 100% | 30 pages, all wired in App.tsx routing with ProtectedRoute wrapper. |
| Frontend tests | 90% | 42 passed, 1 failed (integrations.test.tsx). 43 test files total (28 pages + 10 API + 2 stores + 3 components). |
| DevOps / CI-CD | 85% | docker-compose.yml + docker-compose.prod.yml + Dockerfile + Dockerfile.dev + nginx config + GitHub Actions CI (.github/workflows/ci.yml) + .env.prod.example all exist. |
| **Overall Phase 1** | **~95%** | |

#### Phase 2 (as of 2026-06-27 — ~90% complete)

| Area | Target | % done | Notes |
|---|---|---|---|
| AI backend modules (4 new + 1 extended) | ai-intelligence, ai-reply, ai-campaign-brain, ai-inbox | 100% | All 4 modules fully implemented with controller/service/repository/routes/schema/types. All routes mounted in index.ts with RBAC + rate limiting. |
| AI workers (5 new) | aiResearch, aiReply, aiDecision, aiCampaignBrain, aiInbox | 100% | All 5 workers + events.worker implemented and registered in workers/index.ts. All have test files. |
| Event bus | eventBus.ts + ai.events.ts | 100% | `src/shared/events/eventBus.ts` + `ai.events.ts` created with 9 event types. |
| DB migrations (6 new: 017–022) | lead_ai_profiles, ai_decision_log, ai_conversation_summaries, campaign_ai_briefs, ai_inbox_items, campaign autonomy columns | 100% | All 6 migrations created. |
| Frontend AI pages (4 new) | AIInboxPage, LeadAIProfilePage, CampaignBriefPage, AIDecisionLogPage | 100% | All 4 pages implemented and routed in App.tsx. |
| Test coverage Phase 2 | All modules ≥70% | 95% | 299 tests all passing. ai-intelligence (38), ai-reply (57), ai-campaign-brain (34), ai-inbox (46), ai-settings (9). Gaps: events.worker.ts no test, ai-settings missing controller/routes/repository tests. |
| **Overall Phase 2** | | **~90%** | |

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

### Remaining Gaps (to reach 100% Phase 2)

1. **`events.worker.ts`** — 205 lines of logic, **0 test file** (medium severity)
2. **`ai-settings/`** — only `service.test.ts` exists; controller, routes, repository tests missing (low severity)
3. **`computeNextBestAction`** — implemented in service but no controller endpoint exposes it yet (low severity)

### Phase 2 Starting Checklist

Before Sprint 5 begins, these Phase 1 items must be resolved:
- [x] Backend coverage ≥70% (now 86.2% stmts) — ✅ **MET**
- [ ] Sentry verified end-to-end with a real DSN
- [x] Inbound webhook handlers updated to emit `lead.reply.received` domain events — ✅ **DONE**

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

### Phase 2 AI Module Commands

```txt
/fix ai-intelligence    → lead AI profile, memory, research agent, next-action engine
/fix ai-reply           → inbound reply classifier, intent detection, draft response
/fix ai-campaign-brain  → pre-launch campaign brief generator
/fix ai-inbox           → AI copilot inbox for sales reps
/fix ai-workers         → AI BullMQ workers (aiResearch, aiReply, aiDecision, aiCampaignBrain, aiInbox)
/fix event-bus          → domain event bus (eventBus.ts, ai.events.ts)
/fix autonomy           → autonomy engine (supervised/guarded/autopilot modes)
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

---

## Phase 2 AI Architecture Rules — No Exceptions

> These rules extend the Absolute Rules above. They apply to all Phase 2 AI modules (`ai-intelligence`, `ai-reply`, `ai-campaign-brain`, `ai-inbox`, all AI workers, event bus).
> **Before implementing any Phase 2 module, read the full spec: `docs/phase-2-ai-sales-operator.md`.**

### AI Memory Rules
- `lead_ai_profiles` is the single source of truth for all AI knowledge about a lead — never store AI state anywhere else.
- Redis may cache `next_best_action` and `buying_intent` with a 1-hour TTL — the PostgreSQL record is always authoritative.
- Memory fields `buying_signals`, `objection_log`, `do_not_say` are always **appended to** — never overwritten or deleted.
- Conversation summaries are **regenerated** (not appended) from full history — keep under 500 tokens.
- AI profile cache in Redis TTL: 24 hours — invalidated immediately on new inbound message or stage change.

### AI Thinking / Reasoning Rules
- Every AI decision must produce a `chain_of_thought` string logged to `ai_decision_log`.
- Chain-of-thought structure: **Context → Options → Reasoning → Decision → Confidence**.
- Workers must never make decisions with confidence < 30 — route to `request_review` inbox item instead.
- Default confidence threshold for autonomous action: 75 (configurable per campaign via `ai_min_confidence`).
- All reasoning must cite specific data from the lead profile — no generic or hallucinated reasoning.

### Autonomous Operation Rules
- AI may send messages autonomously only when: campaign `autonomy_level = 'autopilot'` **AND** confidence ≥ `ai_min_confidence`.
- In `guarded` mode: AI drafts → creates `approve_response` inbox item → auto-sends after 4h if no human action.
- In `supervised` mode: AI drafts → creates inbox item → waits for explicit human approval — no timeout auto-send.
- **Opt-out / angry replies (`intent_class = 'opt_out'`) ALWAYS stop the sequence immediately — no AI override, ever.**
- AI must never send more than 1 unsolicited message per lead per 24-hour window — enforced at worker level.
- Manager can pause all AI autonomous actions for a campaign at any time — pause is respected within 1 job cycle.

### Event-Driven Rules
- AI workers must be purely event-reactive — never poll the database for leads to process.
- Every domain event must be idempotent — processing the same event twice must produce no duplicate actions.
- Event payloads carry only IDs — workers fetch full context from DB; never trust payload data directly.
- All events logged with timestamp, event type, and payload to `ai_decision_log`.
- Event dispatcher: `src/shared/events/eventBus.ts` wraps BullMQ — call it from service layer, never from controllers.

### AI / LLM Extended Rules (Phase 2)
- Research and chain-of-thought calls: `max_tokens = 800`.
- Reply draft calls: `max_tokens = 300`.
- Campaign brief calls: `max_tokens = 1200`.
- System prompt for all AI workers must include: current date, lead data, conversation history, campaign context.
- Never send credit card data, bank details, or passwords to OpenAI — ever.
- Log every OpenAI call: `lead_id`, `campaign_id`, `decision_type`, `tokens_used`, `latency_ms`, `cache_hit`, `model_used`.
- Validate all OpenAI JSON responses against Zod schemas — reject and log malformed outputs, never pass them downstream.
- All OpenAI calls must have a fallback: research fails → mark `enrichment_status = 'failed'`, log error, continue. Never block lead processing on AI failure.

### Human-in-the-Loop Rules
- Inbox item expiry by type: `approve_response` → 4h, `urgent_reply` → 1h, `campaign_review` → 24h.
- On expiry in `guarded` mode: execute AI recommendation, log `human_approval_required: false`.
- On expiry in `supervised` mode: escalate urgency, notify manager — do not auto-execute.
- Reps can override any AI action from the lead detail page — overrides logged to `ai_decision_log` with reason.
- AI inbox items are auto-resolved when the corresponding action is taken elsewhere (direct message sent, stage moved manually, etc.)

### Phase 2 Prometheus Metrics (required on all AI workers)
- `crm_ai_research_total{status}` — research jobs completed / failed
- `crm_ai_research_duration_seconds` — histogram of research job duration
- `crm_ai_reply_classified_total{intent_class}` — per intent class counter
- `crm_ai_decisions_total{decision_type,autonomy_level}` — all AI decisions
- `crm_ai_inbox_items_total{item_type,status}` — inbox item creation and resolution
- `crm_ai_openai_tokens_total{decision_type}` — token usage by decision type (cost tracking)

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

| Integration | Purpose | Auth Method | Phase |
|---|---|---|---|
| WhatsApp Business API | Outreach messaging | Bearer token + HMAC webhook verify | Phase 1 |
| Twilio | SMS outreach | Account SID + Auth Token | Phase 1 |
| SendGrid | Email outreach | API Key | Phase 1 |
| OpenAI GPT-4o | Message personalization + AI reasoning | API Key | Phase 1 + 2 |
| Google Ads | Lead form ingestion | OAuth 2.0 | Phase 1 |
| Facebook Business | Lead form ingestion | OAuth 2.0 | Phase 1 |
| Google Business/Places | Scraper source | Places API Key | Phase 1 |
| AWS S3 / MinIO | File storage | IAM Role / Access Key | Phase 1 |
| Sentry | Error monitoring | DSN | Phase 1 |
| Prometheus + Grafana | Metrics + AI operations dashboard | Internal | Phase 1 + 2 |

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
