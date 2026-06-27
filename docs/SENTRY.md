# Sentry Wiring — Runbook & Reference

This document describes how the CRM backend integrates with Sentry for error monitoring
and event capture. It is the operator-facing reference for configuring, verifying, and
inventorying Sentry call sites.

---

## 1. Environment Variables

The Sentry integration is initialized by `initSentry()` in `backend/src/shared/utils/sentry.ts`.
Read at process startup from `process.env` (via `dotenv` at boot).

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENTRY_DSN` | **Yes** (for capture) | — | DSN URL of your Sentry project. If unset or empty, `initSentry()` skips `Sentry.init` and logs a one-time warning. The app continues to run normally. |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Float in `[0, 1]` for performance transaction sampling rate. Lower = fewer events, lower cost. Passed directly to `@sentry/node` `Sentry.init({ tracesSampleRate })`. |
| `SENTRY_RELEASE` | No | `undefined` | Release identifier (typically a git SHA or version). When set, appears in every Sentry event as `release`. Useful for tying events to a specific deploy. |
| `SENTRY_ENVIRONMENT` | No | `NODE_ENV` | Environment name shown in Sentry (e.g. `production`, `staging`). Defaults to whatever `NODE_ENV` is set to. |
| `NODE_ENV` | No | — | When `NODE_ENV === 'test'`, `initSentry()` passes `enabled: false` to `Sentry.init`, preventing any network egress during Jest runs. This is enforced by `backend/src/shared/utils/sentry.test.ts`. |

### `.env.example` snippet

```bash
# Sentry error monitoring (optional — leave blank to disable)
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_RELEASE=
SENTRY_ENVIRONMENT=
```

### Default behavior matrix

| `SENTRY_DSN` | `NODE_ENV` | Result |
|---|---|---|
| unset / empty | any | `Sentry.init` NOT called. Warning logged. All `captureException` calls become no-ops at the SDK level (the SDK has no client). |
| set | `test` | `Sentry.init` called with `enabled: false` and the configured DSN/sample rate. Events are not sent. |
| set | `production` | `Sentry.init` called with `enabled: true` and the configured DSN/sample rate. Events are sent to Sentry. |
| set | `development` | `Sentry.init` called with `enabled: true`. Events sent (be mindful of cost). |

---

## 2. Operator Verification Runbook

Use this runbook after a fresh deploy or whenever you suspect Sentry is not capturing
events. Each step is timeboxed and idempotent.

### Step A — Confirm the SDK was initialized

After boot, the application logs either a warning (DSN missing) or a confirmation line
(via the underlying `@sentry/node` SDK). Check container logs:

```bash
docker compose logs api 2>&1 | grep -iE 'sentry|dsn|initSentry'
```

- If you see `Sentry DSN not configured; skipping initialization` → DSN missing.
- If you see no warning and no SDK error → SDK initialized successfully.

### Step B — Trigger a deterministic test exception

The fastest path is to hit any endpoint that throws a 500. Add a temporary route, or
use the `/health` payload route in non-prod — easier: use the worker DLQ trigger.

For a one-shot manual trigger, attach to the running `worker` container and enqueue a
malformed job via BullMQ. The worker will fail, the `failed` handler will call
`Sentry.captureException`, and the event will be sent.

For a simpler approach, hit an endpoint that intentionally raises a 500. If you don't
have one, add this temporary snippet to `backend/src/index.ts` (remove after verifying):

```ts
app.get('/__sentry_probe', (_req, _res) => {
  throw new Error('Sentry probe — ' + new Date().toISOString());
});
```

Then:

```bash
curl -s http://localhost:3000/__sentry_probe
```

You should see `Internal Server Error` and (within ~5 s) the event in Sentry.

### Step C — Verify the event landed in Sentry

1. Open `https://<your-org>.sentry.io/issues/?query=is%3Aunresolved`
2. Filter by environment matching your `SENTRY_ENVIRONMENT` (or `NODE_ENV`).
3. Look for the error message from Step B. The event should appear within 5–10 seconds.
4. Click into the event and confirm:
   - `environment` is correct
   - `release` is populated if you set `SENTRY_RELEASE`
   - `extra.jobId` / `extra.leadId` / `extra.campaignId` are populated for worker failures
   - `exception.values[0].type` and `value` match what you threw

