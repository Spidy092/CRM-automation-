# Phase 2 — AI Sales Operator / AI Growth Agent
**Prepared By:** Chethan Gowda
**Version:** 2.0 (Phase 2)
**Status:** In Progress — Sprint 5 scaffolding complete; Sprint 6 implementation and documentation in progress as of 2026-06-27
**Timeline:** 8 weeks (4 × 2-week sprints, Sprint 5–8)
**Follows:** Phase 1 (~85–90% complete as of 2026-06-26)

---

## Vision

Phase 1 built the automation backbone — messaging pipelines, lead ingestion, campaign dispatch, integrations.

**Phase 2 transforms the CRM into an AI Sales Operator.**

The system stops being a tool humans operate and becomes an agent humans supervise. The AI:
- researches every lead
- qualifies and scores with reasoning
- decides the next best action autonomously
- reads inbound replies and classifies intent
- drafts follow-ups and routes to reps only when human judgment is needed
- maintains a persistent memory per lead — objections, preferences, buying signals, conversation history
- thinks in events: every lead event (scraped, replied, clicked, bounced, stage-changed) triggers an AI reasoning step

Humans approve strategy, handle sensitive moments, and review AI-generated outputs before sending when the confidence threshold is below the configured minimum.

## Current Completion Status

**Overall Phase 2 Completion:** ~53% as of 2026-06-27

### Modules

| Module | Status | Completion | Notes |
|---|---|---|---|
| ai-intelligence | Partial | ~75% (9/12 files) | Controller, schema, and types tests missing |
| ai-reply | Missing | ~25% (3/12 files) | Controller, routes, schema, and all tests missing; service/repository/types exist |
| ai-campaign-brain | Partial | ~58% (7/12 files) | Controller, repository, schema, service, and types tests missing; routes test exists |
| ai-inbox | Complete | 100% | Full module + tests |
| ai-settings | Partial | ~58% (7/12 files) | Controller, repository, routes, schema, and types tests missing; service test exists |

### AI Workers

| Worker | Status | Notes |
|---|---|---|
| aiResearch | Complete | Worker + test exist |
| aiReply | Complete | Worker + test exist |
| aiCampaignBrain | Complete | Worker + test exist |
| aiInbox | Complete | Worker + test exist |
| aiDecision | Missing | Worker + test not yet created |

### Event Bus

- `ai.events.ts` — Complete
- `eventBus.ts` — Complete

### Documentation

- [x] `PHASE2_AUDIT.md`
- [ ] `docs/API.md` (next step)
- [ ] `AI_WORKERS_RUNBOOK.md` (Phase 6)
- [ ] `AI_DECISION_RUNBOOK.md` (Phase 6)

---

## Core Design Principles

### 1. AI Memory
Every lead has a persistent `lead_ai_profile` record that accumulates:
- business pain point inference
- inferred buying intent level
- objection log (what they said, when, classified type)
- preferred communication channel (learned from response pattern)
- AI-generated notes (summary of all interactions)
- do-not-say constraints (topics that caused negative responses)
- conversation summary updated after every inbound event

Memory is stored in PostgreSQL (structured fields + JSONB notes). Key fields are also mirrored to Redis for low-latency access during active outreach sequences.

### 2. AI Thinking (Chain-of-Thought Reasoning)
The AI does not make binary decisions. Every automated action is preceded by a structured reasoning step:
- What do I know about this lead?
- What just happened?
- What are the possible next actions?
- What is the best action and why?
- What is my confidence level?
- Should I proceed autonomously or request human approval?

This reasoning is logged to `ai_decision_log` with full chain-of-thought for audit and explainability.

### 3. Autonomous Operation (with Human-in-the-Loop Gates)
The system operates on three autonomy levels, configurable per campaign:

| Level | Name | Behavior |
|---|---|---|
| `supervised` | All AI actions require human approval before execution | Safe for high-value leads |
| `guarded` | AI acts autonomously below a confidence threshold; pauses above (for sensitive actions) | Default for most campaigns |
| `autopilot` | AI acts fully autonomously; humans review async summaries | For high-volume cold outreach |

Autonomy level is set at campaign creation and can be overridden per lead.

