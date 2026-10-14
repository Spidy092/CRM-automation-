# In-app notification system: research and implementation plan

## Summary

Research date: 2026-10-09. Confirmed scope: in-app notifications only.

Extend the existing notification module rather than replacing it. Keep Redis Pub/Sub and SSE for live delivery, add PostgreSQL persistence for history and read state, and use durable event delivery for notification creation. The existing dependencies are sufficient for this scope; no new npm packages are proposed.

This is a source-code assessment and proposed design, not an implementation or production verification.

## What I Found

| Verified source | Current behavior | Gap |
|---|---|---|
| `backend/src/modules/notifications/notifications.emitter.ts` | Redis channel `crm:notifications` fans out to user-specific local emitters | No persistence; publish errors are logged and swallowed; decoded messages are cast rather than schema-validated |
| `backend/src/modules/notifications/notifications.controller.ts` | Single-use Redis tickets, 30-second ticket TTL, atomic GETDEL, 25-second heartbeat, connection cleanup | No event IDs or replay; authenticated connections have no explicit expiry/revocation lifecycle |
| `backend/src/modules/notifications/notifications.routes.ts` | Ticket creation uses authentication and rate limiting; stream accepts ticket or RS256 Bearer token | No explicit RBAC middleware on these routes; stream has no connection cap or route limiter |
| `backend/src/index.ts` | Mounts notifications at `/api/v1/events`; initializes subscriber; enables HTTP request logging | Query tickets can appear in request logs; redact them before implementation rollout |
| `frontend/src/hooks/useSSE.ts` | Mints ticket via API client, connects to `/events`, retries after five seconds | No history reconciliation; pending ticket requests can finish after effect cleanup and open stale connections |
| `frontend/src/components/ui/NotificationBell.tsx` | Keeps the latest 20 items in component state; opening bell clears unread count | Reload loses history; read/dismiss state is local; duplicate events still increment unread count; clear-all does not clear the count |
| `frontend/src/pages/AccountPage.tsx` | Saves a notification sound preference locally | Search found no notification sound consumer elsewhere in frontend source |
| `nginx/nginx.prod.conf` | Dedicated streaming location is `/api/v1/notifications/stream` | Does not match actual `/api/v1/events` route; generic API proxy is used instead. Existing `X-Accel-Buffering: no` and heartbeats may mitigate this, but proxy behavior needs testing |
| Existing notification producers | Assignment service/worker, report export worker, scraper service, campaign enrollment in events worker | Producers use best-effort publication; events can be lost between business success and notification delivery |
| `migrations/1750000000071_event-outbox.js`, shared outbox code, `backend/src/workers/outbox.worker.ts` | Durable outbox, leasing, sweeper, retries, metrics and DLQ patterns exist | Worker only dispatches an allowed set of lead events to the lead-event queue; cannot directly dispatch arbitrary notification requests |
| `backend/src/workers/index.ts` | Outbox startup depends on workflow automation being enabled | Notification reliability must not silently depend on workflow enablement |

The notification type union contains `lead_assigned`, `campaign_enrolled`, `export_ready`, `job_failed`, `scraper_complete`, and `lead_scored`. A declared type alone does not establish a working producer. The migration search found no dedicated notification history table. Live database migration state was not checked.

Research supports preserving the current transport:

