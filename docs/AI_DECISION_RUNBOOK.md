# AI Decision Runbook — `next_best_action`

Operator guide for the AI next-best-action decision pipeline.

## 1. Overview

`next_best_action` is the AI's recommended next step for a lead. It is stored on the `lead_ai_profiles` table (`next_best_action`, `next_best_action_reason`, `next_best_action_confidence`) and consumed when the lead enters an active campaign pipeline.

| Concern | Component |
|---------|-----------|
| Compute | `backend/src/modules/ai-intelligence/ai-intelligence.service.ts` — `computeNextBestAction` |
| Persist | `backend/src/modules/ai-intelligence/ai-intelligence.repository.ts` — `updateNextBestAction` |
| Read | `backend/src/modules/outreach/outreach.repository.ts` — `findNextBestActionByLeadId` |
| Consume / route | `backend/src/workers/events.worker.ts` — `routeByNextBestAction`, `handleStageMoved`, `handleLeadEvent` |
| Background job | `backend/src/workers/aiDecision.worker.ts` — `ai:next-action` on queue `ai-decisions` |
| Override | `backend/src/modules/campaigns/campaigns.service.ts` — `launchCampaignById` autonomy override |
| Cache | `backend/src/shared/utils/redis.ts` + `ai-intelligence.service.ts` profile cache |
| Domain events | `backend/src/shared/events/ai.events.ts` — `AIDomainEvent` |

The next-best-action is recomputed when:

- `lead.created` or `lead.scored` triggers the `ai-decisions` worker.
- An inbound reply is classified (`ai-reply` worker updates `next_best_action` via `ai-reply.repository.ts` and invalidates the profile cache).
- A manual recompute is requested with `force=true`.

## 2. Computation

`computeNextBestAction(leadId, opts)` in `backend/src/modules/ai-intelligence/ai-intelligence.service.ts` performs the following steps:

1. Returns the existing action from the cached AI profile if `next_best_action` is already set and `opts.force` is not `true`.
2. Loads the lead from `leads` via `findLeadById`.
3. Loads AI configuration via `getAiConfig`.
4. Fetches the last 10 `ai_decision_log` entries for the lead via `listDecisionLogsByLead`.
5. Calls OpenAI with `response_format: { type: 'json_object' }`, validating the output against `NextBestActionSchema`.
6. Persists the result with `updateNextBestAction` in `lead_ai_profiles`.
7. Invalidates the Redis profile cache via `invalidateProfileCache(leadId)`.
8. Logs the decision via `logger.info('ai next action: computed next best action', ...)`.

### Allowed action values

The Zod schema (`NextBestActionSchema` and `AiResearchSchema`) permits these values:

| Action | Meaning |
|--------|---------|
| `send_whatsapp` | Send a WhatsApp outreach message. |
| `send_email` | Send an email outreach message. |
| `send_sms` | Send an SMS outreach message. |
| `wait_and_followup` | Do not reach out now; schedule a follow-up. |
| `call` | A phone call is the recommended next step. |
| `move_to_nurture` | Move the lead to a nurture stage/cadence. |
| `escalate_to_rep` | Hand off to a human sales rep. |
| `request_human_approval` | Hold until a human approves the action. |
| `disqualify` | Disqualify the lead. |
| `request_review` | Request a manual review of the lead. |

The TypeScript type is declared in `backend/src/modules/ai-intelligence/ai-intelligence.types.ts` as `NextBestAction`.

### Decision inputs

The OpenAI prompt (built by `buildNextActionSystemPrompt` and `buildNextActionUserPrompt`) receives:

- Lead fields: `business_name`, `status`, `pipeline_stage_id`, `lead_score`, `industry`, `location`, `country`, `source_platform`.
- Existing AI profile: `buying_intent`, `reachability_score`, `preferred_channel`, current `next_best_action`, and `next_best_action_reason`.
- Recent `ai_decision_log` entries (decision type, decision, confidence, timestamp).
- Optional extra context (`opts.context`).

The prompt instructs the model to prefer low-friction outreach for reachable, interested leads and to escalate or request approval when risk or uncertainty is high.

## 3. Data Flow

### Stage moved → outreach routing