### 4. Event-Driven Architecture
Every meaningful lead event fires a domain event that the AI event bus consumes:

```
lead.scraped          → trigger: AI research agent
lead.imported         → trigger: AI research agent
lead.reply.received   → trigger: AI reply classifier
lead.stage.changed    → trigger: AI next-action engine
outreach.bounced      → trigger: AI channel-switch decision
outreach.opened       → trigger: update AI memory (engagement signal)
outreach.clicked      → trigger: AI next-action engine (hot signal)
campaign.launched     → trigger: AI campaign brain briefing
lead.score.updated    → trigger: re-evaluate next best action
```

Events flow through a Redis Streams bus (or BullMQ event queue). Each event type has a registered AI processor worker.

---

## New Modules — Phase 2

### `src/modules/ai-intelligence/`
**AI Lead Intelligence — Research, Profiling, Memory**

The brain of Phase 2. Manages `lead_ai_profiles`, runs enrichment reasoning, maintains conversation memory, and stores all AI decision logs.

**Key responsibilities:**
- On `lead.scraped` or `lead.imported`: run research agent, populate `lead_ai_profile`
- Maintain `ai_notes`, `objection_log`, `buying_signals`, `do_not_say` per lead
- Expose read API for other modules to query AI profile without direct DB access
- Store full chain-of-thought reasoning in `ai_decision_log`

**Database tables:**
- `lead_ai_profiles` — one per lead, structured intelligence record
- `ai_decision_log` — append-only audit trail of every AI reasoning step
- `lead_conversation_summaries` — rolling summary updated after every inbound event

**New workers:**
- `aiResearch.worker.ts` — processes `ai:research-lead` jobs
- `aiDecision.worker.ts` — processes `ai:next-action` jobs

---

### `src/modules/ai-reply/`
**AI Reply Classifier — Inbound Intent Detection + Auto-Response**

Reads every inbound message (WhatsApp, SMS, email) and classifies intent, updates lead memory, drafts a response, and decides whether to auto-send or escalate to a rep.

**Intent classification taxonomy:**

| Intent Class | Sub-type | Action |
|---|---|---|
| `interested` | `high`, `medium` | Draft response, move stage to `Engaged`, notify rep |
| `objection` | `price`, `timing`, `trust`, `competitor`, `not_relevant` | Log objection, draft rebuttal, request approval |
| `not_now` | `soft`, `hard` | Move to `Nurture`, schedule follow-up in 7/30 days |
| `meeting_request` | — | Create calendar task, notify rep immediately |
| `pricing_question` | — | Draft pricing info response, request approval |
| `wrong_contact` | — | Flag for review, pause sequence |
| `opt_out` | `angry`, `unsubscribe` | Immediate stop, add to suppression list, log |
| `neutral` | — | No action, update memory |

**Key responsibilities:**
- Classify inbound reply with confidence score
- Update `lead_ai_profiles.objection_log` and `buying_signals`
- Draft response using template + AI personalization
- Route to rep if confidence < threshold or intent is `meeting_request` / `opt_out`
- Auto-send draft if confidence ≥ threshold and campaign autonomy = `autopilot`

**New workers:**
- `aiReply.worker.ts` — processes `ai:classify-reply` jobs triggered by webhook ingest

---

### `src/modules/ai-campaign-brain/`
**AI Campaign Strategy Engine — Pre-Launch Intelligence Brief**

Before a campaign launches, the AI analyses the target segment and produces a structured brief: fit summary, best angle, risk warnings, expected objections, recommended sequence, template suggestions.

**Brief schema:**
```typescript
interface CampaignBrief {
  campaign_id: string;
  total_leads_evaluated: number;
  eligible_leads: number;
  high_fit_leads: number;
  segment_summary: string;          // "188 local service businesses, avg 3.8 stars, no booking CTA detected"
  recommended_offer_angle: string;  // "WhatsApp booking automation + missed lead recovery"
  expected_objections: string[];    // ["already have a website", "too expensive"]
  risk_warnings: string[];          // ["8 leads may be competitors", "12 leads recently churned from similar offer"]
  recommended_sequence: SequenceStep[];
  template_suggestions: TemplateSuggestion[];
  recommended_autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  confidence_score: number;         // 0–100
  generated_at: string;             // ISO 8601
}
```

