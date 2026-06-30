# AI Copilot Agent — Design Spec

**Date:** 2026-06-30
**Status:** Draft (awaiting user review)
**Author:** Kimchi (brainstorming session)
**Branch:** `feature/ai-copilot-agent`

---

## 1. Context

The CRM AI Copilot is currently a **chatbot**, not an agent. The foundation is solid — `backend/src/modules/agent/` exposes 17 typed actions with a working policy engine (risk tiers `read` → `compliance_critical`), an idempotent propose→execute→reject pipeline, and a `decision_log` audit trail. The `chat/` module calls `proposeAgentAction` from inside an OpenAI tool-call loop, and `ai-inbox/` is the human-approval surface.

The gap is **planning depth**. Each chat turn produces at most one tool call, never a chain. A request like *"find Mumbai dentists, qualify the top 5, enroll in the nurture campaign"* triggers a confused single tool call or, worse, gets caught by one of seven keyword short-circuit handlers (`handleScraperCommand`, `handleLeadCommand`, etc.) that pattern-match lowercase words and bypass the LLM entirely. The agent module's policy tiers are reachable in principle but `chat.service.ts` always passes `forceApproval: true` for non-read actions, so the rich policy logic is dead code from chat.

This spec turns the copilot into a true **multi-step agent** by introducing a first-class `Plan` entity, a planner that emits typed plans via OpenAI structured output, and a runner that walks the plan's dependency DAG and delegates every step to the existing `agent/` module — reusing the policy engine, executor, audit, and inbox surface unchanged.

**Scope:** v1 ships the structural core (multi-step + Plan entity + safety budgets + "show plan first" UX) in one ~2-week release, with streaming and grouped-inbox deferred to v1.1.

---

## 2. Goals & Non-Goals

### Goals

1. A user can ask a multi-step goal in chat and see a **typed plan** before anything executes.
2. A plan executes its steps in dependency-DAG order, calling existing `executeAgentAction` per step. No action re-implementation.
3. Per-plan **safety budgets** (steps, cost, wall-clock, retry) prevent runaway agents.
4. The existing AI Inbox approval surface works unchanged — every approval-gated step still produces an inbox item, now linked to its parent plan.
5. 70%+ test coverage on the new `agent-planner/` module, including the headline E2E journey.
6. Zero regressions on existing single-action chat requests.

### Non-Goals (v1)

- Streaming step progress (deferred to v1.1)
- Mid-wave cancellation (cancel only between waves in v1)
- Rollback / compensation on partial failure (v2)
- Proactive event→copilot surfacing (v2)
- Persisted conversations (Redis-only in v1)
- Multi-agent / sub-agent delegation
- LLM-as-judge on plan quality

---

## 3. Scope

| Version | Scope | Gaps addressed | Target effort |
|---|---|---|---|
| **v1 (this spec)** | Plan entity + multi-step runner + safety budgets + plan-preview UX + drop keyword short-circuits + wire actual policy | G1, G2, G3, G4, G7, G9 | ~2 weeks |
| **v1.1** | Streaming SSE for plan progress, grouped AI Inbox with bulk-approve-safe-steps | G5, G11 | ~1 week |
| **v2** | Retry/rollback with compensation hooks, proactive event→copilot surfacing, persisted conversations, goal/thread memory | G6, G8, G10, G12 | ~4 weeks |

---

## 4. Architecture

### Module boundaries

```
backend/src/modules/
├── chat/                    ← THIN: page-awareness, trivial lookup, or delegate to planner
├── agent/                   ← UNCHANGED: 17 actions, policy, executor, audit (reused via service interface)
├── agent-planner/           ← NEW: owns Plan + Step persistence, planning, DAG execution
│   ├── planner.service.ts        turns goal + pageContext → typed Plan via OpenAI structured output
│   ├── runner.service.ts         walks DAG, calls executeAgentAction per step, enforces budgets
│   ├── plan.repository.ts        DB layer for agent_plans + agent_plan_steps
│   ├── plan.schema.ts            Zod for Plan + Step + DAG validation (cycle detection, dep resolution)
│   ├── planner.prompt.ts         planner system prompt + structured-output schema
│   ├── recovery.worker.ts        BullMQ cron: resume stalled running plans
│   ├── plan.controller.ts        REST: POST /plans, GET /plans/:id, POST /plans/:id/approve, POST /plans/:id/cancel
│   ├── plan.routes.ts
│   ├── errors.ts                 PlannerError + RunnerError
│   └── metrics.ts                Prometheus counters/histograms
└── ai-inbox/                ← MINIMAL CHANGE: add agent_plan_id column, group-by-plan UI
```

