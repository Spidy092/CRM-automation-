# AI Chatbot Copilot and Autonomous Agent Harness

> **Status:** Design refresh (pre-implementation for chat module; partial implementation for Phase 2 AI workers)  
> **Author:** generated 2026-06-29  
> **Source of truth for:** natural-language CRM copilot, event-driven AI Sales Operator harness, and human approval control plane.
>
> This document is grounded in the current codebase. It corrects the earlier chat-only spec, which explicitly excluded autonomous/background action. Phase 2 now has concrete autonomous pieces (`ai-decisions`, `ai-reply`, `ai-inbox`, `lead-events`), so the copilot must be designed as the command surface over an event-driven agent harness, not as a standalone chatbot.

---

## 1. Executive Summary

The AI Chatbot Copilot is the conversational interface for the CRM's AI Sales Operator.

The AI Sales Operator is an event-driven agent runtime that:

- observes CRM events (`lead.created`, `lead.stage_moved`, inbound replies, campaign launch signals),
- computes next-best actions through existing AI modules,
- executes only low-risk actions that pass campaign autonomy rules,
- routes uncertain, sensitive, or policy-gated actions to `ai_inbox_items` for human approval,
- records every AI decision in `ai_decision_log`,
- preserves RBAC and service-layer ownership rules for every action.

The chat widget is not the only agent entry point. It is the human command plane for the same runtime:

- ask questions about leads, campaigns, reports, and inbox items,
- request CRM actions in natural language,
- approve/reject/snooze AI inbox actions,
- inspect why the agent made a recommendation,
- change autonomy settings where the user's role allows it.

The harness goal is: **best autonomous execution with explicit human approval gates where risk, confidence, RBAC, or campaign configuration requires supervision.**

---

## 2. Current-State Evidence

Verified existing backend pieces:

| Area | Current source |
|---|---|
| Queue definitions | `backend/src/workers/queue.ts` defines `lead-events`, `ai-research`, `ai-reply`, `ai-decisions`, `ai-campaign`, `ai-inbox`, and outreach queues. |
| Event router | `backend/src/workers/events.worker.ts` handles `lead.created`, `lead.stage_moved`, `lead.status_changed`, `lead.assigned`, `lead.scored`. |
| Next-best-action worker | `backend/src/workers/aiDecision.worker.ts` consumes `ai-decisions` and calls `computeNextBestAction`. |
| AI reply classifier | `backend/src/modules/ai-reply/ai-reply.service.ts` classifies inbound replies, updates memory, cancels outreach on opt-out, and routes human-review cases to AI inbox. |
| AI inbox | `backend/src/modules/ai-inbox/` exposes `GET /api/v1/ai-inbox` and `PATCH /api/v1/ai-inbox/:id/action`. |
| Approval persistence | `migrations/1750000000021_ai-inbox-items.js` creates `ai_inbox_items` with status, draft response, urgency, expiry, and action metadata. |
| Campaign autonomy | `migrations/1750000000022_campaign-autonomy-columns.js` adds `campaigns.autonomy_level` and `campaigns.ai_min_confidence`. |
| Decision logging | `migrations/1750000000018_ai-decision-log.js` includes `autonomy_level` and `human_approval_required`. |

Verified gaps:

| Gap | Why it matters |
|---|---|
| No `src/modules/chat/` module exists yet. | Conversational command plane still needs backend implementation. |
| AI inbox approval currently updates inbox item status only. | Approving an item does not yet execute the underlying draft/action through a typed action payload. |
| Guarded expiry sweep marks items as actioned, but does not execute a downstream action. | Timeout approval is not complete without an executor. |
| `events.worker.ts` skips `request_human_approval`, `request_review`, `call`, and `escalate_to_rep` actions by logging only in some paths. | Those decisions should create actionable AI inbox items or explicit notifications. |
| Queue helper for `ai-decisions` is missing. | `aiDecisionQueue` exists, but there is no exported `enqueueAiDecision` helper matching other AI workers. |
| No durable idempotency key for chat-triggered writes. | Retried chat confirmations could duplicate writes without a command ledger. |

---

## 3. Product Goals

1. Conversational CRM control: users can ask the copilot to query, summarize, or change CRM state using natural language.
2. Autonomous agent runtime: qualifying events trigger AI decisions without requiring a user to open the chat widget.
3. Human approval harness: sensitive or uncertain actions become AI inbox work items with approve/reject/snooze controls.
4. Unified action executor: chat confirmations, AI inbox approvals, guarded-timeout auto-actions, and event-driven autonomy all execute through the same typed action path.
5. RBAC parity: the agent never bypasses the existing service layer or role checks.
6. Auditability: every proposed, approved, rejected, auto-executed, and failed action is traceable.
7. Failure isolation: OpenAI, Redis, queue, or connector failures must not corrupt CRM state or silently drop decisions.