The brief is displayed in the frontend campaign review page before the manager clicks "Launch."

**New workers:**
- `aiCampaignBrain.worker.ts` — processes `ai:generate-campaign-brief` jobs

---

### `src/modules/ai-inbox/`
**AI Sales Copilot Inbox — Priority Task Feed for Reps**

Replaces the raw leads list for sales reps with a curated, AI-prioritized action feed. Reps no longer open a lead and figure out what to do — the AI tells them exactly what needs human attention and why.

**Inbox item types:**

| Type | Example | Why it surfaces |
|---|---|---|
| `approve_response` | "Review AI draft for ABC Dental" | Confidence below threshold |
| `urgent_reply` | "Green Cafe asked for demo tomorrow" | Meeting request intent detected |
| `pricing_inquiry` | "3 leads asked about pricing" | Pricing question intent, needs rep angle |
| `campaign_review` | "Approve campaign brief for 312 restaurants" | Campaign pending launch approval |
| `lead_handoff` | "ABC Dental — ready for a sales call" | AI scored Hot + human handoff flag |
| `objection_review` | "2 objections logged — review AI rebuttal" | Objection in supervised mode |

Inbox items are:
- sorted by urgency score (computed by AI)
- grouped by type and campaign
- actionable inline (approve, reject, reassign, snooze)
- auto-resolved when action is taken elsewhere (e.g., rep sends direct message)

**API:** `GET /api/v1/ai-inbox` — returns paginated inbox items for the authenticated user

---

### `src/modules/ai-next-action/`
**AI Next Best Action Engine — Per-Lead Decision System**

Computes `next_best_action` for every lead continuously. This is not a scheduled batch — it re-evaluates on every qualifying event.

**Action taxonomy:**

| Action | Trigger Conditions |
|---|---|
| `send_whatsapp` | New lead, high fit, no prior outreach |
| `send_email` | WhatsApp undelivered or low engagement |
| `send_sms` | Email bounced, phone number available |
| `wait_and_followup` | No response, within configured wait window |
| `call` | Meeting requested or AI confidence very high |
| `move_to_nurture` | Soft objection or `not_now` response |
| `escalate_to_rep` | High buying signal, above confidence threshold |
| `request_human_approval` | Ambiguous intent, below confidence threshold |
| `disqualify` | Opt-out, wrong contact, or repeated no-response |
| `request_review` | AI uncertain — surfaces to inbox |

`next_best_action` is stored on the lead record and recalculated asynchronously. The outreach engine reads it before dispatching the next sequence step.

---

## New Database Tables (Phase 2 Migrations)

> All migrations append-only. Never edit existing migration files.

### Migration 017 — `lead_ai_profiles`
```sql
CREATE TABLE lead_ai_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_category VARCHAR(100),
  website_quality_score INTEGER CHECK (website_quality_score BETWEEN 0 AND 100),
  pain_points JSONB DEFAULT '[]',         -- string[]
  offer_angle TEXT,
  decision_maker_clues JSONB DEFAULT '[]',
  inferred_budget_range VARCHAR(50),
  reachability_score INTEGER CHECK (reachability_score BETWEEN 0 AND 100),
  buying_intent VARCHAR(20) CHECK (buying_intent IN ('high','medium','low','unknown')),
  buying_signals JSONB DEFAULT '[]',      -- { signal: string, detected_at: ISO }[]
  objection_log JSONB DEFAULT '[]',       -- { type: string, text: string, logged_at: ISO }[]
  do_not_say JSONB DEFAULT '[]',          -- string[]
  preferred_channel VARCHAR(20),          -- 'whatsapp' | 'email' | 'sms'
  preferred_time_of_day VARCHAR(20),      -- 'morning' | 'afternoon' | 'evening' | null
  conversation_summary TEXT,
  ai_notes TEXT,
  next_best_action VARCHAR(50),
  next_best_action_reason TEXT,
  next_best_action_confidence INTEGER CHECK (next_best_action_confidence BETWEEN 0 AND 100),
  enrichment_status VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'running' | 'done' | 'failed'
  last_enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id)
);

CREATE INDEX idx_lead_ai_profiles_lead_id ON lead_ai_profiles(lead_id);
CREATE INDEX idx_lead_ai_profiles_buying_intent ON lead_ai_profiles(buying_intent);
CREATE INDEX idx_lead_ai_profiles_next_best_action ON lead_ai_profiles(next_best_action);
```