**Boundary rule (per AGENTS.md):** `agent-planner` talks to `agent/` only via `proposeAgentAction` / `executeAgentAction` / `findAgentActionById`. No direct DB access across module boundaries. `ai-inbox/` reads `agent_plan_id` for grouping; the planner writes to it; nobody else does.

### Request flow (happy path: "find Mumbai dentists, qualify top 5, enroll in nurture campaign")

```
user → ChatWidget
       └─ POST /chat { message, pageContext }
            └─ chat.service.ts (thin, ~180 lines)
                 ├─ isPageAwarenessQuestion? → answer directly (existing handler, unchanged)
                 ├─ isPlanContinuation?      → resume last 'proposed' plan
                 ├─ isTrivialLookup?         → proposeAgentAction('report.dashboard') directly
                 └─ else                     → planner.createPlanFromGoal({ goal, pageContext, actor })
                      ├─ getAiConfig()
                      ├─ OpenAI structured-output call (response_format: json_schema) → Plan (validated by plan.schema.ts)
                      ├─ INSERT agent_plans + agent_plan_steps (status='proposed')
                      └─ return Plan + planId

ChatWidget renders PlanPreview card (steps, rationale, deps, risk badges, est cost)
       └─ user clicks "Approve all & run"
            └─ POST /chat/plans/:id/approve
                 └─ runner.executePlan({ planId, actor })
                      ├─ assertPlanCanRun (status='approved', not expired)
                      ├─ transitionPlan('running')
                      ├─ topoSortIntoWaves(steps)
                      └─ for each wave (Promise.allSettled):
                           for each step:
                              ├─ budget.assertCanStartStep
                              ├─ agent.proposeAgentAction(...)   ← NO forceApproval, policy decides
                              ├─ if 'require_approval':
                              │    markStepPendingApproval → creates inbox item with agent_plan_id
                              │    throw StepAwaitingApproval  → plan status 'paused_for_approval'
                              └─ if 'execute_now' / 'reject':
                                   record result, continue

For approval-gated steps, user opens /ai-inbox (now grouped by plan)
       └─ POST /ai-inbox/:id/action { action: 'approve' }
            ├─ existing flow: agent.executeAgentAction
            ├─ update agent_plan_steps.status = 'succeeded'
            └─ runner.continuePlanIfReady(planId)  → resume from current wave

Plan completes when all required steps succeed → status='succeeded'
       └─ final reply rendered in chat, full step trail visible in /admin/ai-decisions
```

---

## 5. Data Model

**Migration:** `migrations/0023_agent_plans.sql` (append-only, per AGENTS.md)