```text
lead.stage_moved event
       │
       ▼
handleLeadEvent(data) ──events.worker.ts
       │
       ▼
handleStageMoved(leadId, payload)
       │
       ▼
findActiveCampaignsByPipeline(pipelineId)
       │
       ▼
findNextBestActionByLeadId(leadId)
       │
       ▼
routeByNextBestAction({ leadId, campaign, firstStep, nextBestAction })
       │
       ├── skip / log only ──► disqualify, wait_and_followup,
       │                       request_human_approval, call,
       │                       escalate_to_rep, move_to_nurture,
       │                       request_review
       │
       ├── switch channel ──► send_whatsapp / send_email / send_sms
       │   (calls enqueueOutreachDispatch with switched channel)
       │
       └── no action matched ──► fallback: enqueueOutreachDispatch with
                                 firstStep.channel
```

Key queues involved:

- `lead-events` — consumed by `events.worker.ts`.
- `outreach` — `enqueueOutreachDispatch` adds `outreach:dispatch-step` jobs.
- `ai-decisions` — recomputes `next_best_action` via `aiDecision.worker.ts`.

## 4. Override Rules

### Campaign launch override

`launchCampaignById` in `backend/src/modules/campaigns/campaigns.service.ts` normally requires an approved AI campaign brief (`ai_campaign_briefs.status = 'approved'`). This requirement is bypassed when:

```ts
existing.autonomy_level === 'supervised' && existing.ai_min_confidence === 0
```

- Table: `campaigns`
- Columns: `autonomy_level` (`'supervised' | 'guarded' | 'autopilot'`) and `ai_min_confidence` (integer).

Setting `autonomy_level = 'supervised'` and `ai_min_confidence = 0` makes the campaign launch manually without AI-brief approval.

### Other manual overrides

- Direct DB update on `lead_ai_profiles.next_best_action` changes the persisted action but does **not** invalidate the Redis cache. Call `invalidateProfileCache(leadId)` or delete the `ai:profile:<leadId>` key after manual edits.
- A manual recompute can be forced by calling `computeNextBestAction(leadId, { force: true })` or by adding an `ai:next-action` job to the `ai-decisions` queue with `force: true`.

## 5. Redis Cache Invalidation

`next_best_action` is **not cached separately**. It is part of the lead AI profile cache managed in `backend/src/modules/ai-intelligence/ai-intelligence.service.ts`.

| Item | Value |
|------|-------|
| Cache key pattern | `ai:profile:<leadId>` |
| TTL | `PROFILE_CACHE_TTL = 60 * 60` seconds (1 hour) |
| Stored value | Full `LeadAiProfileRow` JSON, including `next_best_action`, `next_best_action_reason`, `next_best_action_confidence` |
| DB authority | DB is authoritative; cache is a read-through cache |

Invalidation happens via `invalidateProfileCache(leadId)`, which calls `redis.del('ai:profile:<leadId>')`. Current callers:

- `computeNextBestAction` after persisting a new action.
- `researchLead` after upserting the AI profile.
- `ai-reply.service.ts` `classifyReply` after updating the profile next action.

There is no dedicated cache for `next_best_action` itself; `findNextBestActionByLeadId` reads directly from `lead_ai_profiles`.

## 6. Operations

### Inspect a lead's current `next_best_action`

**Database:**

```sql
SELECT lead_id,
       next_best_action,
       next_best_action_reason,
       next_best_action_confidence,
       enrichment_status,
       updated_at
FROM   lead_ai_profiles
WHERE  lead_id = '<lead-id>';
```

**Redis profile cache:**

```bash
redis-cli GET ai:profile:<lead-id>
```

Parsed example:

```bash
redis-cli GET ai:profile:<lead-id> | jq '.next_best_action, .next_best_action_reason, .next_best_action_confidence'
```

**API:**

```bash
curl -H "Authorization: Bearer <token>" \
     "http://<host>/api/ai-intelligence/leads/<lead-id>/profile"
```

### Recompute manually

**Force recompute in code:**

```ts
import { computeNextBestAction } from './backend/src/modules/ai-intelligence/ai-intelligence.service';

await computeNextBestAction('<lead-id>', { force: true });
```

**Enqueue via BullMQ queue `ai-decisions`:**