### Migration 018 — `ai_decision_log`
```sql
CREATE TABLE ai_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  decision_type VARCHAR(50) NOT NULL,   -- 'research' | 'next_action' | 'reply_classify' | 'campaign_brief'
  input_context JSONB NOT NULL,
  chain_of_thought TEXT,                -- full reasoning trace
  decision VARCHAR(100) NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  tokens_used INTEGER,
  latency_ms INTEGER,
  model_used VARCHAR(50),
  autonomy_level VARCHAR(20),
  human_approval_required BOOLEAN DEFAULT FALSE,
  human_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  human_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_decision_log_lead_id ON ai_decision_log(lead_id);
CREATE INDEX idx_ai_decision_log_decision_type ON ai_decision_log(decision_type);
CREATE INDEX idx_ai_decision_log_created_at ON ai_decision_log(created_at DESC);
```

### Migration 019 — `lead_conversation_summaries`
```sql
CREATE TABLE lead_conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  last_interaction_at TIMESTAMPTZ,
  last_intent_class VARCHAR(50),
  interaction_count INTEGER DEFAULT 0,
  sentiment VARCHAR(20),               -- 'positive' | 'neutral' | 'negative'
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id)
);
```

### Migration 020 — `campaign_ai_briefs`
```sql
CREATE TABLE campaign_ai_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  total_leads_evaluated INTEGER,
  eligible_leads INTEGER,
  high_fit_leads INTEGER,
  segment_summary TEXT,
  recommended_offer_angle TEXT,
  expected_objections JSONB DEFAULT '[]',
  risk_warnings JSONB DEFAULT '[]',
  recommended_sequence JSONB DEFAULT '[]',
  template_suggestions JSONB DEFAULT '[]',
  recommended_autonomy_level VARCHAR(20),
  confidence_score INTEGER,
  status VARCHAR(20) DEFAULT 'draft',  -- 'draft' | 'approved' | 'rejected'
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id)
);
```

### Migration 021 — `ai_inbox_items`
```sql
CREATE TYPE ai_inbox_item_type AS ENUM (
  'approve_response', 'urgent_reply', 'pricing_inquiry',
  'campaign_review', 'lead_handoff', 'objection_review'
);

CREATE TYPE ai_inbox_item_status AS ENUM ('pending', 'actioned', 'snoozed', 'auto_resolved');

CREATE TABLE ai_inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_to UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  item_type ai_inbox_item_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT,
  urgency_score INTEGER CHECK (urgency_score BETWEEN 0 AND 100),
  ai_draft_response TEXT,
  ai_draft_confidence INTEGER,
  status ai_inbox_item_status DEFAULT 'pending',
  snoozed_until TIMESTAMPTZ,
  actioned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  actioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_inbox_items_assigned_to ON ai_inbox_items(assigned_to);
CREATE INDEX idx_ai_inbox_items_status ON ai_inbox_items(status);
CREATE INDEX idx_ai_inbox_items_urgency ON ai_inbox_items(urgency_score DESC);
```

### Migration 022 — `lead_ai_profiles` autonomy override column on campaigns
```sql
ALTER TABLE campaigns
  ADD COLUMN autonomy_level VARCHAR(20) DEFAULT 'guarded'
    CHECK (autonomy_level IN ('supervised', 'guarded', 'autopilot')),
  ADD COLUMN ai_min_confidence INTEGER DEFAULT 75
    CHECK (ai_min_confidence BETWEEN 0 AND 100);
```

---

## New BullMQ Workers (Phase 2)

