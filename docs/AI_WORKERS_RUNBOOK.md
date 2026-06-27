# AI Workers Runbook

Operator guide for the CRM AI worker tier.

## 1. Overview

The AI worker tier runs asynchronous, AI-powered background jobs for the CRM. It is started from `backend/src/workers/index.ts`, which boots every processor including the AI workers and the shared lead-events worker.

AI workers in this tier:

| Worker | Queue | Purpose |
|--------|-------|---------|
| `aiResearch.worker.ts` | `ai-research` | Enrich a lead via AI research and persist a `lead_ai_profiles` row. |
| `aiReply.worker.ts` | `ai-reply` | Classify an inbound lead reply by intent and confidence. |
| `aiDecision.worker.ts` | `ai-decisions` | Compute the next-best-action for a lead. |
| `aiCampaignBrain.worker.ts` | `ai-campaign` | Generate an AI campaign brief for a campaign. |
| `aiInbox.worker.ts` | `ai-inbox` | Create AI inbox items and run an expiry sweep cron. |
| `events.worker.ts` | `lead-events` | Route lead lifecycle events to downstream queues and workers. |

All queues use BullMQ on Redis. The connection is obtained from `backend/src/workers/queue.ts` via `getBullConnection()`, which configures `maxRetriesPerRequest: null` as required by BullMQ workers.

## 2. Worker Inventory

| Queue | Processor file | Job name(s) | Purpose | Max retries / Backoff | DLQ behavior |
|-------|----------------|-------------|---------|-----------------------|--------------|
| `ai-research` | `backend/src/workers/aiResearch.worker.ts` | `ai:research-lead` | Run AI lead intelligence and upsert `lead_ai_profiles`. | 3 attempts, exponential backoff, initial delay 3_000 ms | On final failure, `moveToDLQ('ai-research', ...)` enqueues a snapshot to `dead-letter`. |
| `ai-reply` | `backend/src/workers/aiReply.worker.ts` | `ai:classify-reply` | Classify inbound replies (`whatsapp`, `email`, `sms`). | 3 attempts, exponential backoff, initial delay 2_000 ms | On final failure, `moveToDLQ('ai-reply', ...)` moves the job to `dead-letter`. |
| `ai-decisions` | `backend/src/workers/aiDecision.worker.ts` | `ai:next-action` | Compute and persist the next-best-action for a lead. | 3 attempts, exponential backoff, initial delay 3_000 ms | On final failure, `moveToDLQ('ai-decisions', ...)` moves the job to `dead-letter`. |
| `ai-campaign` | `backend/src/workers/aiCampaignBrain.worker.ts` | `ai:generate-campaign-brief` | Generate a campaign brief and confidence score. | 2 attempts, exponential backoff, initial delay 5_000 ms | On final failure, `moveToDLQ('ai-campaign', ...)` moves the job to `dead-letter`. |
| `ai-inbox` | `backend/src/workers/aiInbox.worker.ts` | `ai:create-inbox-item`, `ai:expiry-sweep` | Create AI inbox items; repeatable cron sweep expires stale items. | 3 attempts, exponential backoff, initial delay 1_000 ms | On final failure, `moveToDLQ('ai-inbox', ...)` moves the job to `dead-letter`. |
| `lead-events` | `backend/src/workers/events.worker.ts` | `lead:event` | Route lead lifecycle events (`lead.created`, `lead.scored`, `lead.stage_moved`, `lead.assigned`, `lead.status_changed`, `lead.reply.received`) to scoring, AI research, outreach, and campaign enrollment. | 3 attempts, exponential backoff, initial delay 1_000 ms | On final failure, `moveToDLQ('lead-events', ...)` moves the job to `dead-letter`. |

Queue options and retry settings are defined in `backend/src/workers/queue.ts`.

## 3. Start / Stop

### Start with Docker Compose

The worker container is defined in `docker-compose.yml`:

```yaml
worker:
  build:
    context: ./backend
    dockerfile: Dockerfile.dev
  container_name: crm_worker
  command: npm run worker
```

Start the worker service (and dependencies):

```bash
docker compose up --build worker
```