If the event is missing:

| Symptom | Likely cause |
|---|---|
| No warning, no event | `SENTRY_DSN` not actually loaded — verify with `docker compose exec api printenv SENTRY_DSN` |
| Warning at boot | DSN was empty — check for whitespace, line-ending issues in `.env` |
| SDK errors in log | Wrong DSN format — must start with `https://<key>@o<org>.ingest.sentry.io/<project>` |
| Event sent but invisible | Wrong environment filter; or `enabled: false` from `NODE_ENV=test` leaking into prod |

### Step D — Remove the probe

If you added `/__sentry_probe` in Step B, **remove it before merging**. Leaving it open
will flood Sentry every time someone curls the URL.

---

## 3. Inventory: every `captureException` call site

This section is the canonical list of where the codebase calls `Sentry.captureException`.
Drawn from `grep -rn 'captureException' backend/src`. The first three are the most
critical to monitor.

### Middleware

| File | Line | Trigger | `extra` payload |
|---|---|---|---|
| `backend/src/shared/middleware/errorHandler.ts` | 30 | Any HTTP 5xx thrown from a controller/service | none |
| `backend/src/shared/middleware/errorHandler.ts` | 49 | Express `next(err)` fallback for non-Error throws | none |

### Process-level handlers

| File | Line | Trigger | `extra` payload |
|---|---|---|---|
| `backend/src/index.ts` | 49 | `unhandledRejection` event | none |
| `backend/src/index.ts` | 54 | `uncaughtException` event | none |

### BullMQ workers (all in `backend/src/workers/`)

Each worker registers a `failed` event handler that fires on every job failure (after
BullMQ exhausts its retries; or immediately if `attempts: 1`).

| Worker | Line | `extra` payload |
|---|---|---|
| `aiInbox.worker.ts` | 82 | `{ jobId: id }` |
| `aiReply.worker.ts` | 60 | `{ jobId: id, leadId }` |
| `aiResearch.worker.ts` | 83 | `{ jobId: id, leadId }` |
| `aiCampaignBrain.worker.ts` | 60 | `{ jobId: id, campaignId }` |
| `assignment.worker.ts` | 65 | `{ jobId: id, jobName: job?.name }` |
| `outreach.worker.ts` | 103 | `{ jobId: job?.id, jobName: job?.name }` |
| `scoring.worker.ts` | 75 | `{ jobId: id, jobName: job?.name }` |
| `scraper.worker.ts` | 62 | `{ jobId: job?.id, jobName: job?.name }` |
| `reportExport.worker.ts` | 69 | `{ jobId: job?.id, jobName: job?.name }` |
| `events.worker.ts` | 70 | `{ jobId: job?.id, event: ... }` (the inbound lead event name) |

All worker failure events are paired with a dead-letter queue (DLQ) handoff once
`attemptsMade >= attempts`. See `backend/src/lib/dlq.ts`.

### Summary

- **2 middleware call sites**
- **2 process-level call sites** (unhandled rejections / uncaught exceptions)
- **10 worker call sites** (1 each from the 10 workers)
- **Total: 14 capture points**

---

## 4. Test coverage

The Sentry integration is verified end-to-end by:

- `backend/src/shared/utils/sentry.test.ts` — 11 tests proving `initSentry()` reads
  `SENTRY_DSN`, applies `SENTRY_TRACES_SAMPLE_RATE` (default `0.1`), and disables
  when `NODE_ENV=test`.
- `backend/src/workers/sentry.smoke.test.ts` — 5 tests proving that
  `Sentry.captureException()` (re-exported via `shared/utils/sentry`) reaches the
  underlying `@sentry/node` transport with the expected `extra` payload shape.

Run with: `cd backend && npm test -- sentry --coverage=false`