| Worker File | Queue Name | Jobs Processed | Trigger |
|---|---|---|---|
| `aiResearch.worker.ts` | `ai-research` | `ai:research-lead` | `lead.scraped`, `lead.imported` |
| `aiReply.worker.ts` | `ai-reply` | `ai:classify-reply` | Inbound webhook events |
| `aiDecision.worker.ts` | `ai-decision` | `ai:next-action` | Stage change, score update, reply classified |
| `aiCampaignBrain.worker.ts` | `ai-campaign` | `ai:generate-campaign-brief` | Campaign pre-launch |
| `aiInbox.worker.ts` | `ai-inbox` | `ai:create-inbox-item` | Any AI decision requiring human review |

**All workers must follow existing BullMQ rules:**
- Typed `JobData` interface at top of file
- Winston logging with `job.id` and contextual metadata
- Exponential backoff: 3 retries, 2× delay increment
- DLQ routing via `moveToDLQ()` from `lib/dlq.ts`
- Prometheus counters: `crm_jobs_processed_total`, `crm_jobs_failed_total`, `crm_job_duration_seconds`
- `removeOnComplete: { count: 500 }`, `removeOnFail: { count: 200 }`

---

## New Domain Events (Phase 2 Event Bus)

Events fire from service layer, consumed by AI workers via BullMQ event queue.

```typescript
// src/shared/events/ai.events.ts

export type AIDomainEvent =
  | { type: 'lead.scraped';         payload: { lead_id: string } }
  | { type: 'lead.imported';        payload: { lead_id: string } }
  | { type: 'lead.reply.received';  payload: { lead_id: string; channel: string; message_id: string } }
  | { type: 'lead.stage.changed';   payload: { lead_id: string; from_stage: string; to_stage: string } }
  | { type: 'outreach.bounced';     payload: { lead_id: string; channel: string } }
  | { type: 'outreach.opened';      payload: { lead_id: string; campaign_id: string } }
  | { type: 'outreach.clicked';     payload: { lead_id: string; campaign_id: string; link: string } }
  | { type: 'campaign.pre_launch';  payload: { campaign_id: string } }
  | { type: 'lead.score.updated';   payload: { lead_id: string; new_score: number } }
```

Event dispatcher: `src/shared/events/eventBus.ts` — wraps BullMQ `Queue.add()` to the `ai-events` queue, which each AI worker subscribes to by event type.

---

## New Frontend Pages (Phase 2)

| Page | Route | Description |
|---|---|---|
| `AIInboxPage` | `/ai-inbox` | Copilot inbox — priority task feed for reps |
| `LeadAIProfilePage` | `/leads/:id/ai` | AI intelligence tab on lead detail |
| `CampaignBriefPage` | `/campaigns/:id/brief` | AI brief review before campaign launch |
| `AIDecisionLogPage` | `/admin/ai-decisions` | Audit trail of all AI reasoning steps |
| `AISettingsPage` (extend) | `/settings/ai` | Autonomy level defaults, confidence thresholds, model config |

---

## AI Architecture Rules (Phase 2 — Mandatory)

These extend the existing Absolute Rules and apply to all Phase 2 AI modules.

### Memory Rules
- `lead_ai_profiles` is the single source of truth for AI knowledge about a lead — never duplicate AI state in application memory or Redis.
- Redis may cache hot fields (`next_best_action`, `buying_intent`) with a 1-hour TTL but the DB record is authoritative.
- Memory updates are append-safe: `buying_signals`, `objection_log`, `do_not_say` are always appended to, never overwritten.
- Conversation summaries are regenerated (not appended) using the full interaction history — keep summaries under 500 tokens.

### Thinking / Reasoning Rules
- Every AI decision must produce a `chain_of_thought` string that is logged to `ai_decision_log`.
- Chain-of-thought must be structured: Context → Options → Reasoning → Decision → Confidence.
- AI workers must never make decisions with confidence < 30 — route to `request_review` instead.
- Confidence threshold for autonomous action defaults to 75; configurable per campaign via `ai_min_confidence`.
- All reasoning must reference specific data from the lead profile — never generic reasoning.