To start the full stack including the API, Postgres, Redis, MinIO, and Bull-Board:

```bash
docker compose up --build
```

### Start locally (development)

From the `backend/` directory with `REDIS_URL` and `DATABASE_URL` set:

```bash
cd backend
npm run worker
```

This executes `ts-node-dev --respawn --transpile-only src/workers/index.ts`.

### Start the compiled worker (production image)

The production `backend/Dockerfile` builds to `dist/` and defaults to the API. Override the command to run workers:

```bash
docker run --rm <crm-backend-image> node dist/workers/index.js
```

### Graceful shutdown

`backend/src/workers/index.ts` registers handlers for `SIGTERM` and `SIGINT`:

```typescript
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
```

`handleShutdown(signal)` logs the signal, closes the Redis connection with `redis.quit()`, and exits the process. Use `docker compose stop worker` or `kill -TERM <pid>` to trigger a graceful shutdown.

## 4. Event Bus

### AI domain events (`backend/src/shared/events/eventBus.ts`)

`publishAIDomainEvent(event: AIDomainEvent)` enqueues events onto the BullMQ `ai-events` queue. It builds an idempotency key via `aiEventIdempotencyKey(event)` from `backend/src/shared/events/ai.events.ts` and uses it as the job id, so duplicate publishes are deduplicated.

Example event types defined in `backend/src/shared/events/ai.events.ts`:

- `lead.scraped`
- `lead.imported`
- `lead.reply.received`
- `lead.stage.changed`
- `outreach.bounced`
- `outreach.opened`
- `outreach.clicked`
- `campaign.pre_launch`
- `lead.score.updated`

`subscribeToAIDomainEvents(handlers)` registers typed handlers in an in-memory registry. Worker factories can later call `getHandlersForEvent(type)` to wire up BullMQ Workers without the bus owning the worker lifecycle.

### Lead lifecycle events (`backend/src/workers/events.worker.ts`)

The events worker consumes the `lead-events` queue, job name `lead:event`, and routes based on `event`:

| Event | Routing behavior |
|-------|------------------|
| `lead.created` | Enqueues `scoring:calculate-lead` on the `scoring` queue and `ai:research-lead` on the `ai-research` queue. |
| `lead.scored` | Logs the score/classification; no downstream enqueue in this worker. |
| `lead.stage_moved` | Loads active campaigns for the pipeline, auto-enrolls the lead, optionally routes by next-best-action, and dispatches the first outreach step. |
| `lead.assigned` | Logs the assignment; reserved for future push notification. |
| `lead.status_changed` | Cancels pending outreach jobs when status is `paused`, `won`, `lost`, or `opted_out`. |
| `lead.reply.received` | Present in `LeadEventType` but not explicitly routed by `handleLeadEvent`; it logs a warning as an unknown event unless handlers are added. |

Payload types are defined in `backend/src/workers/queue.ts` as `LeadEventJob`.

## 5. DLQ / Dead-Letter Handling

Failed jobs that exhaust their retry attempts are moved to the `dead-letter` queue by `moveToDLQ()` in `backend/src/lib/dlq.ts`.

Each AI worker registers a BullMQ `failed` event handler that calls `moveToDLQ(originalQueue, { id, name, data, failedReason, attemptsMade })` when `job.attemptsMade >= (job.opts?.attempts ?? defaultAttempts)`.

The DLQ payload shape (`DLQPayload`) is:

```typescript
export interface DLQPayload {
  originalQueue: string;
  originalJobId: string | undefined;
  originalJobName: string;
  originalData: unknown;
  failedReason: string | undefined;
  attemptsMade: number;
  movedAt: string;
}
```

The `dead-letter` queue is configured with 30-day retention for both completed and failed jobs.

### Inspect DLQ jobs

Use Bull-Board at `http://localhost:3001` (service defined in `docker-compose.yml`), or query Redis directly:

```bash
redis-cli LRANGE bull:dead-letter:wait 0 -1
```

### Replay a DLQ job

1. Inspect the DLQ job to read `originalQueue` and `originalData`.
2. Re-add the job to the original queue using the appropriate enqueue helper in `backend/src/workers/queue.ts` (for example, `enqueueAiResearch`, `enqueueAiClassifyReply`, `enqueueAiCreateInboxItem`, `enqueueAiCampaignBrief`).
3. Remove the DLQ job once replayed.