```ts
import { aiDecisionQueue, AI_DECISION_LEAD } from './backend/src/workers/queue';

await aiDecisionQueue.add(AI_DECISION_LEAD, {
  leadId: '<lead-id>',
  force: true,
  context: { reason: 'manual-operator-recompute' },
});
```

### Clear the action

**Clear only the action in DB:**

```sql
UPDATE lead_ai_profiles
SET    next_best_action = NULL,
       next_best_action_reason = NULL,
       next_best_action_confidence = NULL,
       updated_at = NOW()
WHERE  lead_id = '<lead-id>';
```

**Invalidate the cache:**

```bash
redis-cli DEL ai:profile:<lead-id>
```

### Useful log queries

Recent decisions for a lead:

```sql
SELECT id, decision_type, decision, confidence, latency_ms, model_used, created_at
FROM   ai_decision_log
WHERE  lead_id = '<lead-id>'
ORDER  BY created_at DESC
LIMIT  20;
```

Recent `next_action` decisions across all leads:

```sql
SELECT lead_id, decision, confidence, tokens_used, latency_ms, model_used, created_at
FROM   ai_decision_log
WHERE  decision_type = 'next_action'
ORDER  BY created_at DESC
LIMIT  100;
```

Campaign launches that used the autonomy override:

```sql
SELECT id, name, autonomy_level, ai_min_confidence, status, launched_at
FROM   campaigns
WHERE  autonomy_level = 'supervised'
  AND  ai_min_confidence = 0;
```

Check `lead-events` queue state (requires BullMQ UI or `bullmq` script):

```bash
redis-cli LRANGE bull:lead-events:wait 0 -1
```

## 7. Troubleshooting

### Stale `next_best_action`

**Symptom:** The lead's action does not reflect recent replies or stage changes.

**Check:**

1. Confirm the DB value is stale:
   ```sql
   SELECT updated_at, next_best_action FROM lead_ai_profiles WHERE lead_id = '<lead-id>';
   ```
2. If Redis cache is newer but DB is stale, `getAiProfile` may be returning the cached value. Delete the cache:
   ```bash
   redis-cli DEL ai:profile:<lead-id>
   ```
3. Force a recompute via the `ai-decisions` queue with `force: true`.
4. Check `ai_decision_log` for recent `next_action` or `reply_classify` entries.

### Missing `lead_ai_profiles` row

**Symptom:** `findNextBestActionByLeadId` returns `null`; `computeNextBestAction` throws `Lead AI profile not found for lead <id>` from `updateNextBestAction`.

**Fix:**

- Ensure the lead was researched first. `lead.created` enqueues `ai:research-lead`, which upserts the profile.
- If research failed, check the `ai-research` queue / DLQ (`dead-letter` queue).
- Manually seed a profile with `enrichment_status` set, or enqueue `ai:research-lead` for the lead.

### Event bus not publishing

**Symptom:** Stage moves or replies do not trigger recomputation or outreach routing.

**Check:**

- Verify workers are running (`npm run worker` or Docker container).
- Verify Redis is reachable and the `lead-events` queue has jobs:
  ```bash
  redis-cli LLEN bull:lead-events:wait
  ```
- Check worker logs for `lead event job started` / `lead event job failed`.
- Confirm the event producer calls `enqueueLeadEvent({ event: 'lead.stage_moved', leadId, payload })` from `backend/src/workers/queue.ts`.

### Outreach not skipping when expected

**Symptom:** A lead receives outreach even though `next_best_action` is `disqualify`, `wait_and_followup`, etc.

**Check:**

1. Verify the action value is one of the skip actions in `routeByNextBestAction`:
   - Hard skip: `disqualify`, `wait_and_followup`, `request_human_approval`
   - Log-and-skip: `call`, `escalate_to_rep`, `move_to_nurture`, `request_review`
2. Confirm `findNextBestActionByLeadId` returned the expected value at the time `handleStageMoved` ran.
3. Check that the lead entered the campaign **after** the action was computed. The routing decision is made only during `lead.stage_moved` handling.
4. Review logs for messages like `lead.stage_moved: skipping outreach per next_best_action` or `lead.stage_moved: outreach skipped per next_best_action`.
5. If `routeByNextBestAction` returns `false`, the fallback path dispatches the first sequence step with `firstStep.channel`. Check whether the action string is an exact match (case-sensitive) with the allowed values.