```sql
-- Plans
CREATE TABLE agent_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NULL,
  goal            text NOT NULL,
  status          text NOT NULL,  -- 'proposed' | 'approved' | 'running' | 'paused_for_approval' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
  autonomy_level  text NULL,      -- 'supervised' | 'guarded' | 'autopilot'
  confidence      int  NULL,
  source          text NOT NULL,  -- 'chat' | 'event' | 'manual'
  requested_by    uuid NULL,
  source_message  text NULL,
  cost_cap_cents  int  NOT NULL DEFAULT 50,
  step_cap        int  NOT NULL DEFAULT 8,
  cost_used_cents int  NOT NULL DEFAULT 0,
  deadline_at     timestamptz NULL,
  started_at      timestamptz NULL,
  completed_at    timestamptz NULL,
  expires_at      timestamptz NULL,
  error_message   text NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  idempotency_key text NOT NULL UNIQUE
);

CREATE INDEX agent_plans_status_idx       ON agent_plans(status, created_at DESC);
CREATE INDEX agent_plans_actor_status_idx ON agent_plans(requested_by, status);
CREATE INDEX agent_plans_conversation_idx ON agent_plans(conversation_id) WHERE conversation_id IS NOT NULL;

-- Plan steps
CREATE TABLE agent_plan_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES agent_plans(id) ON DELETE CASCADE,
  step_index      int  NOT NULL,
  action_name     text NOT NULL,
  action_args     jsonb NOT NULL,
  risk_tier       text NOT NULL,
  depends_on      int[] NOT NULL DEFAULT '{}',
  rationale       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'pending_approval' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  agent_action_id uuid NULL REFERENCES agent_actions(id),
  result          jsonb NULL,
  error_message   text NULL,
  started_at      timestamptz NULL,
  completed_at    timestamptz NULL,
  UNIQUE (plan_id, step_index)
);

CREATE INDEX agent_plan_steps_plan_idx ON agent_plan_steps(plan_id, step_index);

-- Link existing tables
ALTER TABLE agent_actions    ADD COLUMN agent_plan_id     uuid NULL REFERENCES agent_plans(id);
ALTER TABLE agent_actions    ADD COLUMN agent_plan_step_id uuid NULL REFERENCES agent_plan_steps(id);
ALTER TABLE ai_inbox_items   ADD COLUMN agent_plan_id     uuid NULL REFERENCES agent_plans(id);
ALTER TABLE ai_inbox_items   ADD COLUMN agent_plan_step_id uuid NULL REFERENCES agent_plan_steps(id);

CREATE INDEX agent_actions_plan_idx    ON agent_actions(agent_plan_id) WHERE agent_plan_id IS NOT NULL;
CREATE INDEX ai_inbox_items_plan_idx   ON ai_inbox_items(agent_plan_id) WHERE agent_plan_id IS NOT NULL;
```

**Backward compatibility:** All new columns are nullable. Existing `agent_actions` and `ai_inbox_items` rows get `NULL` — correct (they predate the planner). No data migration required.

---

## 6. Plan Schema, Planner Prompt, Validation

### In-memory Plan shape (Zod)

```typescript
// backend/src/modules/agent-planner/plan.schema.ts

const planStepSchema = z.object({
  step_index:  z.number().int().min(0).max(50),
  action_name: agentActionNameSchema,         // reused from agent/agent.schema.ts
  action_args: z.record(z.unknown()),
  risk_tier:   agentRiskTierSchema,
  depends_on:  z.array(z.number().int().min(0)).default([]),
  rationale:   z.string().min(1).max(500),
});

export const planSchema = z.object({
  goal:  z.string().min(1).max(2000),
  steps: z.array(planStepSchema).min(1).max(8),  // hard cap = step_cap
}).superRefine((plan, ctx) => {
  // 1. step_indexes must be 0..N-1 contiguous (no gaps)
  // 2. each depends_on[i] must reference an existing step_index
  // 3. no cycles (Kahn's algorithm topological sort)
  // 4. each step.action_args must parse against getAgentActionDefinition(name).schema
  // 5. step.risk_tier must equal getAgentActionDefinition(name).risk_tier (risk-lock defense)
  // 6. compliance_critical actions are forbidden in plans — reject the whole plan
});
```

`superRefine` collects all errors and fails with a single rejection. Validation errors are logged to `agent_decision_log` with `chain_of_thought` = the full plan draft + every error.

### Planner prompt structure

Uses OpenAI **structured outputs** (`response_format: { type: 'json_schema', strict: true, schema: planJsonSchema }`) — more reliable than free-form tool calls for plan emission. The tool calls remain available as a fallback if structured outputs are rejected by a future model.

```typescript
// backend/src/modules/agent-planner/planner.prompt.ts

export function buildPlannerSystemPrompt(ctx: {
  actor: AgentActor;
  autonomyLevel: 'supervised' | 'guarded' | 'autopilot';
  today: string;
}): string {
  return `
You are a CRM planning agent. Convert the user's goal into a typed plan of agent actions.

Available actions (use ONLY these — never invent API routes or table names):
${listActionsForPrompt()}     // pulls from AGENT_ACTIONS: name, description, risk_tier, allowed_roles, arg schema summary

Current context:
- Actor role: ${ctx.actor.role}
- Autonomy level: ${ctx.autonomyLevel}
- Date: ${ctx.today}
- Step cap: 8 steps max. Cost cap: ~$0.50. Wall-clock cap: 5 min.

Rules:
1. Every step must have a one-sentence rationale explaining WHY this step is needed.
2. Never put a destructive write in the middle of a chain — put all reads first, then low-risk writes,
   then sensitive/customer-facing writes last (so the user can stop the plan after any step).