Example replay for an AI research job:

```typescript
import { enqueueAiResearch } from './backend/src/workers/queue';
await enqueueAiResearch({ leadId: '<lead-id>', force: true });
```

## 6. Metrics & Observability

### Prometheus metrics (`backend/src/shared/utils/metrics.ts`)

Core BullMQ counters/histograms used by every AI worker:

- `crm_jobs_processed_total` — Counter with labels `name`, `queue`, `status` (`success` or `fail`). Incremented via `incJobsProcessed()`.
- `crm_jobs_failed_total` — Counter with labels `name`, `queue`. Incremented via `incJobsFailed()`.
- `crm_job_duration_seconds` — Histogram with labels `name`, `queue`. Observed via `observeJobDuration()`.

AI-specific metrics:

- `crm_ai_research_total` (`status`)
- `crm_ai_research_duration_seconds`
- `crm_ai_openai_tokens_total` (`decision_type`)
- `crm_ai_reply_classified_total` (`intent_class`)
- `crm_ai_decisions_total` (`decision_type`, `autonomy_level`)
- `crm_ai_inbox_items_total` (`item_type`, `event`)

HTTP metrics are emitted by `backend/src/shared/middleware/httpMetrics.ts`:

- `http_requests_total` (`method`, `route`, `status_code`)
- `http_request_duration_seconds` (`method`, `route`)

### Sentry

Every worker captures exceptions with Sentry in its `failed` handler:

```typescript
Sentry.captureException(err, { extra: { jobId: id, leadId } });
```

Configure Sentry via the `SENTRY_DSN` environment variable.

### Bull-Board

Bull-Board is available via the `bull-board` service in `docker-compose.yml` on port `3001`. It provides a web UI to inspect queues, jobs, failures, and the DLQ.

### Logs

All workers use the shared `logger` from `backend/src/shared/utils/logger`. Look for structured log lines keyed by `queue`, `jobId`, `leadId`, `campaignId`, and `error`.

## 7. Common Failures & Remediation

### OpenAI rate limits / API errors

- **Symptom:** `ai-research`, `ai-reply`, `ai-decision`, or `ai-campaign` jobs fail with HTTP 429 or transient OpenAI errors.
- **Remediation:** Jobs retry with exponential backoff. If failures persist, check `OPENAI_API_KEY` and rate-limit quotas. Temporarily scale worker concurrency down in the processor file if needed. Replay exhausted jobs from the DLQ after the rate limit clears.

### Redis down or unreachable

- **Symptom:** Worker process exits on startup with `Worker process failed to connect to Redis`. BullMQ `failed` events fire repeatedly.
- **Remediation:** Verify the `redis` service is healthy (`docker compose ps redis`). Ensure `REDIS_URL` is correct. The API can run without workers by setting `WORKERS_DISABLED=true`, but queued jobs will not process until Redis is restored.

### Database connection loss

- **Symptom:** Jobs fail with connection errors mid-processing; Sentry receives `pg` or `Prisma` exceptions.
- **Remediation:** Check Postgres health and `DATABASE_URL`. Restart the worker container. Failed jobs retry automatically; exhausted jobs land in the DLQ and can be replayed once the DB is stable.

### Malformed payload

- **Symptom:** Worker logs `error` containing missing required fields, or `unknown lead event` for unhandled `LeadEventType` values.
- **Remediation:** Inspect the failed job data in Bull-Board or Redis. Fix the producer so it emits the correct payload shape (`AiResearchLeadJob`, `AiClassifyReplyJob`, `AiCreateInboxItemJob`, etc., defined in `backend/src/workers/queue.ts`). Delete or replay the job with corrected data.

### Missing lead profile

- **Symptom:** `ai:next-action` or `ai:research-lead` fails because the lead does not exist or has no profile.
- **Remediation:** Confirm the `leadId` in the job payload. Run `enqueueAiResearch({ leadId, force: true })` to force re-research, or replay the DLQ job after the lead record is created/imported.