- Redis Pub/Sub uses at-most-once delivery, so disconnected subscribers can miss events. Persisted notification history must be the source of truth. [Redis documentation](https://redis.io/docs/latest/develop/pubsub/)
- SSE supports event IDs and reconnect behavior. The current client manually recreates EventSource to obtain a fresh single-use ticket, so any resume cursor must be explicitly preserved if replay is added. [MDN SSE documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- Retryable workers need idempotent effects. Store a unique notification identity per event and recipient, rather than relying on queue deduplication alone. [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- BullMQ supports exponential retry backoff. Follow project requirements for retries, retention, and dead-letter handling. [BullMQ failure retries](https://docs.bullmq.io/guide/retrying-failing-jobs)

## Assumptions Made (list any — must be zero for production tasks)

None used as established project facts. In-app-only scope was confirmed by the user. The schema, API routes and phases below are proposals, not existing functionality. Retention duration, initial event categories and recipient rules remain product decisions; production topology and applied migrations remain unverified.

## Skill Used (which skill was applied, or why none matched)

Read and used `/home/sr-user91/.agents/skills/find-skills/SKILL.md` for discovery. Project `.agents/skills` and the specified `~/.ai-agents/.agents` workflow directory do not exist in this workspace. Checked the skills.sh leaderboard and searched notification/SSE guidance online. External candidates were found, but none was installed or adopted for implementation; this work is research using actual source and official documentation.

## Fix / Changes

### Proposed architecture

```text
Business transaction
  → durable event record committed with business change
  → dispatcher / notification worker
  → idempotently persist recipient notification in PostgreSQL
  → publish live Redis signal after commit
  → API process → SSE → React Query reconciliation → bell/inbox

Login, reconnect, focus, or live signal
  → authenticated history + unread-count APIs
  → recover current state from PostgreSQL
```

SSE is suitable for one-way server updates; read and dismiss actions can use normal HTTP requests. A WebSocket replacement adds no clear benefit for this scope. Redis remains the live fanout layer, not the history store.

Use database reconciliation on initial load, reconnect, browser focus and a bounded background interval. Subscribe before fetching the initial snapshot and reconcile events arriving during that fetch. Deduplicate by persisted ID. This avoids a gap between loading history and connecting the stream. For the first version, reconciliation is simpler than maintaining a second durable SSE replay log.

Emit SSE `id:` fields for stable notification identity, but do not claim replay unless the server actually implements it. Redis delivery failure after database commit should not remove the notification: subsequent HTTP reconciliation recovers it. Track live publication failures separately.

### Proposed data model

Add an append-only migration for a `notifications` table (proposed name): UUID ID, recipient user ID, event identity/idempotency key, type, title, message, limited structured metadata, creation timestamp, read timestamp and dismissal timestamp. Keep metadata small and allowlist its keys. Store safe entity references instead of raw tokens or unrestricted URLs.

Use a unique constraint on recipient plus event identity. Add indexes supporting `(recipient_user_id, created_at, id)` pagination and unread lookups excluding dismissed rows. Pagination uses a deterministic timestamp/ID cursor. Retention and cleanup policy must be selected before enabling automatic removal.

Existing IDs such as `assign:<leadId>` identify an entity, not an assignment occurrence. Reassignment needs a distinct durable event ID or assignment record ID, otherwise legitimate notifications can be incorrectly deduplicated. Worker retries must reuse the original event identity.

Read and dismissed are separate states. Opening the bell should not automatically mark every item read. Mark-all-read uses a snapshot cutoff so arrivals after the user's click stay unread. Dismissal excludes an item from the active inbox and count without erasing its history immediately.

### Proposed module and API work

Extend `backend/src/modules/notifications/` with a service, repository and Zod schemas. Other modules call its service interface; they do not query notification tables directly. Reuse typed Result/error patterns and standard response envelopes.

Keep existing `/api/v1/events` and `/api/v1/events/ticket` for compatibility. Proposed new endpoints, all authenticated, RBAC-protected, validated and rate-limited:

| Proposed endpoint | Purpose |
|---|---|
| `GET /api/v1/notifications` | Cursor-paginated current user's inbox |
| `GET /api/v1/notifications/unread-count` | Authoritative unread count |
| `PATCH /api/v1/notifications/:id/read` | Idempotently mark an owned item read |
| `POST /api/v1/notifications/read-all` | Mark owned items read through a validated snapshot cutoff |
| `PATCH /api/v1/notifications/:id/dismiss` | Idempotently dismiss an owned item |

Recipient identity comes from authenticated context, never from a client-supplied user ID. A new public send/broadcast endpoint is unnecessary. Generic workflow `notification.send` should remain blocked until its recipient authorization, durable idempotency and policy contract are implemented.

Add frontend API methods through `src/api/client.ts`, TanStack Query hooks for list/count/mutations, and a notification panel with loading, error, empty and disconnected states. Keep only panel visibility/filter state in local UI state. Reconcile all tabs through server state rather than local counters. Handle logout/account changes by clearing cached notification data, cancelling pending tickets, closing streams and cancelling retry timers. Use bounded exponential reconnect delays with jitter and fresh tickets.

### Proposed delivery integration

Review reuse of the shared outbox before changing it: its dispatcher currently permits lead events only. Add typed dispatch and scheduling support for notification events, or introduce a dedicated notification outbox/dispatcher using the same patterns. Do not insert a new event type into the existing outbox without a consumer that supports it.

Critical business notifications need event persistence within the originating business transaction. The shared outbox service accepts a transaction executor, which offers a path without cross-module direct SQL. Simply replacing `pushToUser` with a database insert after the business operation leaves a crash window and is not sufficient for reliable creation.

Export completion, scraper runs and other background results need their own stable occurrence identities and recoverable completion records. Review transaction boundaries separately for each producer. A dedicated worker must await persistence and surface failures for retries; logging and swallowing an error prevents retry recovery.

If a dedicated BullMQ worker is added, use typed payloads, bounded job retention, exponential retries, DLQ routing, Winston context, Sentry and the existing Prometheus job metrics. Schedule downstream work through service interfaces.

### Implementation order

1. Define recipient/event rules; draft the additive migration and authenticated service/API contract.
2. Add persistent history, read/dismiss state and targeted repository/service/API tests. Present migration for approval before running it.
3. Integrate durable creation for existing assignment, export, scraper and campaign enrollment producers. Resolve outbox dispatch and feature-flag independence.
4. Connect the bell to TanStack Query; add safe SSE lifecycle and reconciliation; align Nginx with the existing stream URL and redact tickets from logs.
5. Verify outage recovery and rollout. Add reply alerts, follow-up reminders, approval-needed alerts or administrative failure alerts only after recipient policies are confirmed.

## Files Changed

Only this research document. No application code, migrations, credentials or deployment files were changed. The existing untracked `test.js` was left untouched.

## Commands to Run

Targeted existing notification checks:

```bash
cd backend
./node_modules/.bin/jest --runInBand --coverage=false src/modules/notifications
```

During implementation, run lint, build and the relevant tests in both backend and frontend using their verified package scripts. Backend `npm run test` runs Jest with coverage; frontend tests use Vitest. Migration execution requires user approval and verification of applied database state first.

## Verification Steps

The initial targeted run passed the controller suite, then could not complete route tests because Supertest's HTTP listener was denied by the sandbox (`listen EPERM`). Controller and emitter suites were subsequently run separately: both passed, with 10 tests passing. This is not verification of real Redis, Nginx, browser behavior or deployment.

Implementation acceptance checks:

- History and unread state survive refresh, logout/login and API restarts.
- Offline events appear after reconnection; Redis outage does not lose committed notifications.
- Retry and duplicate event delivery create one item per occurrence/recipient; separate reassignments create separate items.
- Cross-user list/read/dismiss attempts are rejected; deep-linked resources still enforce their own authorization.
- Logout during ticket minting cannot open a stale stream; expired/replayed tickets fail; stream revocation is enforced.
- Mark-all-read does not consume notifications created after its cutoff.
- Read/dismiss state converges across tabs; unread count never drifts because of duplicate signals.
- Nginx streams promptly on the actual URL; access logs contain no SSE ticket values.
- Database integration tests use PostgreSQL; Redis/worker integration tests cover success, failure, retry and DLQ behavior.
- Required coverage is met; notification UI supports keyboard navigation, focus handling and meaningful status announcements.

## Risks / Edge Cases

Address persistence before live publish, producer transaction crash windows, repeated occurrence identity, reconnect races, stale sessions, slow-client backpressure, bounded per-user connections, retention growth and notification noise. Avoid sending every scoring update to every user. Deleted or reassigned resources may make old links inaccessible; show a controlled state and re-check resource permission.

The proxy route mismatch is a verified configuration inconsistency, not proof that production streaming currently fails. Live database state and deployment behavior require environment-specific checks.

## Security Considerations

Authentication and authorization integration is security-sensitive. Preserve single-use short-lived tickets and RS256 verification. Redact query tickets from application and proxy logs; apply no-store to ticket responses. Validate stream tickets, notification payloads and API inputs with Zod. Define connection expiry/revocation rather than allowing an authenticated stream to remain authorized indefinitely.

Scope every query and mutation to the authenticated recipient. Render notification messages as text, restrict metadata and deep links, and avoid unnecessary PII in logs or Redis payloads. Approval notifications must link to existing gated approval APIs; receipt or click must never execute an approval automatically.