3. If a step's output feeds into a later step's args, declare depends_on explicitly.
4. If you cannot accomplish the goal safely within the step cap, return FEWER steps and explain in the goal
   field what was not achievable — do not silently drop steps.
5. Never claim an action will succeed; the runner reports actual results.
  `.trim();
}
```

User message = `{ goal: input.message, pageContext: input.pageContext }`. `pageContext` shape is unchanged from existing `chat/chat.schema.ts`.

### Planner failure handling

| Failure | Behavior |
|---|---|
| OpenAI returns malformed JSON | Retry once with stricter prompt; if still bad → 502 with `planner_error: 'planner_malformed'` |
| Plan parses but `superRefine` fails | Reject with all reasons collected, log to `decision_log`, return 422 with `planner_error: 'invalid_plan'` |
| Plan contains `compliance_critical` step | Auto-reject (compliance actions must never come from planner) |
| Plan contains only `read` + `low_risk_write` steps | Auto-approve (`status='approved'`) if `autonomy_level !== 'supervised'`. Otherwise require explicit approval. |
| Plan contains any `customer_facing_write` or `sensitive_write` step | Status stays `proposed` until user approves |
| Idempotency hit (same `(actor, goal)` within 5 min) | Return existing plan, do not re-plan |

---

## 7. Runner Semantics

### Core loop

```typescript
export async function executePlan(planId: string, actor: AgentActor): Promise<PlanRunResult> {
  const plan = await loadPlan(planId);
  assertPlanCanRun(plan, actor);             // status === 'approved', not expired

  const budget = createBudgetTracker(plan);   // step / cost / clock / retry counters
  await transitionPlan(plan, 'running');
  setStartedAt(plan);

  const waves = topoSortIntoWaves(plan.steps);  // waves[0] = no deps, waves[N] depends on waves[N-1]
  for (const wave of waves) {
    if (await isCancelled(plan.id)) return finalizePlan(plan, 'cancelled');

    const results = await Promise.allSettled(
      wave.map((step) => runStep(plan, step, budget, actor))
    );
    recordWaveResults(plan.id, wave, results);

    const waveHadRequiredFailure = results.some(
      (r, i) => r.status === 'rejected' && wave[i].risk_tier !== 'low_risk_write'
    );
    if (waveHadRequiredFailure) return finalizePlan(plan, 'failed');
  }

  return finalizePlan(plan, 'succeeded');
}

async function runStep(plan, step, budget, actor) {
  budget.assertCanStartStep(step);

  const proposal = await agent.proposeAgentAction({
    source: 'chat',
    actionName: step.action_name,
    args: step.action_args,
    actor,
    sourceMessage: `${plan.goal} (plan ${plan.id}, step ${step.step_index})`,
    // NO forceApproval — evaluateAgentPolicy decides based on autonomy_level
  });

  if (proposal.policy.outcome === 'require_approval') {
    markStepPendingApproval(step, proposal.action);
    throw new StepAwaitingApproval(step.step_index);
  }
  if (proposal.policy.outcome === 'reject') {
    throw new StepRejected(step.step_index, proposal.policy.reason);
  }

  budget.recordStepCost(step, /*estimated cost*/);
  return proposal.result;
}
```

### Budgets

| Budget | Default | Source | Enforced |
|---|---|---|---|
| Step cap | 8 | `agent_plans.step_cap` | At plan creation (hard reject if OpenAI emits more) |
| Cost cap | $0.50 | `agent_plans.cost_cap_cents` | Before each step; cost = risk_tier weight + actual OpenAI token cost |
| Wall-clock cap | 5 min | `agent_plans.deadline_at` | Before each wave; if `now > deadline_at` → finalize as `failed` |
| Step retry | 1 per step | In-memory tracker | Caught exceptions → retry once; second failure → `failed` |

**Cost estimate weights** (configurable in `ai-settings`):

```
read                  = $0.001
low_risk_write        = $0.01
sensitive_write       = $0.05
customer_facing_write = $0.10
+ actual OpenAI token cost from the planner call
```

### Failure handling per risk tier

| Step risk | Failure → action |
|---|---|
| `read` | **Hard fail** — plan → `failed`. Retry once, then stop. We can't continue without the data. |
| `low_risk_write` | **Soft skip** — mark `skipped`, plan continues. |
| `sensitive_write` | **Hard fail** — mark `failed`, plan → `failed`. User must re-plan. (Rollback in v2.) |
| `customer_facing_write` | **Hard fail** — same as sensitive_write. Never proceeds without explicit per-step approval. |
| `compliance_critical` | **Never planned** — planner schema rejects plans containing this action. |