### Autonomous Operation Rules
- AI may send outbound messages autonomously only when: (a) campaign `autonomy_level = 'autopilot'` AND (b) decision confidence ≥ `ai_min_confidence`.
- In `guarded` mode: AI drafts the message and creates an `approve_response` inbox item. Message sends after approval or after configured timeout (default: 4 hours) if no action is taken.
- In `supervised` mode: AI drafts and creates inbox item. Message sends ONLY after explicit human approval — no timeout auto-send.
- Opt-out and angry replies (`intent_class = 'opt_out'`) must ALWAYS stop the sequence immediately, regardless of autonomy level — no AI override.
- AI must never send more than one unsolicited message per 24-hour window per lead — enforced at worker level.

### Event-Driven Rules
- AI workers must be purely event-reactive — never poll the database for leads to process.
- Every domain event must be idempotent — processing the same event twice must not create duplicate actions.
- Event payloads must carry only IDs — workers fetch full context from the DB, never trust payload data.
- All events must be logged with timestamp, event type, and payload to `ai_decision_log`.

### OpenAI / LLM Rules (extending existing rules)
- All AI reasoning calls use the model configured in `ai_settings` — default `gpt-4o`.
- Research and chain-of-thought calls: `max_tokens = 800`.
- Reply draft calls: `max_tokens = 300` (concise drafts only).
- Campaign brief calls: `max_tokens = 1200`.
- System prompt for all AI workers must include: current date, lead data, conversation history, campaign context.
- Never pass credit card data, bank details, or passwords to OpenAI — ever.
- Cache AI research profiles per `lead_id` in Redis for 24 hours; invalidate on new inbound message or stage change.
- Every OpenAI call logs: `lead_id`, `campaign_id`, `decision_type`, `tokens_used`, `latency_ms`, `cache_hit`, `model_used`.

### Human-in-the-Loop Rules
- Every AI-created inbox item must have an expiry: `approve_response` → 4h, `campaign_review` → 24h, `urgent_reply` → 1h.
- When an inbox item expires in `guarded` mode, execute the AI recommendation automatically and log `human_approval_required: false`.
- When an inbox item expires in `supervised` mode, escalate urgency and notify the manager — do not auto-execute.
- Reps can always override any AI decision from the lead detail page — override is logged to `ai_decision_log`.
- Manager can globally pause all AI autonomous actions per campaign at any time.

---

## Sprint Plan — Phase 2

### Sprint 5 — Weeks 9–10: AI Foundation + Memory
**Theme:** AI Lead Intelligence, Memory Layer, Event Bus

**Goal:** Every new or imported lead automatically gets an AI profile with pain point analysis, offer angle, and next best action. AI memory persists across all interactions.

**Deliverables:**
1. `src/modules/ai-intelligence/` — full module (controller, service, repository, routes, schema, types)
2. Migrations 017–019 (`lead_ai_profiles`, `ai_decision_log`, `lead_conversation_summaries`)
3. `src/workers/aiResearch.worker.ts` — researches lead on `lead.scraped` / `lead.imported`
4. `src/workers/aiDecision.worker.ts` — computes `next_best_action` on qualifying events
5. `src/shared/events/eventBus.ts` — domain event dispatcher
6. `src/shared/events/ai.events.ts` — typed event definitions
7. Lead detail page AI tab — `LeadAIProfilePage` — shows profile, next action, AI notes
8. Unit tests: `ai-intelligence` module ≥70%, `aiResearch.worker` success + failure paths
9. Extend `outreach` module to read `next_best_action` from `lead_ai_profiles` before dispatching next sequence step

**Technical constraints:**
- Research worker must complete within 30 seconds per lead (OpenAI timeout: 25s)
- Cache research profile in Redis 24h; invalidate on new inbound event
- `next_best_action` recomputed within 5 seconds of qualifying event via `aiDecision.worker`

**Success criteria:**
- Import 10 test leads → all have populated `lead_ai_profiles` within 60 seconds
- `next_best_action` updates correctly when a lead changes stage
- AI decision log populated for every reasoning step

---

### Sprint 6 — Weeks 11–12: AI Reply Handler + Campaign Brain
**Theme:** Inbound Intelligence, Campaign Strategy

**Goal:** Every inbound reply is classified, memory is updated, a draft response is generated, and it routes to the rep inbox or auto-sends based on confidence + autonomy level. Campaign launch includes an AI brief.