Non-goals for v1:

- Do not create a fully independent agent that writes directly to repositories.
- Do not add direct SQL access inside the chat module or harness.
- Do not let the LLM invent actions outside an allowlisted tool/action catalog.
- Do not send secrets, credentials, passwords, or unnecessary PII to OpenAI.

---

## 4. Target Architecture

```text
User chat / AI inbox / CRM event
        |
        v
Agent Command Intake
        |
        v
Intent + Action Proposal
        |
        v
Policy Gate
  - RBAC
  - autonomy_level
  - confidence threshold
  - action risk tier
  - opt-out / compliance rules
        |
        +--------------------+
        |                    |
        v                    v
Execute now              Human approval
        |                    |
        v                    v
Typed Action Executor    ai_inbox_items
        |                    |
        v                    v
Existing services        approve/reject/snooze
        |                    |
        +---------<----------+
        |
        v
Audit + decision log + metrics + notifications
```

The action executor is the critical boundary. All agent paths must converge there:

- chat write confirmation,
- AI inbox approval,
- guarded-mode expiry,
- autopilot event decisions,
- future scheduled/autonomous decisions.

No worker, controller, or LLM tool should execute CRM writes directly once the harness exists.

---

## 5. Autonomy Model

Campaigns already support these values through `campaigns.autonomy_level`:

| Level | Behavior |
|---|---|
| `supervised` | Every AI-generated write requires explicit human approval. No timeout auto-send. |
| `guarded` | Low-risk, high-confidence actions may execute. Draft/message approval items may auto-expire only if the action executor supports the final action safely. |
| `autopilot` | The agent can execute allowed actions when confidence is at or above `ai_min_confidence`, subject to hard safety rules. Humans review summaries and exceptions. |

Hard global rules:

- `opt_out` and explicit stop requests immediately cancel pending outreach regardless of autonomy level.
- `meeting_request`, `pricing_question`, and `wrong_contact` route to a human.
- Any confidence below campaign `ai_min_confidence` routes to human review.
- Any action without a registered executor routes to human review or is rejected.
- Any action denied by RBAC or service-layer validation fails closed.
- Any malformed LLM output fails closed and logs a decision with `decision = 'failed'` or `request_review`.

---

## 6. Action Risk Tiers

The harness needs a static action policy table. The LLM can propose actions, but policy decides execution.

| Tier | Examples | Default handling |
|---|---|---|
| Read | list leads, campaign stats, dashboard metrics, inbox summaries | Execute immediately if RBAC allows. |
| Low-risk write | create inbox item, update AI notes, recompute next-best-action | Execute in `guarded`/`autopilot`; approve in `supervised`. |
| Customer-facing write | send WhatsApp/email/SMS, resume outreach, launch campaign | Approval required unless `autopilot` and confidence >= threshold. |
| Sensitive write | reassign lead, pause campaign, stage movement, scraper run | Approval required in `supervised` and `guarded`; `autopilot` only if explicitly allowlisted. |
| Compliance-critical | opt-out handling, stop sequence, suppression | Execute immediately to protect the lead/customer. Notify humans after. |
| Unsupported/destructive | delete, hard purge, raw SQL, migration, credential change | Never execute through copilot. Require normal admin/DevOps workflow. |

---

## 7. Typed Action Catalog

Each action must have:

- a stable action name,
- Zod argument schema,
- risk tier,
- required roles,
- idempotency key builder,
- executor function that calls an existing service,
- audit metadata builder,
- result normalizer for the standard response envelope.

Initial catalog:

| Action | Tier | Existing backing path | Human gate |
|---|---|---|---|
| `lead.list` | Read | `listLeads(filters, actor)` | No |
| `lead.get` | Read | `getLeadById(id, actor)` | No |
| `lead.create` | Sensitive write | `createLead(input, actor)` | Yes unless explicit role/policy allow |
| `lead.update` | Sensitive write | `updateLeadFields(id, input, actor)` | Yes |
| `lead.pause` | Sensitive write | `setLeadPaused(id, paused, actor)` | Yes |
| `pipeline.move_lead` | Sensitive write | `moveLead(leadId, stageId, actor)` | Yes |
| `campaign.list` | Read | `getAllCampaigns()` | No |
| `campaign.pause` | Customer-facing write | `pauseCampaignById(id, actor)` | Yes |
| `campaign.resume` | Customer-facing write | `resumeCampaignById(id, actor)` | Yes |
| `campaign.launch` | Customer-facing write | `launchCampaignById(id, actor)` | Yes unless policy allows |
| `campaign.stats` | Read | `getStats(campaignId)` | No |
| `assignment.override` | Sensitive write | `overrideAssignment(leadId, newUserId, reason, actor)` | Yes |
| `report.dashboard` | Read | `getDashboardMetrics(actor)` | No |
| `scraper.run` | Sensitive write | `runScrape(configId, actor)` | Yes, admin-only |
| `outreach.send_manual` | Customer-facing write | `sendManualOutreach(leadId, channel, input, actor)` | Yes unless autopilot policy allows |
| `ai.decision.recompute` | Low-risk write | `computeNextBestAction(leadId, { force })` through `ai-decisions` queue | No for allowed roles |
| `ai.inbox.action` | Low-risk write | `actionItem(id, userId, action, snoozedUntil)` | Direct human action |

Important: existing single-lead services should not be bulk-looped silently. Bulk operations require either a real bulk service or a confirmation/inbox item that shows exact count and partial-failure behavior.

---

## 8. Human Approval Harness

`ai_inbox_items` is the right user-facing queue, but it needs a richer action payload before it can be the full approval harness.

Required extension:

```ts
interface AgentPendingAction {
  action: AgentActionName;
  args: unknown;
  proposedBy: 'chat' | 'ai-reply' | 'ai-decision' | 'ai-campaign-brain' | 'event-worker';
  proposedForUserId: string;
  leadId?: string;
  campaignId?: string;
  confidence?: number;
  riskTier: AgentRiskTier;
  sourceMessage?: string;
  idempotencyKey: string;
  expiresAt?: string;
}
```

Persistence options:

1. Add `action_payload JSONB`, `risk_tier`, `idempotency_key`, and `source` to `ai_inbox_items`.
2. Or create a dedicated `agent_actions` table and link `ai_inbox_items.agent_action_id`.

Recommendation: use a dedicated `agent_actions` table for append-only auditing and idempotency, then keep `ai_inbox_items` as the assignee/work queue projection.

Minimum `agent_actions` fields:

| Field | Purpose |
|---|---|
| `id` | UUID primary key |
| `source` | `chat`, `event`, `ai_reply`, `ai_decision`, `ai_campaign_brain`, `expiry` |
| `action_name` | Catalog action key |
| `action_args` | Validated JSON payload |
| `risk_tier` | Read/low/customer-facing/sensitive/compliance |
| `status` | `proposed`, `pending_approval`, `approved`, `rejected`, `executing`, `succeeded`, `failed`, `expired`, `cancelled` |
| `requested_by` | User id for chat/manual actions, null for system events |
| `approved_by` | Human approver id |
| `lead_id` / `campaign_id` | Optional entity scope |
| `confidence` | AI confidence if available |
| `autonomy_level` | Campaign autonomy at proposal time |
| `idempotency_key` | Unique execution guard |
| `result` | Normalized execution result or failure metadata |
| `created_at` / `updated_at` / `executed_at` | Lifecycle timestamps |

Approval flow:

```text
AI proposes action
  -> validate action args
  -> write agent_actions(status = pending_approval)
  -> create ai_inbox_items row assigned to owner/rep/manager
Human approves
  -> actionItem marks inbox row actioned
  -> AgentActionExecutor executes action once by idempotency_key
  -> write audit log + decision log + metrics
Human rejects
  -> mark action rejected
  -> do not execute
Human snoozes
  -> keep pending, set snoozed_until
Guarded expiry
  -> executor runs only if policy still allows auto-action at expiry time
```

---

## 9. Conversational Copilot Backend

New backend module: `backend/src/modules/chat/`.

| File | Responsibility |
|---|---|
| `chat.controller.ts` | Validate body/params, call chat service, return standard envelope. |
| `chat.service.ts` | Load conversation, call OpenAI with action tools, ask policy gate, propose/execute actions. |
| `chat.actions.ts` | Chat-facing tool definitions mapped to the shared action catalog. |
| `chat.prompt.ts` | Centralized system prompt. |
| `chat.schema.ts` | Zod validation for message, confirmation, history, and tool arguments. |
| `chat.types.ts` | `ChatTurn`, `ChatResponse`, `PendingChatAction`, action summaries. |
| `chat.routes.ts` | `POST /api/v1/chat`, `GET /api/v1/chat/history/:conversationId`. |

Route mounting:

```ts
app.use('/api/v1/chat', authenticatedLimiter, chatRoutes);
```

Routes must apply `authenticate` and `authorize('admin', 'manager', 'sales', 'marketing', 'viewer')`, then let the action catalog enforce per-action role limits.

OpenAI pattern:

1. Build messages from system prompt, bounded Redis history, and current user turn.
2. Call OpenAI with tool/function definitions from the action catalog.
3. Validate the selected tool arguments with Zod.
4. If read action, execute through action executor immediately.
5. If write action, create `agent_actions` + `ai_inbox_items` or a short-lived chat confirmation depending on risk and policy.
6. Never claim success until executor returns a concrete result.

Redis:

- `chat:history:<conversationId>`: bounded turn history, 1-2 hour TTL.
- `chat:pending:<conversationId>`: short-lived confirmation only for immediate chat confirmations.
- Durable writes must live in `agent_actions`; Redis alone is not enough for approval or execution.

---

## 10. Event-Driven Autonomous Harness

Existing event paths should be upgraded to use the same action executor:

| Event/source | Current behavior | Target harness behavior |
|---|---|---|
| `lead.created` | Enqueues scoring and AI research. | Also enqueue `ai:next-action` after scoring/research when enough context exists. |
| `lead.scored` | Logs score only in `events.worker.ts`. | Enqueue `ai:next-action` with score context. |
| `lead.stage_moved` | Reads next-best-action and dispatches/skips outreach. | Convert next-best-action into typed agent action, then policy-gate execution. |
| inbound reply webhook | Enqueues `ai:classify-reply`; classifier creates inbox item for review cases. | Store proposed action payload with inbox item so approval can execute. |
| AI campaign brief | Generates brief and creates campaign review inbox item. | Approval should update/launch campaign through typed action if requested. |
| guarded expiry | Marks inbox item actioned. | Re-run policy and execute linked action if still safe. |

Add queue helper:

```ts
export async function enqueueAiDecision(payload: AiDecisionJobData): Promise<void> {
  await aiDecisionQueue.add(AI_DECISION_LEAD, payload, {
    jobId: `ai:decision:${payload.leadId}${payload.force ? ':force' : ''}`,
  });
}
```

Use service-layer event publishers rather than workers enqueueing chains where possible. Workers may route to queues, but domain decisions should remain in services or the shared action executor.

---

## 11. Policy Gate

Create a dedicated policy service, for example `backend/src/modules/agent/agent.policy.ts`.

Inputs:

```ts
interface AgentPolicyInput {
  action: AgentActionDefinition;
  args: unknown;
  actor: { id: string; role: string } | null;
  source: AgentActionSource;
  autonomyLevel?: 'supervised' | 'guarded' | 'autopilot';
  aiMinConfidence?: number;
  confidence?: number;
  leadId?: string;
  campaignId?: string;
}
```

Outputs:

```ts
type AgentPolicyDecision =
  | { outcome: 'execute_now'; reason: string }
  | { outcome: 'require_approval'; reason: string; assignTo: string }
  | { outcome: 'reject'; reason: string };
```

Policy rules:

- Check action role allowlist before any LLM-proposed write.
- `viewer` can run read tools only.
- `supervised` always requires approval for writes.
- `guarded` requires approval for customer-facing and sensitive writes unless explicitly allowlisted.
- `autopilot` can execute customer-facing writes only when confidence >= campaign threshold and action is allowlisted.
- Compliance-critical stop/opt-out executes immediately even without approval.
- Missing actor on system event is allowed only for system-safe actions; any user-scoped action must resolve a responsible owner/assignee.
- Re-check policy at execution time, not only proposal time.

---

## 12. Audit, Decision Log, and Metrics

For every proposed action:

- insert `agent_actions`,
- if AI-generated, insert or update `ai_decision_log`,
- emit metric `crm_agent_actions_total{source,action,status,risk_tier}`,
- log structured metadata without secrets or full PII.

For every executed write:

- call `writeAuditLog` with `action = 'agent.<action_name>'`,
- include `source`, `agentActionId`, `idempotencyKey`, `leadId`, `campaignId`, and the original source message when applicable,
- include `human_approval_required` and `approved_by` in decision metadata,
- emit duration histogram for action execution,
- send SSE notification for approval-required, succeeded, failed, and auto-executed actions where useful.

Never log:

- passwords,
- API keys,
- OAuth tokens,
- provider credentials,
- full raw inbound payloads when they contain unnecessary PII.

---

## 13. Frontend Control Surfaces

### Floating chat widget

Add:

- `frontend/src/api/chat.ts`
- `frontend/src/components/ChatWidget.tsx`
- mount in `frontend/src/components/Layout.tsx` outside `<Outlet />`

Required states:

- empty,
- sending,
- tool executing,
- approval required,
- execution success,
- execution failure,
- AI unavailable fallback.

The widget should show action summaries and approval buttons only when the backend returns a pending action. It must not construct action payloads itself.

### AI inbox as approval console

Existing AI inbox UI/API should become the main human approval surface:

- list pending approvals by urgency,
- show AI reasoning summary, confidence, risk tier, and affected lead/campaign,
- approve/reject/snooze,
- show execution result after approval,
- show expired/auto-executed guarded items separately from manually approved items.

Frontend API calls must go through `frontend/src/api/client.ts`; no direct `fetch` or `axios` in components.

---

## 14. Implementation Plan

### Phase A: Shared agent action core

1. Add `backend/src/modules/agent/` with action catalog, policy gate, executor, schemas, types, and tests.
2. Add append-only migration for `agent_actions` or append-only columns linking `ai_inbox_items` to action payloads.
3. Add idempotency enforcement.
4. Add metrics and audit integration.

### Phase B: Upgrade AI inbox approval

1. Link inbox items to `agent_actions`.
2. Update `actionItem` so approve executes the linked action; reject cancels it; snooze preserves pending status.
3. Update guarded expiry sweep to execute only through policy + executor.
4. Cover approve/reject/snooze/expiry with tests.

### Phase C: Chat command plane

1. Add `chat` module with read tools first.
2. Add write proposal flow using shared action catalog.
3. Add Redis conversation history.
4. Add frontend chat widget.
5. Cover RBAC, malformed tool args, OpenAI failure, read execution, and write confirmation tests.

### Phase D: Event-driven autonomy hardening

1. Add `enqueueAiDecision`.
2. Route `lead.scored` and other qualifying events into `ai-decisions`.
3. Convert `events.worker.ts` next-best-action routing to produce typed agent actions.
4. Ensure skip/review actions create AI inbox items instead of log-only outcomes.
5. Add integration tests for supervised, guarded, and autopilot behavior.

---

## 15. Acceptance Criteria

Backend:

- All agent writes go through the typed action executor.
- No write action executes from chat without confirmation or policy approval.
- `viewer` can use read tools but cannot execute or approve writes.
- AI inbox approval executes a linked action exactly once.
- Guarded expiry cannot execute unsupported or stale actions.
- `opt_out` cancels outreach immediately and never waits for approval.
- OpenAI failure returns graceful fallback and logs a failed decision.
- Every executed write has `audit_logs` and `agent_actions` evidence.
- New agent/chat code meets the repository coverage gate.

Frontend:

- Chat widget is available on authenticated pages.
- Approval prompts are explicit and show affected entity/count.
- AI inbox exposes approve/reject/snooze and result states.
- Loading, error, empty, and unavailable states are implemented.

Operational:

- Queues use existing BullMQ retry/DLQ patterns.
- Metrics cover proposed, approved, rejected, executed, failed, and expired actions.
- Sentry captures worker/action executor failures.
- No secrets are sent to OpenAI or written to logs.

---

## 16. Security Considerations

- Prompt instructions are advisory only. Real enforcement is action schema validation, policy gate, RBAC, and service-layer checks.
- All tool arguments are validated with Zod before policy or execution.
- The LLM receives minimal context and never receives credentials or secrets.
- Approval links/actions require authenticated API calls; no email-token approval in v1.
- Idempotency keys prevent duplicate execution from retries, double clicks, and repeated confirmations.
- Existing security-critical middleware (`auth.ts`, `rbac.ts`) should not be edited for this feature without explicit security review.
- Append-only migrations only; do not modify existing migration files.

---

## 17. Open Decisions

1. Use a dedicated `agent_actions` table, or store action payload columns directly on `ai_inbox_items`? Recommendation: dedicated `agent_actions`.
2. Should guarded expiry auto-execute customer-facing drafts in v1, or only mark expired for review? Recommendation: no auto-send until linked executor and compliance tests are complete.
3. Which roles may approve customer-facing AI actions: assigned sales rep only, manager/admin, or campaign owner? Recommendation: assigned rep plus manager/admin.
4. Should chat confirmations create durable `agent_actions` immediately, or use Redis for low-risk short confirmations? Recommendation: durable for every write.
5. Should bulk actions be implemented as true bulk services or explicit per-item action batches? Recommendation: true bulk services for outreach/reassignment before enabling bulk autopilot.