### Plan status machine

```
proposed ──approve──▶ approved ──runner.start──▶ running ─┬─▶ succeeded
   │                       │                              ├─▶ failed
   │                  runner.pause                         └─▶ cancelled
   │                       │
   │                       ▼
   └──── TTL ──────▶   expired       paused_for_approval ──approval resolves──▶ running
```

`paused_for_approval` is a sub-state of `running`: at least one step in the current wave awaits an inbox decision. Runner yields back; resumes via `runner.continuePlanIfReady(planId)` called by the inbox action handler.

### Approval flow (hybrid loop)

```
runner hits require_approval step
  → agent.proposeAgentAction creates agent_action (status='pending_approval')
  → agent.proposeAgentAction also creates ai_inbox_item with agent_plan_id + agent_plan_step_id
  → runner marks step 'pending_approval', plan 'paused_for_approval'
  → throws StepAwaitingApproval; wave aborts, plan status reflects pause

user opens /ai-inbox → sees card grouped under plan with "Part of plan: <goal> (3/5 approved)"
  → POST /ai-inbox/:id/action { action: 'approve' }
  → existing handler runs agent.executeAgentAction
  → handler updates agent_plan_steps.status = 'succeeded', agent_action_id = ...
  → handler calls runner.continuePlanIfReady(planId)
  → runner checks: any other steps in current wave still pending_approval?
      yes → stay paused
      no  → resume to next wave
```

### Cancellation

- `POST /chat/plans/:id/cancel` flips `agent_plans.status = 'cancelled'`.
- Runner checks `isCancelled` **between waves only** (not within — aborting mid-wave risks CRM inconsistency).
- Already-executed steps stay executed. No rollback in v1.

### Recovery (crash-safe)

- Plans are DB rows. If the runner process dies mid-wave, a **plan-recovery cron** (BullMQ repeatable, every 60s) finds `status='running'` plans where `updated_at < NOW() - 60s` and:
  1. Marks the in-flight step `failed` (no commit)
  2. Resumes the plan from the next un-run step
- Capped at 3 recovery attempts per plan; after that → `failed` with reason `recovery_exhausted`.

---

## 8. Chat Rewrite + UI Surface

### `chat.service.ts` (new shape)

**Before:** ~620 lines, 7 keyword handlers, one OpenAI call, single tool call, deterministic fallback.
**After:** ~180 lines, zero action-routing handlers, delegates to planner for any non-trivial request.

```typescript
export async function sendChatMessage(input: SendChatMessageInput): Promise<ChatResponse> {
  // 1. Page-awareness fast path (the ONLY remaining short-circuit)
  if (isPageAwarenessQuestion(input.message)) {
    return answerPageAwareness(input);
  }

  // 2. Active-plan continuity ("yes do it", "approve that")
  if (await isPlanContinuation(input.message, input.conversationId)) {
    return resumeLastPlan(input);
  }

  // 3. Trivial lookup (single read, no planning needed)
  const trivial = await maybeTrivialLookup(input);
  if (trivial) return trivial;

  // 4. The agent path — hand off to the planner
  const planResult = await planner.createPlanFromGoal({
    goal: input.message,
    pageContext: input.pageContext,
    actor: input.actor,
    autonomyLevel: input.user.autonomyLevel ?? 'supervised',
  });

  return renderPlanReply(planResult);
}
```

### `PlanPreview` component (new, frontend)

Renders inline in `ChatWidget` when the planner returns a plan. Collapsible by default with key info visible:

```
┌──────────────────────────────────────────────────────────────┐
│ 🧠 Plan: "find Mumbai dentists, qualify top 5, enroll…"     │
│ Status: ⏸ Awaiting your approval · 4 steps · est. $0.18    │
│                                                              │
│ Step 1/4 · read · scraper.run                               │
│   "Run scraper for 'dentist in Mumbai'"                     │
│   → no approval needed                                       │
│                                                              │
│ Step 2/4 · read · lead.list                                 │
│   "Filter last run by city=Mumbai"                           │
│   depends on: step 1                                         │
│   → no approval needed                                       │
│                                                              │
│ Step 3/4 · low_risk_write · ai.decision.recompute           │
│   "Recompute AI next-action for each result"                 │
│   depends on: step 2                                         │
│   → no approval needed                                       │
│                                                              │
│ Step 4/4 · customer_facing_write · campaign.launch          │
│   "Launch nurture campaign for qualified leads"             │
│   depends on: step 3                                         │
│   ⚠ needs your approval                                      │
│                                                              │
│ [ Approve all & run ] [ Show step details ▾ ] [ Cancel ]     │
└──────────────────────────────────────────────────────────────┘
```

Approval mode per plan: `auto` (only show safe steps), `whole_plan` (one button), or `per_step` (toggle each). Default = `whole_plan`.

### `AIInboxPage` grouping

Inbox items linked to a plan get a plan header showing "Part of plan: <goal> (3/5 approved)". A **"Approve remaining safe steps"** button batch-approves all `read`/`low_risk_write` steps in that plan with one click. Customer-facing steps still require individual approval — non-negotiable.

```
┌─ Plan: "find Mumbai dentists…" ──────────────────────┐
│ ☐ Step 1: scraper.run        [read]          [✓]    │
│ ☐ Step 2: lead.list          [read]          [✓]    │
│ ☐ Step 3: ai.decision.recompute [low_risk_write] [✓]│
│ ⚠ Step 4: campaign.launch    [customer_facing] […] │
│   [Approve 3 remaining safe steps]                   │
└──────────────────────────────────────────────────────┘
```

### Endpoint map (v1)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chat` | Thin: awareness / trivial / planner delegation |
| `GET`  | `/chat/history/:conversationId` | Unchanged shape; tags turns with `planId` when from planner |
| `GET`  | `/chat/plans/recent` | List last N plans for the actor (drives "continue?" UX) |
| `GET`  | `/chat/plans/:id` | Full Plan with steps + statuses (drives PlanPreview) |
| `POST` | `/chat/plans/:id/approve` | Approve the whole plan or specific steps |
| `POST` | `/chat/plans/:id/cancel` | Cancel before or mid-run (between waves only) |
| `PATCH`| `/ai-inbox/:id/action` | Unchanged endpoint; handler now also calls `runner.continuePlanIfReady` and updates `agent_plan_steps.status` |
| `GET`  | `/ai-inbox` | Same, but renders group-by-plan in the UI |
| `POST` | `/agent/plans` | Direct planner API for non-chat sources (events in v2) — exists but unused in v1 UI |

### What we are NOT shipping in v1 (expectations set explicitly)

- ❌ No streaming — chat returns full Plan in one shot. PlanPreview renders immediately. (G5 → v1.1.)
- ❌ No live progress — refresh `/ai-inbox` to see step status updates. (G5 → v1.1.)
- ❌ No mid-wave cancel — cancel only works between waves.
- ❌ No rollback — already-executed steps stay executed on cancel/failure. (G6 → v2.)
- ❌ No conversation persistence — Redis history only, 2hr TTL. (G10 → v2.)

### `pageContext` evolution

No change to `buildPageContext` shape. We just start sending it to the **planner** (not just chat). The planner uses it to:
- Resolve visible record IDs (no "which lead?" questions for items on screen)
- Skip `lead.list` if `visibleRecords` already has what we need
- Populate `rationale` with page-aware phrasing

---

## 9. Error Handling

### Typed errors

```typescript
// backend/src/modules/agent-planner/errors.ts

export class PlannerError extends AppError {
  constructor(public code: 'invalid_plan' | 'planner_timeout' | 'planner_malformed' | 'compliance_in_plan',
              message: string, public planDraft?: unknown) {
    super(message, mapCodeToHttp(code));
  }
}

export class RunnerError extends AppError {
  constructor(public code: 'budget_exhausted' | 'step_failed' | 'plan_cancelled' | 'recovery_exhausted' | 'approval_timeout',
              message: string, public planId: string, public stepIndex?: number) {
    super(message, mapCodeToHttp(code));
  }
}
```