**Deliverables:**
1. `src/modules/ai-reply/` — full module (intent classifier, draft generator, memory updater)
2. `src/modules/ai-campaign-brain/` — brief generator module
3. Migrations 020–021 (`campaign_ai_briefs`, `ai_inbox_items`)
4. `src/workers/aiReply.worker.ts` — triggered on inbound webhook events
5. `src/workers/aiCampaignBrain.worker.ts` — triggered on `campaign.pre_launch`
6. `src/workers/aiInbox.worker.ts` — creates inbox items from AI decision outputs
7. Extend inbound webhook handlers (WhatsApp, Twilio, SendGrid) to emit `lead.reply.received` domain events
8. `CampaignBriefPage` — frontend review page shown before campaign launch
9. Campaign launch flow updated: brief must be generated and approved before `ACTIVE` status
10. Unit tests: all new workers, intent classifier logic, brief generator
11. Integration tests: full inbound reply flow (webhook → classify → draft → inbox item)

**Technical constraints:**
- Reply classification must complete within 10 seconds (user expects fast ACK on inbound)
- Campaign brief generation: up to 120 seconds (async, user waits on review page with progress indicator)
- Opt-out detection must be synchronous and immediate — no async gap

**Success criteria:**
- Send a test inbound WhatsApp reply → classify correctly within 10s → inbox item appears for rep
- Pre-launch a campaign → brief appears → manager approves → campaign moves to `ACTIVE`
- Opt-out reply immediately stops outreach sequence

---

### Sprint 7 — Weeks 13–14: AI Sales Copilot Inbox + Autonomy Engine
**Theme:** Rep Experience, Autonomous Operation

**Goal:** Reps replace the raw lead list with the AI inbox. Campaigns can operate in autopilot mode with full autonomous messaging within policy.

**Deliverables:**
1. `src/modules/ai-inbox/` — inbox module (API, pagination, action handlers)
2. `AIInboxPage` — frontend inbox with grouped, sortable, actionable items
3. Autonomy engine: per-campaign `autonomy_level` + `ai_min_confidence` settings (Migration 022)
4. Inbox item expiry + auto-execution logic for `guarded` mode
5. Supervisor escalation logic for `supervised` mode on expiry
6. Rep override UI — any AI decision on lead detail can be overridden and logged
7. Manager campaign pause/resume AI autonomous actions button
8. `AIDecisionLogPage` — admin audit trail with chain-of-thought viewer
9. Notification system: push notifications (or email digest) for urgent inbox items
10. Unit + integration tests: inbox CRUD, expiry engine, autonomy mode switching

**Technical constraints:**
- Inbox API `GET /api/v1/ai-inbox` must respond in <200ms (uses pre-computed urgency scores)
- Urgency score recalculated async on every inbox item state change
- Autopilot sends must be rate-limited: max 1 unsolicited message per lead per 24h

**Success criteria:**
- Rep logs in → sees AI inbox sorted by urgency, zero raw lead confusion
- Campaign in `autopilot` mode processes 50 leads, sends outreach, updates stages — without rep touching anything
- Rep can override any AI action and the override is logged with reason

---

### Sprint 8 — Weeks 15–16: Polish, Coverage, Production Hardening
**Theme:** Test coverage, observability, UAT, Phase 2 production deploy

**Goal:** All Phase 2 modules pass 70% coverage. AI system is observable, auditable, and production-ready.

**Deliverables:**
1. Coverage push: all Phase 2 modules ≥70% statements, branches, functions, lines
2. `ai-intelligence` and `ai-reply` modules: ≥80% coverage (higher risk)
3. Sentry integration for all AI workers — capture OpenAI API errors, timeout events, decision failures
4. Prometheus metrics for AI workers:
   - `crm_ai_research_total`, `crm_ai_research_duration_seconds`
   - `crm_ai_reply_classified_total{intent_class}` — per intent class counter
   - `crm_ai_decisions_total{decision_type,autonomy_level}`
   - `crm_ai_inbox_items_total{item_type,status}`