| Code | HTTP | User-facing message |
|---|---|---|
| `invalid_plan` | 422 | "I couldn't build a safe plan for that. Try being more specific, or break it into two requests." |
| `planner_timeout` | 504 | "The planner took too long. Try again." |
| `planner_malformed` | 502 | "I couldn't understand the plan I generated. Retrying once more." |
| `compliance_in_plan` | 422 | "That action requires a direct command, not a plan." |
| `budget_exhausted` | 409 | "Plan hit the step/cost/time cap. Split into smaller requests." |
| `step_failed` | 409 | "Step X failed: <reason>. See /ai-inbox for options." |
| `plan_cancelled` | 200 | (return cancelled plan, not error) |
| `recovery_exhausted` | 500 | "Plan stalled and recovery failed. Open /ai-inbox." |
| `approval_timeout` | 409 | "Plan paused too long waiting for approval. Re-issue the request." |

All errors: (a) logged to `agent_decision_log`, (b) increment `crm_agent_plan_errors_total{code}`, (c) Sentry capture for `>=500` codes.

### Idempotency matrix

| Operation | Key | TTL | On hit |
|---|---|---|---|
| Create plan | `sha256(source:actor.id:goal:sourceMessage)` | 5 min | Return existing plan |
| Execute step | Existing `agent_actions.idempotency_key` | forever | Existing behavior |
| Approve plan | `sha256(planId:actor.id:stepIndexes[])` | 5 min | Return current plan state |
| Inbox action | Existing 5-sec window in `ai-inbox.service.ts:actionItem` | 5 sec | Return existing record |

---

## 10. Observability

### Prometheus counters (extend `shared/utils/metrics.ts`)

```
crm_agent_plans_created_total{source, autonomy_level}
crm_agent_plans_succeeded_total{autonomy_level}
crm_agent_plans_failed_total{autonomy_level, reason}
crm_agent_steps_executed_total{action_name, risk_tier, outcome}
crm_agent_plan_errors_total{code}
```

### Histograms

```
crm_agent_plan_duration_seconds{autonomy_level}
crm_agent_step_duration_seconds{risk_tier}
crm_agent_planner_tokens_total{model, kind}            # kind = prompt | completion
crm_agent_plan_cost_cents{autonomy_level}
```

### Audit (existing surfaces, no new tables)

- Every plan transition → `ai_intelligence.decision_log` row with `decision_type='agent_plan'`
- Every step start/end → `decision_log` row with `decision_type='agent_step'`
- Plan approve/cancel → `writeAuditLog` entry with `action='agent_plan.approve' | 'agent_plan.cancel'`
- Existing `/admin/ai-decisions` page filters by `decision_type` — new rows just appear.

### Sentry

Capture every `PlannerError`/`RunnerError` with `extra: { planId, stepIndex, autonomyLevel, actorRole }`. Already initialized via `initSentry()` in `backend/src/index.ts`.

---

## 11. Testing Strategy

### Unit (Jest, target 80%+ on `agent-planner/`)

- `plan.schema.ts` — every `superRefine` rule (cycle, missing dep, gap in indexes, bad args, risk mismatch, cross-step reference, compliance rejection)
- `runner.budget.ts` — every budget type, exhaustion boundaries
- `runner.topo-sort.ts` — linear, fan-out, fan-in, diamond, deep chain, cycle rejection
- `idempotency.ts` — key stability, collision resistance
- Policy wiring (`forceApproval` removed) — verify policy engine now decides
- All error mapping (`errors.ts`)

### Integration (Jest + real test PostgreSQL, per AGENTS.md)

- Planner end-to-end with **mocked OpenAI** — fix response, verify DB writes
- Runner end-to-end with **real agent module** — verify each action category (read, low_risk_write, sensitive_write, customer_facing_write) executes through the runner
- Approval pause/resume — pause plan, approve via inbox, verify runner resumes from correct wave
- Recovery cron — kill a plan mid-wave, verify recovery picks it up
- All failure modes from §7 — read failure, low_risk skip, sensitive fail, budget exhausted, cancel between waves
- Migration — apply `0023_*.sql` to clean test DB, verify schema, verify backward compat (existing `agent_actions` rows have NULL `agent_plan_id`)

### E2E (one full journey test)

- User sends multi-step chat message → planner creates plan → preview rendered → user approves whole plan → all read steps execute inline → one customer_facing step pauses for inbox → user approves → plan resumes → plan status `succeeded`
- Assert: plan row, all step rows, all `agent_actions` rows linked correctly, all `ai_inbox_items` linked correctly, decision_log has full trail

### What we explicitly do not test