5. Grafana dashboard for AI operations: decision throughput, classification accuracy, inbox resolution rate, autonomy level distribution
6. Load test: 500 leads imported simultaneously → all AI profiles populated within 5 minutes
7. End-to-end UAT: full lead lifecycle from scrape → AI profile → campaign → inbound reply → inbox → rep action
8. Update `docker-compose.prod.yml` for new AI workers
9. Update CI pipeline to include AI module tests
10. `AISettingsPage` — full settings UI: model selection, autonomy defaults, confidence thresholds, cost tracking

**Success criteria:**
- Phase 2 overall backend coverage ≥70%
- Full E2E test passes in staging environment
- AI inbox resolution rate measurable in Grafana
- Zero AI autonomous actions beyond configured policy in any test scenario

---

## Phase 2 Progress Tracker (updated 2026-06-26)

| Sprint | Weeks | Theme | Status | Notes |
|---|---|---|---|---|
| Sprint 5 | Week 9–10 | AI Foundation + Memory | 🟡 ~30% scaffolded | Migrations 017–022 done. 4 AI modules scaffolded (ai-intelligence, ai-reply, ai-campaign-brain, ai-inbox). 4 AI workers + events.worker.ts created. `src/shared/events/` NOT yet created (eventBus.ts missing). No frontend Phase 2 pages. No aiDecision.worker.ts. |
| Sprint 6 | Week 11–12 | AI Reply + Campaign Brain | 🔴 Not started | ai-reply and ai-campaign-brain modules have repo+service+types but no controller/routes/schema, no tests |
| Sprint 7 | Week 13–14 | AI Copilot Inbox + Autonomy | 🔴 Not started | ai-inbox has full module structure (6 files) but zero tests. No autonomy engine logic. |
| Sprint 8 | Week 15–16 | Polish + Coverage + Prod | 🔴 Not started | |

---

## Phase 2 New Folders

```
src/modules/ai-intelligence/     — Lead research, memory, AI profiles, decision log
src/modules/ai-reply/            — Inbound reply classification, draft generation
src/modules/ai-campaign-brain/   — Campaign pre-launch strategy brief
src/modules/ai-inbox/            — Copilot inbox for reps
src/modules/ai-next-action/      — Next best action engine (can be part of ai-intelligence)
src/workers/aiResearch.worker.ts
src/workers/aiReply.worker.ts
src/workers/aiDecision.worker.ts
src/workers/aiCampaignBrain.worker.ts
src/workers/aiInbox.worker.ts
src/shared/events/eventBus.ts
src/shared/events/ai.events.ts
migrations/017_lead_ai_profiles.sql
migrations/018_ai_decision_log.sql
migrations/019_lead_conversation_summaries.sql
migrations/020_campaign_ai_briefs.sql
migrations/021_ai_inbox_items.sql
migrations/022_campaign_autonomy_columns.sql
```

---

## Phase 2 Additional Stack

| Addition | Purpose | Justification |
|---|---|---|
| `openai` SDK (already installed) | AI reasoning, classification, drafting | Already in Phase 1 AI settings |
| Redis Streams or BullMQ event queue | Domain event bus | Already have BullMQ; extend for events |
| `zod` (already installed) | AI output schema validation | Force-validate all OpenAI responses |
| `node-cron` or BullMQ repeatable jobs | Inbox item expiry ticker | Lightweight cron for expiry checks |

No new major dependencies required. Phase 2 is built on Phase 1 infrastructure.

---

## Autonomy Configuration Reference

```typescript
// Per campaign, stored in campaigns table (Migration 022)
interface CampaignAIConfig {
  autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  ai_min_confidence: number;     // 0–100, default 75
}

// Global defaults in ai_settings table (Phase 1 — extend)
interface GlobalAISettings {
  default_autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  default_min_confidence: number;
  research_model: string;          // e.g. 'gpt-4o'
  reply_model: string;
  campaign_brief_model: string;
  max_ai_sends_per_lead_per_day: number;  // default 1
  inbox_item_expiry_guarded_hours: number;  // default 4
}
```

---

*Document prepared: 2026-06-25 | Phase 2 planning session with Chethan Gowda*
*This document is the authoritative spec for Phase 2 implementation. All agents must read this before implementing any Phase 2 module.*