- LLM output quality (mock OpenAI; manual spot-check on 5–10 real prompts)
- Prompt-injection edge cases beyond the risk-lock defense (security review item, not a test)
- OpenAI latency / cost accuracy (we measure, we don't assert)

### Coverage target

70%+ per AGENTS.md, target 80%+ on `agent-planner/`.

---

## 12. Data Retention

| Table | Retention | Cleanup |
|---|---|---|
| `agent_plans` (status='succeeded' or 'failed') | 30 days | Daily BullMQ job |
| `agent_plans` (status='cancelled' or 'expired') | 7 days | Same job |
| `agent_plan_steps` | 90 days (longer for debugging) | Same job |
| `agent_decision_log` rows from planner/runner | Inherit existing retention (90d) | Existing cleanup |

---

## 13. Rollout Plan

1. **Migration first** — deploy `0023_*.sql` alone. Existing data unaffected (nullable columns).
2. **Code behind flag** — `AGENT_PLANNER_ENABLED` env var (default `false` in prod for week 1).
3. **Shadow mode (week 1)** — planner creates plans, returns `status='proposed'`, never executes. Real users see plans but nothing happens until they approve. Catches schema/prompt issues with zero risk.
4. **Approval-required mode (week 2)** — full functionality, default `autonomy_level='supervised'`. Every plan needs explicit approval. Same behavior as before, new UX.
5. **Mixed autonomy (week 3+)** — admins can flip specific workspaces to `guarded` or `autopilot`. Monitor `crm_agent_plans_failed_total` and per-step error rates before opening up.
6. **Rollback path** — flip `AGENT_PLANNER_ENABLED=false` → chat falls back to existing single-shot path. Old code paths kept for 30 days, then deleted.

---

## 14. Open Risks & Out-of-Scope

### Risks

- **OpenAI structured outputs support** — assumed available on the configured model. Fallback to function-calling tool_use if a future model drops support.
- **DAG correctness for cross-step arg passing** — depends on documenting each action's return shape in `AGENT_ACTIONS`. Currently undocumented; needs a quick audit pass during implementation.
- **Cost estimation accuracy** — risk_tier weight approach is a rough heuristic. May underestimate complex chains. v1.1 should switch to actual token-cost tracking per step.
- **Recovery cron contention** — two recovery workers picking the same plan simultaneously. Mitigated by `UPDATE ... WHERE status='running'` claim pattern (same as agent_action claim).
- **Plan preview UX approval overhead** — if 100% of plans require approval, the new UX is slower than the old single-action chat. Mitigate via `guarded` autonomy default for trusted workspaces.

### Out-of-scope (documented for v2 / future)

- Real-time streaming step progress (v1.1)
- Rollback / compensation on partial failure (v2)
- Proactive event→copilot surfacing (v2)
- Persisted conversations beyond Redis TTL (v2)
- Conversational goal/thread memory (v2)
- Multi-agent / sub-agent delegation
- LLM-as-judge on plan quality

---

## 15. Success Criteria (for `complete_ferment` to validate)

1. Migration `0023_*.sql` applies cleanly to existing dev + test DBs without altering existing row data.
2. `POST /chat` with a 3-step multi-module goal returns a Plan with all steps validated, linked, and `status='proposed'`.
3. `POST /chat/plans/:id/approve` for an all-reads plan runs end-to-end with status `succeeded` and all `agent_actions` rows linked back to the plan.
4. `POST /chat/plans/:id/approve` for a plan with one `customer_facing_write` step produces an `ai_inbox_item` with `agent_plan_id` set; user approval via `PATCH /ai-inbox/:id/action` resumes and completes the plan.
5. Killing the runner mid-wave leaves the plan in `status='running'`; recovery cron resumes it within 90 seconds.
6. Budget exhaustion (8-step cap exceeded) rejects the plan at creation; cost-cap exceeded mid-plan finalizes as `failed` with reason.
7. Backend test coverage on `agent-planner/` ≥ 80% lines; overall backend coverage stays ≥ 70%.
8. E2E test (chat → plan → approval → execute → success) passes in CI.
9. The chat keyword short-circuits are gone; regression test confirms a multi-step request no longer takes the deterministic-fallback path.
10. Rollback: flipping `AGENT_PLANNER_ENABLED=false` restores old chat behavior, no DB cleanup needed.
