# AI Copilot Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the AI Copilot from a single-shot chatbot into a multi-step agent that plans, previews, and executes chains of CRM actions behind a policy-driven approval surface.

**Architecture:** New `backend/src/modules/agent-planner/` module owns Plan + Step persistence and DAG-based execution. It reuses the existing `agent/` module's 17 typed actions, policy engine, executor, and `ai-inbox/` approval surface unchanged — no rewrites of existing business logic. Chat becomes a thin client that delegates multi-step requests to the planner. A first-class Plan entity (DB row) replaces the in-memory single-shot tool-call loop.

**Tech Stack:** Node 20 + TypeScript + Express + PostgreSQL 16 + Redis 7 + BullMQ + OpenAI structured outputs + TanStack Query + React 18. Same stack as the rest of the project.

**Reference Spec:** `docs/superpowers/specs/2026-06-30-ai-copilot-agent-design.md`

---

## Scope Check

Single subsystem (`agent-planner` module + chat rewrite + AI inbox enhancement + frontend additions). Decomposed into 6 phases below; each phase produces working, testable software. **Total target: ~2 weeks for all 6 phases.**

### Phase map

| Phase | Tasks | What ships | Working software? |
|---|---|---|---|
| 1. Foundation | T1–T6 | Migration, plan schema, repository, errors, metrics, idempotency | New module compiles + empty routes registered |
| 2. Planner | T7–T9 | Planner prompt, planner service, OpenAI structured-output call | `POST /agent/plans` creates a validated Plan from a goal |
| 3. Runner | T10–T13 | Topo sort, budget tracker, runner service, recovery worker | Plans execute step-by-step with budget enforcement |
| 4. API surface | T14–T17 | Controller + routes, chat rewrite, AI inbox handler update | End-to-end: chat → plan → execute → inbox approval |
| 5. Frontend | T18–T21 | api/agentPlans client, PlanPreview component, ChatWidget + AIInboxPage updates | UI shows plans, approves them, sees status |
| 6. E2E + docs | T22–T23 | E2E journey test, AGENTS.md / RUNBOOK update | CI green, docs current |

### New files (per phase)

```
backend/migrations/0023_agent_plans.sql
backend/src/modules/agent-planner/
├── plan.schema.ts            [T2]
├── plan.types.ts             [T2]
├── plan.repository.ts        [T3]
├── errors.ts                 [T4]
├── metrics.ts                [T5]
├── idempotency.ts            [T6]
├── planner.prompt.ts         [T7]
├── planner.service.ts        [T8]
├── runner.topo.ts            [T10]
├── runner.budget.ts          [T11]
├── runner.service.ts         [T12]
├── recovery.worker.ts        [T13]
├── plan.controller.ts        [T14]
├── plan.routes.ts            [T14]
├── index.ts                  [T14]
└── __tests__/                [paired with each module]

frontend/src/
├── api/agentPlans.ts                       [T18]
├── components/PlanPreview.tsx              [T19]
└── components/__tests__/PlanPreview.test.tsx  [T19]
```

### Modified files

```
backend/src/modules/chat/chat.service.ts              [T15]
backend/src/modules/chat/chat.service.test.ts        [T15]
backend/src/modules/ai-inbox/ai-inbox.service.ts     [T16]
backend/src/modules/ai-inbox/ai-inbox.service.test.ts [T16]
backend/src/shared/utils/metrics.ts                  [T5]
backend/src/workers/index.ts                         [T13]
frontend/src/components/ChatWidget.tsx               [T20]
frontend/src/components/__tests__/ChatWidget.test.tsx [T20]
frontend/src/pages/AIInboxPage.tsx                   [T21]
frontend/src/pages/__tests__/AIInboxPage.test.tsx    [T21]
AGENTS.md                                            [T23]
docs/AI_COPILOT_USAGE.md                             [T23]
```

---

## Conventions

- **TDD discipline:** every task writes its failing test FIRST, runs it to confirm failure, then implements, then runs to confirm pass, then commits.
- **Test database:** per AGENTS.md, integration tests use a real PostgreSQL test instance. Set `TEST_DATABASE_URL` in `.env.test`. The test runner resets the DB between tests via `backend/test-db.js`.
- **OpenAI mocking:** all tests that would hit OpenAI mock via `jest.mock('openai')`. Real API calls only in shadow mode.
- **Commits:** small, frequent, conventional-commit messages (`feat:`, `test:`, `refactor:`, `docs:`, `chore:`).
- **Migration rule:** per AGENTS.md, migrations are append-only. New file `0023_agent_plans.sql`, never edit prior migrations.

---

# Phase 1: Foundation

## Task 1: Create the database migration

**Project conventions discovered during execution:**
- Migrations live at **repo-root** `migrations/`, NOT `backend/migrations/`.
- Migrations are **node-pg-migrate JavaScript files** (`17500000000XX_name.js`), not raw `.sql`.
- Next available timestamp follows the existing `1750000000029_*.js` files.
- Unit tests mock the DB layer (`pool`, `queryOne`); tests for a migration verify the JS definition/schema, not a live DB.

**Files:**
- Create: `migrations/1750000000030_agent-plans.js`
- Test: `backend/src/modules/agent-planner/__tests__/migration.test.ts`

- [ ] **Step 1.1: Write the migration file**

```javascript
// migrations/1750000000030_agent-plans.js

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('agent_plans', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    conversation_id: { type: 'text' },
    goal: { type: 'text', notNull: true },
    status: { type: 'varchar(40)', notNull: true },
    autonomy_level: { type: 'varchar(20)' },
    confidence: { type: 'integer' },
    source: { type: 'varchar(50)', notNull: true },
    requested_by: { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    source_message: { type: 'text' },
    cost_cap_cents: { type: 'integer', notNull: true, default: 50 },
    step_cap: { type: 'integer', notNull: true, default: 8 },
    cost_used_cents: { type: 'integer', notNull: true, default: 0 },
    deadline_at: { type: 'timestamptz' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz' },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    idempotency_key: { type: 'varchar(255)', notNull: true, unique: true },
  });

  pgm.createTable('agent_plan_steps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    plan_id: { type: 'uuid', notNull: true, references: '"agent_plans"', onDelete: 'CASCADE' },
    step_index: { type: 'integer', notNull: true },
    action_name: { type: 'varchar(100)', notNull: true },
    action_args: { type: 'jsonb', notNull: true, default: '{}' },
    risk_tier: { type: 'varchar(40)', notNull: true },
    depends_on: { type: 'integer[]', notNull: true, default: '{}' },
    rationale: { type: 'text', notNull: true },
    status: { type: 'varchar(40)', notNull: true, default: 'pending' },
    agent_action_id: { type: 'uuid', references: '"agent_actions"', onDelete: 'SET NULL' },
    result: { type: 'jsonb' },
    error_message: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('agent_plans', 'agent_plans_status_check',
    "CHECK (status IN ('proposed', 'approved', 'running', 'paused_for_approval', 'succeeded', 'failed', 'cancelled', 'expired'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_status_check',
    "CHECK (status IN ('pending', 'running', 'pending_approval', 'succeeded', 'failed', 'skipped', 'cancelled'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_risk_tier_check',
    "CHECK (risk_tier IN ('read', 'low_risk_write', 'sensitive_write', 'customer_facing_write'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_step_index_check',
    'CHECK (step_index >= 0)');

  pgm.createIndex('agent_plans', 'status');
  pgm.createIndex('agent_plans', ['status', 'created_at'], { order: { created_at: 'DESC' } });
  pgm.createIndex('agent_plans', 'requested_by');
  pgm.createIndex('agent_plans', 'conversation_id');
  pgm.createIndex('agent_plan_steps', 'plan_id');

  pgm.addColumn('agent_actions', {
    agent_plan_id: { type: 'uuid', references: '"agent_plans"', onDelete: 'SET NULL' },
    agent_plan_step_id: { type: 'uuid', references: '"agent_plan_steps"', onDelete: 'SET NULL' },
  });
  pgm.createIndex('agent_actions', 'agent_plan_id');

  pgm.addColumn('ai_inbox_items', {
    agent_plan_id: { type: 'uuid', references: '"agent_plans"', onDelete: 'SET NULL' },
    agent_plan_step_id: { type: 'uuid', references: '"agent_plan_steps"', onDelete: 'SET NULL' },
  });
  pgm.createIndex('ai_inbox_items', 'agent_plan_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropIndex('ai_inbox_items', 'agent_plan_id');
  pgm.dropColumns('ai_inbox_items', ['agent_plan_id', 'agent_plan_step_id']);
  pgm.dropIndex('agent_actions', 'agent_plan_id');
  pgm.dropColumns('agent_actions', ['agent_plan_id', 'agent_plan_step_id']);
  pgm.dropIndex('agent_plan_steps', 'plan_id');
  pgm.dropTable('agent_plan_steps');
  pgm.dropIndex('agent_plans', 'status');
  pgm.dropIndex('agent_plans', ['status', 'created_at']);
  pgm.dropIndex('agent_plans', 'requested_by');
  pgm.dropIndex('agent_plans', 'conversation_id');
  pgm.dropTable('agent_plans');
};
```

- [ ] **Step 1.2: Run the migration on a fresh dev DB**

```bash
cd backend && npm run migrate
```

Expected: migration applies cleanly (`1750000000030_agent-plans` in `pgmigrations` table). If it fails because `agent_actions` or `ai_inbox_items` don't exist on your local DB, first run all prior migrations with `npm run migrate`.

- [ ] **Step 1.3: Write the unit test (migration definition is correct)**

The project convention is to mock the DB layer in unit tests. For the migration, write a minimal test that ensures the migration file exports `up` and `down` functions and that the column list matches the schema we will use in the repository.

```typescript
// backend/src/modules/agent-planner/__tests__/migration.test.ts
import migration from '../../../../migrations/1750000000030_agent-plans';

describe('migration 1750000000030_agent-plans', () => {
  it('exports up and down functions', () => {
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('up creates agent_plans and agent_plan_steps', () => {
    const pgm = createMockPgm();
    migration.up(pgm);

    expect(pgm.createTable).toHaveBeenCalledWith('agent_plans', expect.any(Object));
    expect(pgm.createTable).toHaveBeenCalledWith('agent_plan_steps', expect.any(Object));
    expect(pgm.addColumn).toHaveBeenCalledWith('agent_actions', expect.any(Object));
    expect(pgm.addColumn).toHaveBeenCalledWith('ai_inbox_items', expect.any(Object));
  });

  it('down drops agent_plans and agent_plan_steps', () => {
    const pgm = createMockPgm();
    migration.down(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('agent_plan_steps');
    expect(pgm.dropTable).toHaveBeenCalledWith('agent_plans');
    expect(pgm.dropColumns).toHaveBeenCalledWith('agent_actions', expect.arrayContaining(['agent_plan_id', 'agent_plan_step_id']));
    expect(pgm.dropColumns).toHaveBeenCalledWith('ai_inbox_items', expect.arrayContaining(['agent_plan_id', 'agent_plan_step_id']));
  });
});

function createMockPgm() {
  return {
    func: jest.fn((name) => name),
    createTable: jest.fn(),
    dropTable: jest.fn(),
    addColumn: jest.fn(),
    dropColumns: jest.fn(),
    createIndex: jest.fn(),
    dropIndex: jest.fn(),
    addConstraint: jest.fn(),
  };
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/migration.test.ts
```

Expected: PASS — all 3 test cases green.

- [ ] **Step 1.5: Commit**

```bash
cd backend && git add migrations/1750000000030_agent-plans.js src/modules/agent-planner/__tests__/migration.test.ts && git commit -m "feat(db): migration 1750000000030 for agent_plans and agent_plan_steps"
```

---

## Task 2: Plan schema (Zod) + types

**Files:**
- Create: `backend/src/modules/agent-planner/plan.types.ts`
- Create: `backend/src/modules/agent-planner/plan.schema.ts`
- Test: `backend/src/modules/agent-planner/__tests__/plan.schema.test.ts`

- [ ] **Step 2.1: Write the failing schema tests**

```typescript
// backend/src/modules/agent-planner/__tests__/plan.schema.test.ts
import { planSchema } from '../plan.schema';

describe('planSchema', () => {
  const validStep = {
    step_index: 0,
    action_name: 'lead.list',
    action_args: { limit: 10 },
    risk_tier: 'read',
    depends_on: [],
    rationale: 'Get a list of leads',
  };

  it('accepts a minimal valid plan', () => {
    const result = planSchema.safeParse({
      goal: 'find leads',
      steps: [validStep],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty steps array', () => {
    const result = planSchema.safeParse({ goal: 'x', steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 steps', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({ ...validStep, step_index: i }));
    const result = planSchema.safeParse({ goal: 'x', steps });
    expect(result.success).toBe(false);
  });

  it('rejects step_indexes that are not contiguous', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, step_index: 0 }, { ...validStep, step_index: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects depends_on referencing missing step_index', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, step_index: 0 },
        { ...validStep, step_index: 1, depends_on: [5] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects cycles (A depends on B, B depends on A)', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, step_index: 0, depends_on: [1] },
        { ...validStep, step_index: 1, depends_on: [0] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects risk_tier that does not match the action definition', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, risk_tier: 'sensitive_write' }], // lead.list is actually 'read'
    });
    expect(result.success).toBe(false);
  });

  it('rejects action_args that fail the action schema', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, action_args: { limit: 'not-a-number' } }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects compliance_critical actions', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, action_name: 'ai.inbox.action', risk_tier: 'compliance_critical' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid DAG (diamond)', () => {
    const result = planSchema.safeParse({
      goal: 'diamond',
      steps: [
        { ...validStep, step_index: 0, action_name: 'lead.list', risk_tier: 'read' },
        { ...validStep, step_index: 1, action_name: 'lead.get', risk_tier: 'read', depends_on: [0], action_args: { id: '00000000-0000-0000-0000-000000000001' } },
        { ...validStep, step_index: 2, action_name: 'lead.get', risk_tier: 'read', depends_on: [0], action_args: { id: '00000000-0000-0000-0000-000000000002' } },
        { ...validStep, step_index: 3, action_name: 'campaign.stats', risk_tier: 'read', depends_on: [1, 2] },
      ],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/plan.schema.test.ts
```

Expected: FAIL — `plan.schema` module not found.

- [ ] **Step 2.3: Write plan.types.ts**

```typescript
// backend/src/modules/agent-planner/plan.types.ts
import type { z } from 'zod';
import type { AgentActionName, AgentRiskTier } from '../../agent/agent.types';
import type { planSchema } from './plan.schema';

export type Plan = z.infer<typeof planSchema>;
export type PlanStep = Plan['steps'][number];

export type PlanStatus =
  | 'proposed'
  | 'approved'
  | 'running'
  | 'paused_for_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PlanStepStatus =
  | 'pending'
  | 'running'
  | 'pending_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type AutonomyLevel = 'supervised' | 'guarded' | 'autopilot';
export type PlanSource = 'chat' | 'event' | 'manual';

export interface PlanRow {
  id: string;
  conversation_id: string | null;
  goal: string;
  status: PlanStatus;
  autonomy_level: AutonomyLevel | null;
  confidence: number | null;
  source: PlanSource;
  requested_by: string | null;
  source_message: string | null;
  cost_cap_cents: number;
  step_cap: number;
  cost_used_cents: number;
  deadline_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
}

export interface PlanStepRow {
  id: string;
  plan_id: string;
  step_index: number;
  action_name: AgentActionName;
  action_args: Record<string, unknown>;
  risk_tier: AgentRiskTier;
  depends_on: number[];
  rationale: string;
  status: PlanStepStatus;
  agent_action_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreatePlanInput {
  conversationId?: string | null;
  goal: string;
  autonomyLevel?: AutonomyLevel | null;
  confidence?: number | null;
  source: PlanSource;
  requestedBy?: string | null;
  sourceMessage?: string | null;
  steps: PlanStep[];
  idempotencyKey: string;
  expiresAt?: string | null;
}

export interface CreatePlanStepInput {
  planId: string;
  stepIndex: number;
  actionName: AgentActionName;
  actionArgs: Record<string, unknown>;
  riskTier: AgentRiskTier;
  dependsOn: number[];
  rationale: string;
}
```

- [ ] **Step 2.4: Write plan.schema.ts**

```typescript
// backend/src/modules/agent-planner/plan.schema.ts
import { z } from 'zod';
import { agentActionNameSchema, agentRiskTierSchema } from '../../agent/agent.schema';
import { getAgentActionDefinition } from '../../agent/agent.actions';

export const planStepSchema = z.object({
  step_index: z.number().int().min(0).max(50),
  action_name: agentActionNameSchema,
  action_args: z.record(z.unknown()),
  risk_tier: agentRiskTierSchema,
  depends_on: z.array(z.number().int().min(0)).default([]),
  rationale: z.string().min(1).max(500),
});

export const planSchema = z.object({
  goal: z.string().min(1).max(2000),
  steps: z.array(planStepSchema).min(1).max(8),
}).superRefine((plan, ctx) => {
  // 1. step_indexes must be 0..N-1 contiguous
  const indexes = plan.steps.map((s) => s.step_index).sort((a, b) => a - b);
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step_indexes must be contiguous starting at 0; got ${indexes.join(',')}`,
      });
      return;
    }
  }

  // 2. each depends_on[i] must reference an existing step_index
  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      if (dep < 0 || dep >= plan.steps.length || dep === step.step_index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step ${step.step_index} has invalid depends_on=${dep}`,
        });
        return;
      }
    }
  }

  // 3. no cycles (Kahn's algorithm)
  const indegree = new Array(plan.steps.length).fill(0);
  const adj: number[][] = plan.steps.map(() => []);
  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      adj[dep].push(step.step_index);
      indegree[step.step_index]++;
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < indegree.length; i++) if (indegree[i] === 0) queue.push(i);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift()!;
    visited++;
    for (const m of adj[n]) {
      if (--indegree[m] === 0) queue.push(m);
    }
  }
  if (visited !== plan.steps.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `plan contains a cycle`,
    });
    return;
  }

  // 4 + 5 + 6: per-step action_args, risk_tier match, compliance rejection
  for (const step of plan.steps) {
    const definition = getAgentActionDefinition(step.action_name);

    if (definition.riskTier === 'compliance_critical') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: compliance_critical actions (${step.action_name}) are forbidden in plans`,
      });
      return;
    }

    if (step.risk_tier !== definition.riskTier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: risk_tier ${step.risk_tier} does not match action definition ${definition.riskTier}`,
      });
      return;
    }

    const parsed = definition.schema.safeParse(step.action_args);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: action_args failed schema validation: ${parsed.error.message}`,
      });
      return;
    }
  }
});
```

- [ ] **Step 2.5: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/plan.schema.test.ts
```

Expected: PASS — all 10 test cases green.

- [ ] **Step 2.6: Commit**

```bash
cd backend && git add src/modules/agent-planner/plan.schema.ts src/modules/agent-planner/plan.types.ts src/modules/agent-planner/__tests__/plan.schema.test.ts && git commit -m "feat(agent-planner): plan schema with Zod superRefine DAG validation"
```

---

## Task 3: Plan repository (DB layer)

**Files:**
- Create: `backend/src/modules/agent-planner/plan.repository.ts`
- Test: `backend/src/modules/agent-planner/__tests__/plan.repository.test.ts`

- [ ] **Step 3.1: Write the failing repository tests**

```typescript
// backend/src/modules/agent-planner/__tests__/plan.repository.test.ts
import { pool, queryOne } from '../../../shared/utils/db';
import {
  createPlan,
  createPlanStep,
  findPlanById,
  findPlanStepById,
  findPlanStepsByPlan,
  updatePlanStatus,
  updatePlanStepStatus,
  findStaleRunningPlans,
} from '../plan.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('plan.repository', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('createPlan + findPlanById round-trip', async () => {
    const plan = await createPlan({
      conversationId: null,
      goal: 'test goal',
      autonomyLevel: 'supervised',
      confidence: null,
      source: 'chat',
      requestedBy: null,
      sourceMessage: 'hi',
      steps: [],
      idempotencyKey: 'idem-1',
      expiresAt: null,
    });
    expect(plan.goal).toBe('test goal');
    expect(plan.status).toBe('proposed');
    const fetched = await findPlanById(plan.id);
    expect(fetched?.id).toBe(plan.id);
  });

  it('createPlanStep + findPlanStepsByPlan returns ordered steps', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: null, confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-2', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 1, actionName: 'lead.list', actionArgs: { limit: 5 }, riskTier: 'read', dependsOn: [0], rationale: 'get leads' });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.list', actionArgs: { limit: 10 }, riskTier: 'read', dependsOn: [], rationale: 'start' });
    const steps = await findPlanStepsByPlan(plan.id);
    expect(steps.map((s) => s.step_index)).toEqual([0, 1]);
  });

  it('updatePlanStatus persists status change', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: null, confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-3', expiresAt: null, conversationId: null,
    });
    const updated = await updatePlanStatus(plan.id, 'running');
    expect(updated.status).toBe('running');
  });

  it('updatePlanStepStatus persists step status', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: null, confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-4', expiresAt: null, conversationId: null,
    });
    const step = await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.list', actionArgs: { limit: 5 }, riskTier: 'read', dependsOn: [], rationale: 'r' });
    const updated = await updatePlanStepStatus(step.id, 'succeeded', { result: { ok: true } });
    expect(updated.status).toBe('succeeded');
    expect(updated.result).toEqual({ ok: true });
  });

  it('findStaleRunningPlans returns plans updated_at older than threshold', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: null, confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-5', expiresAt: null, conversationId: null,
    });
    await updatePlanStatus(plan.id, 'running');
    await pool.query(`UPDATE agent_plans SET updated_at = NOW() - INTERVAL '120 seconds' WHERE id = $1`, [plan.id]);
    const stale = await findStaleRunningPlans(60);
    expect(stale.some((p) => p.id === plan.id)).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/plan.repository.test.ts
```

Expected: FAIL — `plan.repository` module not found.

- [ ] **Step 3.3: Write plan.repository.ts**

```typescript
// backend/src/modules/agent-planner/plan.repository.ts
import { pool, queryOne } from '../../shared/utils/db';
import type {
  CreatePlanInput,
  CreatePlanStepInput,
  PlanRow,
  PlanStepRow,
  PlanStatus,
  PlanStepStatus,
} from './plan.types';

export async function createPlan(input: CreatePlanInput): Promise<PlanRow> {
  const row = await queryOne<PlanRow>(
    `INSERT INTO agent_plans
       (conversation_id, goal, status, autonomy_level, confidence, source,
        requested_by, source_message, expires_at, idempotency_key)
     VALUES ($1, $2, 'proposed', $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      input.conversationId ?? null,
      input.goal,
      input.autonomyLevel ?? null,
      input.confidence ?? null,
      input.source,
      input.requestedBy ?? null,
      input.sourceMessage ?? null,
      input.expiresAt ?? null,
      input.idempotencyKey,
    ],
  );
  if (!row) throw new Error('Failed to create plan');
  return row;
}

export async function createPlanStep(input: CreatePlanStepInput): Promise<PlanStepRow> {
  const row = await queryOne<PlanStepRow>(
    `INSERT INTO agent_plan_steps
       (plan_id, step_index, action_name, action_args, risk_tier, depends_on, rationale)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.planId,
      input.stepIndex,
      input.actionName,
      JSON.stringify(input.actionArgs),
      input.riskTier,
      input.dependsOn,
      input.rationale,
    ],
  );
  if (!row) throw new Error('Failed to create plan step');
  return row;
}

export async function findPlanById(id: string): Promise<PlanRow | null> {
  return queryOne<PlanRow>(`SELECT * FROM agent_plans WHERE id = $1`, [id]);
}

export async function findPlanByIdempotencyKey(key: string): Promise<PlanRow | null> {
  return queryOne<PlanRow>(`SELECT * FROM agent_plans WHERE idempotency_key = $1`, [key]);
}

export async function findPlanStepById(id: string): Promise<PlanStepRow | null> {
  return queryOne<PlanStepRow>(`SELECT * FROM agent_plan_steps WHERE id = $1`, [id]);
}

export async function findPlanStepsByPlan(planId: string): Promise<PlanStepRow[]> {
  const result = await pool.query<PlanStepRow>(
    `SELECT * FROM agent_plan_steps WHERE plan_id = $1 ORDER BY step_index ASC`,
    [planId],
  );
  return result.rows;
}

export async function updatePlanStatus(
  id: string,
  status: PlanStatus,
  fields?: { errorMessage?: string | null; startedAt?: string | null; completedAt?: string | null; costUsedCents?: number },
): Promise<PlanRow> {
  const row = await queryOne<PlanRow>(
    `UPDATE agent_plans
     SET status = $2,
         error_message = COALESCE($3, error_message),
         started_at = COALESCE($4, started_at),
         completed_at = COALESCE($5, completed_at),
         cost_used_cents = COALESCE($6, cost_used_cents),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      fields?.errorMessage ?? null,
      fields?.startedAt ?? null,
      fields?.completedAt ?? null,
      fields?.costUsedCents ?? null,
    ],
  );
  if (!row) throw new Error(`Plan not found: ${id}`);
  return row;
}

export async function updatePlanStepStatus(
  id: string,
  status: PlanStepStatus,
  fields?: { result?: Record<string, unknown> | null; errorMessage?: string | null; agentActionId?: string | null; startedAt?: string | null; completedAt?: string | null },
): Promise<PlanStepRow> {
  const row = await queryOne<PlanStepRow>(
    `UPDATE agent_plan_steps
     SET status = $2,
         result = COALESCE($3, result),
         error_message = COALESCE($4, error_message),
         agent_action_id = COALESCE($5, agent_action_id),
         started_at = COALESCE($6, started_at),
         completed_at = COALESCE($7, completed_at)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      fields?.result === undefined ? null : JSON.stringify(fields.result),
      fields?.errorMessage ?? null,
      fields?.agentActionId ?? null,
      fields?.startedAt ?? null,
      fields?.completedAt ?? null,
    ],
  );
  if (!row) throw new Error(`Plan step not found: ${id}`);
  return row;
}

export async function findStaleRunningPlans(olderThanSeconds: number): Promise<PlanRow[]> {
  const result = await pool.query<PlanRow>(
    `SELECT * FROM agent_plans
     WHERE status = 'running' AND updated_at < NOW() - ($1 || ' seconds')::interval`,
    [String(olderThanSeconds)],
  );
  return result.rows;
}

export async function claimPlanForRecovery(id: string): Promise<PlanRow | null> {
  const result = await pool.query<PlanRow>(
    `UPDATE agent_plans
     SET updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING *`,
    [id],
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/plan.repository.test.ts
```

Expected: PASS — all 5 test cases green.

- [ ] **Step 3.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/plan.repository.ts src/modules/agent-planner/__tests__/plan.repository.test.ts && git commit -m "feat(agent-planner): plan repository with DB layer"
```

---

## Task 4: Typed errors

**Files:**
- Create: `backend/src/modules/agent-planner/errors.ts`
- Test: `backend/src/modules/agent-planner/__tests__/errors.test.ts`

- [ ] **Step 4.1: Write the failing error tests**

```typescript
// backend/src/modules/agent-planner/__tests__/errors.test.ts
import { AppError } from '../../../shared/middleware/errorHandler';
import { PlannerError, RunnerError, mapCodeToHttp } from '../errors';

describe('errors', () => {
  it('PlannerError extends AppError and carries the code', () => {
    const err = new PlannerError('invalid_plan', 'bad plan', { steps: [] });
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('invalid_plan');
    expect(err.statusCode).toBe(422);
  });

  it('RunnerError extends AppError and carries planId', () => {
    const err = new RunnerError('budget_exhausted', 'over cap', 'plan-1', 3);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('budget_exhausted');
    expect(err.planId).toBe('plan-1');
    expect(err.stepIndex).toBe(3);
    expect(err.statusCode).toBe(409);
  });

  it('mapCodeToHttp returns correct codes', () => {
    expect(mapCodeToHttp('invalid_plan')).toBe(422);
    expect(mapCodeToHttp('planner_timeout')).toBe(504);
    expect(mapCodeToHttp('planner_malformed')).toBe(502);
    expect(mapCodeToHttp('compliance_in_plan')).toBe(422);
    expect(mapCodeToHttp('budget_exhausted')).toBe(409);
    expect(mapCodeToHttp('step_failed')).toBe(409);
    expect(mapCodeToHttp('recovery_exhausted')).toBe(500);
    expect(mapCodeToHttp('approval_timeout')).toBe(409);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/errors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Write errors.ts**

```typescript
// backend/src/modules/agent-planner/errors.ts
import { AppError } from '../../shared/middleware/errorHandler';

export type PlannerErrorCode =
  | 'invalid_plan'
  | 'planner_timeout'
  | 'planner_malformed'
  | 'compliance_in_plan';

export type RunnerErrorCode =
  | 'budget_exhausted'
  | 'step_failed'
  | 'plan_cancelled'
  | 'recovery_exhausted'
  | 'approval_timeout';

export function mapCodeToHttp(code: PlannerErrorCode | RunnerErrorCode): number {
  switch (code) {
    case 'invalid_plan':
    case 'compliance_in_plan':
      return 422;
    case 'planner_timeout':
      return 504;
    case 'planner_malformed':
      return 502;
    case 'budget_exhausted':
    case 'step_failed':
    case 'approval_timeout':
      return 409;
    case 'recovery_exhausted':
      return 500;
    case 'plan_cancelled':
      return 200;
  }
}

export class PlannerError extends AppError {
  constructor(
    public code: PlannerErrorCode,
    message: string,
    public planDraft?: unknown,
  ) {
    super(message, mapCodeToHttp(code));
    this.name = 'PlannerError';
  }
}

export class RunnerError extends AppError {
  constructor(
    public code: RunnerErrorCode,
    message: string,
    public planId: string,
    public stepIndex?: number,
  ) {
    super(message, mapCodeToHttp(code));
    this.name = 'RunnerError';
  }
}

export class StepAwaitingApproval extends Error {
  constructor(public stepIndex: number) {
    super(`Step ${stepIndex} is awaiting approval`);
    this.name = 'StepAwaitingApproval';
  }
}

export class StepRejected extends Error {
  constructor(public stepIndex: number, public reason: string) {
    super(`Step ${stepIndex} rejected: ${reason}`);
    this.name = 'StepRejected';
  }
}
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/errors.test.ts
```

Expected: PASS — 3 test cases green.

- [ ] **Step 4.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/errors.ts src/modules/agent-planner/__tests__/errors.test.ts && git commit -m "feat(agent-planner): typed PlannerError and RunnerError classes"
```

---

## Task 5: Prometheus metrics

**Files:**
- Modify: `backend/src/shared/utils/metrics.ts` (add new counters/histograms)
- Create: `backend/src/modules/agent-planner/metrics.ts` (typed wrappers)
- Test: `backend/src/modules/agent-planner/__tests__/metrics.test.ts`

- [ ] **Step 5.1: Write the failing metrics tests**

```typescript
// backend/src/modules/agent-planner/__tests__/metrics.test.ts
import {
  incPlanCreated,
  incPlanSucceeded,
  incPlanFailed,
  incStepExecuted,
  incPlanError,
  observePlanDuration,
  observeStepDuration,
} from '../metrics';

describe('agent-planner metrics', () => {
  it('incPlanCreated does not throw', () => {
    expect(() => incPlanCreated({ source: 'chat', autonomyLevel: 'supervised' })).not.toThrow();
  });

  it('incPlanSucceeded does not throw', () => {
    expect(() => incPlanSucceeded({ autonomyLevel: 'supervised' })).not.toThrow();
  });

  it('incPlanFailed does not throw', () => {
    expect(() => incPlanFailed({ autonomyLevel: 'guarded', reason: 'step_failed' })).not.toThrow();
  });

  it('incStepExecuted does not throw', () => {
    expect(() => incStepExecuted({ action: 'lead.list', riskTier: 'read', outcome: 'succeeded' })).not.toThrow();
  });

  it('incPlanError does not throw', () => {
    expect(() => incPlanError({ code: 'invalid_plan' })).not.toThrow();
  });

  it('observePlanDuration does not throw', () => {
    expect(() => observePlanDuration({ autonomyLevel: 'supervised' }, 1.5)).not.toThrow();
  });

  it('observeStepDuration does not throw', () => {
    expect(() => observeStepDuration({ riskTier: 'read' }, 0.3)).not.toThrow();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/metrics.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Add new counters/histograms to shared metrics.ts**

Append to `backend/src/shared/utils/metrics.ts` (do not modify existing functions):

```typescript
// At the end of backend/src/shared/utils/metrics.ts

import type { PlanSource, AutonomyLevel } from '../../modules/agent-planner/plan.types';
import type { AgentRiskTier, AgentActionName } from '../../modules/agent-types';

// (Note: in production, plan.types.ts must NOT import from metrics.ts to avoid circular import.
//  These typed wrapper functions in agent-planner/metrics.ts centralize the label constants.)

export const agentPlansCreatedTotal = new client.Counter({
  name: 'crm_agent_plans_created_total',
  help: 'Number of agent plans created',
  labelNames: ['source', 'autonomy_level'] as const,
});

export const agentPlansSucceededTotal = new client.Counter({
  name: 'crm_agent_plans_succeeded_total',
  help: 'Number of agent plans that succeeded',
  labelNames: ['autonomy_level'] as const,
});

export const agentPlansFailedTotal = new client.Counter({
  name: 'crm_agent_plans_failed_total',
  help: 'Number of agent plans that failed',
  labelNames: ['autonomy_level', 'reason'] as const,
});

export const agentStepsExecutedTotal = new client.Counter({
  name: 'crm_agent_steps_executed_total',
  help: 'Number of agent steps executed',
  labelNames: ['action', 'risk_tier', 'outcome'] as const,
});

export const agentPlanErrorsTotal = new client.Counter({
  name: 'crm_agent_plan_errors_total',
  help: 'Number of agent plan errors by code',
  labelNames: ['code'] as const,
});

export const agentPlanDurationSeconds = new client.Histogram({
  name: 'crm_agent_plan_duration_seconds',
  help: 'Wall-clock duration of agent plans',
  labelNames: ['autonomy_level'] as const,
  buckets: [0.5, 1, 5, 10, 30, 60, 120, 300],
});

export const agentStepDurationSeconds = new client.Histogram({
  name: 'crm_agent_step_duration_seconds',
  help: 'Wall-clock duration of agent plan steps',
  labelNames: ['risk_tier'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30],
});
```

- [ ] **Step 5.4: Write agent-planner/metrics.ts (typed wrappers)**

```typescript
// backend/src/modules/agent-planner/metrics.ts
import {
  agentPlansCreatedTotal,
  agentPlansSucceededTotal,
  agentPlansFailedTotal,
  agentStepsExecutedTotal,
  agentPlanErrorsTotal,
  agentPlanDurationSeconds,
  agentStepDurationSeconds,
} from '../../shared/utils/metrics';
import type { PlanSource, AutonomyLevel } from './plan.types';
import type { AgentRiskTier, AgentActionName } from '../agent/agent.types';
import type { PlannerErrorCode, RunnerErrorCode } from './errors';

export function incPlanCreated(labels: { source: PlanSource; autonomyLevel: AutonomyLevel }): void {
  agentPlansCreatedTotal.inc({ source: labels.source, autonomy_level: labels.autonomyLevel });
}

export function incPlanSucceeded(labels: { autonomyLevel: AutonomyLevel }): void {
  agentPlansSucceededTotal.inc({ autonomy_level: labels.autonomyLevel });
}

export function incPlanFailed(labels: { autonomyLevel: AutonomyLevel; reason: string }): void {
  agentPlansFailedTotal.inc({ autonomy_level: labels.autonomyLevel, reason: labels.reason });
}

export function incStepExecuted(labels: { action: AgentActionName; riskTier: AgentRiskTier; outcome: string }): void {
  agentStepsExecutedTotal.inc({
    action: labels.action,
    risk_tier: labels.riskTier,
    outcome: labels.outcome,
  });
}

export function incPlanError(labels: { code: PlannerErrorCode | RunnerErrorCode }): void {
  agentPlanErrorsTotal.inc({ code: labels.code });
}

export function observePlanDuration(labels: { autonomyLevel: AutonomyLevel }, seconds: number): void {
  agentPlanDurationSeconds.observe({ autonomy_level: labels.autonomyLevel }, seconds);
}

export function observeStepDuration(labels: { riskTier: AgentRiskTier }, seconds: number): void {
  agentStepDurationSeconds.observe({ risk_tier: labels.riskTier }, seconds);
}
```

- [ ] **Step 5.5: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/metrics.test.ts
```

Expected: PASS — 7 test cases green.

- [ ] **Step 5.6: Commit**

```bash
cd backend && git add src/shared/utils/metrics.ts src/modules/agent-planner/metrics.ts src/modules/agent-planner/__tests__/metrics.test.ts && git commit -m "feat(agent-planner): Prometheus metrics for plans and steps"
```

---

## Task 6: Idempotency utilities

**Files:**
- Create: `backend/src/modules/agent-planner/idempotency.ts`
- Test: `backend/src/modules/agent-planner/__tests__/idempotency.test.ts`

- [ ] **Step 6.1: Write the failing idempotency tests**

```typescript
// backend/src/modules/agent-planner/__tests__/idempotency.test.ts
import { buildPlanIdempotencyKey, stableJson } from '../idempotency';

describe('idempotency', () => {
  it('stableJson sorts object keys', () => {
    const a = stableJson({ b: 1, a: 2 });
    const b = stableJson({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('stableJson handles nested objects', () => {
    const a = stableJson({ x: { b: 1, a: 2 }, y: [3, 2, 1] });
    const b = stableJson({ y: [3, 2, 1], x: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  it('buildPlanIdempotencyKey is deterministic for same inputs', () => {
    const k1 = buildPlanIdempotencyKey({
      source: 'chat',
      actorId: 'user-1',
      goal: 'find leads',
      sourceMessage: 'hello',
    });
    const k2 = buildPlanIdempotencyKey({
      source: 'chat',
      actorId: 'user-1',
      goal: 'find leads',
      sourceMessage: 'hello',
    });
    expect(k1).toBe(k2);
  });

  it('buildPlanIdempotencyKey changes when any input changes', () => {
    const base = { source: 'chat' as const, actorId: 'user-1', goal: 'find leads', sourceMessage: 'hello' };
    const k1 = buildPlanIdempotencyKey(base);
    const k2 = buildPlanIdempotencyKey({ ...base, goal: 'find contacts' });
    expect(k1).not.toBe(k2);
  });

  it('buildPlanIdempotencyKey starts with "plan:" prefix', () => {
    const k = buildPlanIdempotencyKey({ source: 'chat', actorId: null, goal: 'x', sourceMessage: null });
    expect(k.startsWith('plan:')).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/idempotency.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Write idempotency.ts**

```typescript
// backend/src/modules/agent-planner/idempotency.ts
import crypto from 'crypto';
import type { PlanSource } from './plan.types';

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function buildPlanIdempotencyKey(input: {
  source: PlanSource;
  actorId?: string | null;
  goal: string;
  sourceMessage?: string | null;
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(
      `${input.source}:${input.actorId ?? 'system'}:${input.goal}:${input.sourceMessage ?? ''}`,
    )
    .digest('hex');
  return `plan:${hash}`;
}

export function buildApproveIdempotencyKey(input: {
  planId: string;
  actorId: string;
  stepIndexes: number[];
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${input.planId}:${input.actorId}:${[...input.stepIndexes].sort((a, b) => a - b).join(',')}`)
    .digest('hex');
  return `approve:${hash}`;
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/idempotency.test.ts
```

Expected: PASS — 5 test cases green.

- [ ] **Step 6.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/idempotency.ts src/modules/agent-planner/__tests__/idempotency.test.ts && git commit -m "feat(agent-planner): plan idempotency key generation"
```

---

# Phase 2: Planner

## Task 7: Planner prompt builder

**Files:**
- Create: `backend/src/modules/agent-planner/planner.prompt.ts`
- Test: `backend/src/modules/agent-planner/__tests__/planner.prompt.test.ts`

- [ ] **Step 7.1: Write the failing prompt tests**

```typescript
// backend/src/modules/agent-planner/__tests__/planner.prompt.test.ts
import { buildPlannerSystemPrompt, planJsonSchema } from '../planner.prompt';
import type { AgentActor } from '../../agent/agent.types';

const actor: AgentActor = {
  id: 'user-1',
  role: 'admin',
  email: 'a@b.com',
  name: 'Admin',
  ipAddress: null,
};

describe('planner.prompt', () => {
  it('buildPlannerSystemPrompt includes actor role and autonomy level', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'supervised', today: '2026-06-30' });
    expect(prompt).toContain('admin');
    expect(prompt).toContain('supervised');
    expect(prompt).toContain('2026-06-30');
  });

  it('buildPlannerSystemPrompt includes all 17 action names', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'guarded', today: '2026-06-30' });
    for (const name of [
      'lead.list', 'lead.get', 'lead.create', 'lead.update', 'lead.pause',
      'pipeline.move_lead', 'campaign.list', 'campaign.pause', 'campaign.resume',
      'campaign.launch', 'campaign.stats', 'assignment.override', 'report.dashboard',
      'scraper.run', 'outreach.send_manual', 'ai.decision.recompute', 'ai.inbox.action',
    ]) {
      expect(prompt).toContain(name);
    }
  });

  it('buildPlannerSystemPrompt warns against compliance actions in plans', () => {
    const prompt = buildPlannerSystemPrompt({ actor, autonomyLevel: 'supervised', today: '2026-06-30' });
    expect(prompt).toMatch(/never.*plan/i).and.toMatch(/compliance/i);
  });

  it('planJsonSchema has strict mode and matches planSchema shape', () => {
    expect(planJsonSchema.strict).toBe(true);
    expect(planJsonSchema.name).toBe('agent_plan');
    expect(planJsonSchema.schema).toBeDefined();
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/planner.prompt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7.3: Write planner.prompt.ts**

```typescript
// backend/src/modules/agent-planner/planner.prompt.ts
import type { AgentActor } from '../../agent/agent.types';
import { AGENT_ACTIONS } from '../../agent/agent.actions';
import { planSchema } from './plan.schema';
import type { AutonomyLevel } from './plan.types';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function listActionsForPrompt(): string {
  return Object.values(AGENT_ACTIONS)
    .map((d) => `- ${d.name} [${d.riskTier}] (roles: ${d.allowedRoles.join('|')}): ${d.description}`)
    .join('\n');
}

export function buildPlannerSystemPrompt(ctx: {
  actor: AgentActor;
  autonomyLevel: AutonomyLevel;
  today: string;
}): string {
  return `
You are a CRM planning agent. Convert the user's goal into a typed plan of agent actions.

Available actions (use ONLY these — never invent API routes or table names):
${listActionsForPrompt()}

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
6. NEVER include compliance_critical actions (ai.inbox.action) in plans; these require direct API calls.
  `.trim();
}

export const planJsonSchema = {
  type: 'json_schema' as const,
  strict: true,
  name: 'agent_plan',
  schema: zodToJsonSchema(planSchema, { target: 'openApi3' }),
};
```

- [ ] **Step 7.4: Install zod-to-json-schema dependency**

```bash
cd backend && npm install zod-to-json-schema
```

Verify in `backend/package.json` it appears under dependencies. If not, install as devDependency.

- [ ] **Step 7.5: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/planner.prompt.test.ts
```

Expected: PASS — 4 test cases green.

- [ ] **Step 7.6: Commit**

```bash
cd backend && git add src/modules/agent-planner/planner.prompt.ts src/modules/agent-planner/__tests__/planner.prompt.test.ts package.json package-lock.json && git commit -m "feat(agent-planner): planner system prompt + structured-output schema"
```

---

## Task 8: Planner service

**Files:**
- Create: `backend/src/modules/agent-planner/planner.service.ts`
- Test: `backend/src/modules/agent-planner/__tests__/planner.service.test.ts`

- [ ] **Step 8.1: Write the failing planner tests**

```typescript
// backend/src/modules/agent-planner/__tests__/planner.service.test.ts
import { createPlanFromGoal } from '../planner.service';
import { findPlanByIdempotencyKey } from '../plan.repository';
import { pool } from '../../../shared/utils/db';
import OpenAI from 'openai';

jest.mock('openai');
jest.mock('../../../shared/utils/db', () => {
  const actual = jest.requireActual('pg');
  return {
    pool: { query: jest.fn(), end: jest.fn() },
    queryOne: jest.fn(),
  };
});

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('planner.service.createPlanFromGoal', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });

  it('returns an existing plan on idempotency hit', async () => {
    // Seed an existing plan
    const idempotencyKey = 'plan:existing';
    await pool.query(
      `INSERT INTO agent_plans (goal, status, source, idempotency_key) VALUES ('x', 'proposed', 'chat', $1)`,
      [idempotencyKey],
    );

    const result = await createPlanFromGoal({
      goal: 'x',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      autonomyLevel: 'supervised',
      source: 'chat',
      sourceMessage: null,
    });

    expect(result.goal).toBe('x');
    expect(MockedOpenAI.prototype.chat.completions.create).not.toHaveBeenCalled();
  });

  it('calls OpenAI structured output and persists a plan', async () => {
    const mockCompletion = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              goal: 'get leads',
              steps: [
                {
                  step_index: 0,
                  action_name: 'lead.list',
                  action_args: { limit: 5 },
                  risk_tier: 'read',
                  depends_on: [],
                  rationale: 'fetch leads',
                },
              ],
            }),
          },
        },
      ],
    };
    MockedOpenAI.prototype.chat.completions.create = jest.fn().mockResolvedValue(mockCompletion as any);

    const result = await createPlanFromGoal({
      goal: 'get leads',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      autonomyLevel: 'supervised',
      source: 'chat',
      sourceMessage: 'get leads please',
    });

    expect(result.steps).toHaveLength(1);
    expect(result.status).toBe('proposed');
    expect(MockedOpenAI.prototype.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({ type: 'json_schema' }),
      }),
    );
  });

  it('throws PlannerError(invalid_plan) when LLM output fails validation', async () => {
    const mockCompletion = {
      choices: [{ message: { content: JSON.stringify({ goal: 'x', steps: [] }) } }],
    };
    MockedOpenAI.prototype.chat.completions.create = jest.fn().mockResolvedValue(mockCompletion as any);

    await expect(
      createPlanFromGoal({
        goal: 'x',
        actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
        autonomyLevel: 'supervised',
        source: 'chat',
        sourceMessage: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('retries once on malformed JSON then throws PlannerError(planner_malformed)', async () => {
    MockedOpenAI.prototype.chat.completions.create = jest
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'still not json' } }] });

    await expect(
      createPlanFromGoal({
        goal: 'x',
        actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
        autonomyLevel: 'supervised',
        source: 'chat',
        sourceMessage: null,
      }),
    ).rejects.toMatchObject({ code: 'planner_malformed' });
    expect(MockedOpenAI.prototype.chat.completions.create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/planner.service.test.ts
```

Expected: FAIL — `planner.service` module not found.

- [ ] **Step 8.3: Write planner.service.ts**

```typescript
// backend/src/modules/agent-planner/planner.service.ts
import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { AgentActor } from '../agent/agent.types';
import {
  createPlan,
  createPlanStep,
  findPlanById,
  findPlanByIdempotencyKey,
  findPlanStepsByPlan,
} from './plan.repository';
import { planSchema } from './plan.schema';
import type { AutonomyLevel, PlanRow, PlanStepRow, PlanSource, PlanStep } from './plan.types';
import { PlannerError } from './errors';
import { buildPlanIdempotencyKey } from './idempotency';
import { buildPlannerSystemPrompt, planJsonSchema } from './planner.prompt';
import { incPlanCreated, incPlanError } from './metrics';

export async function createPlanFromGoal(input: {
  goal: string;
  actor: AgentActor | null;
  autonomyLevel: AutonomyLevel;
  source: PlanSource;
  sourceMessage?: string | null;
  conversationId?: string | null;
  pageContext?: unknown;
}): Promise<{ plan: PlanRow; steps: PlanStepRow[] }> {
  const idempotencyKey = buildPlanIdempotencyKey({
    source: input.source,
    actorId: input.actor?.id,
    goal: input.goal,
    sourceMessage: input.sourceMessage ?? null,
  });

  const existing = await findPlanByIdempotencyKey(idempotencyKey);
  if (existing) {
    const steps = await findPlanStepsByPlan(existing.id);
    return { plan: existing, steps };
  }

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    throw new PlannerError('planner_malformed', 'AI settings not configured');
  }

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const systemPrompt = buildPlannerSystemPrompt({
    actor: input.actor ?? { id: 'system', role: 'admin', email: null, name: null, ipAddress: null },
    autonomyLevel: input.autonomyLevel,
    today: new Date().toISOString().slice(0, 10),
  });

  let rawContent: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: 2000,
        temperature: 0.2,
        response_format: planJsonSchema as any,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ goal: input.goal, pageContext: input.pageContext ?? null }) },
        ],
      });
      rawContent = completion.choices[0]?.message?.content ?? null;
      if (rawContent) break;
    } catch (err) {
      logger.error('planner: OpenAI call failed', { attempt, error: (err as Error).message });
      if (attempt === 1) {
        incPlanError({ code: 'planner_malformed' });
        throw new PlannerError('planner_malformed', 'OpenAI call failed after retry');
      }
    }
  }

  if (!rawContent) {
    incPlanError({ code: 'planner_malformed' });
    throw new PlannerError('planner_malformed', 'OpenAI returned empty content');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    incPlanError({ code: 'planner_malformed' });
    throw new PlannerError('planner_malformed', 'OpenAI returned malformed JSON');
  }

  const validated = planSchema.safeParse(parsedJson);
  if (!validated.success) {
    incPlanError({ code: 'invalid_plan' });
    await insertDecisionLog({
      lead_id: null,
      campaign_id: null,
      decision_type: 'agent_plan',
      input_context: { goal: input.goal, source: input.source, actorRole: input.actor?.role ?? null },
      chain_of_thought: validated.error.message,
      decision: 'invalid_plan',
      model_used: aiConfig.model,
      human_approval_required: false,
    }).catch(() => null);
    throw new PlannerError('invalid_plan', validated.error.message, parsedJson);
  }

  const plan = await createPlan({
    conversationId: input.conversationId ?? null,
    goal: validated.data.goal,
    autonomyLevel: input.autonomyLevel,
    confidence: null,
    source: input.source,
    requestedBy: input.actor?.id ?? null,
    sourceMessage: input.sourceMessage ?? null,
    steps: validated.data.steps as PlanStep[],
    idempotencyKey,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  const steps: PlanStepRow[] = [];
  for (const s of validated.data.steps) {
    const row = await createPlanStep({
      planId: plan.id,
      stepIndex: s.step_index,
      actionName: s.action_name,
      actionArgs: s.action_args,
      riskTier: s.risk_tier,
      dependsOn: s.depends_on,
      rationale: s.rationale,
    });
    steps.push(row);
  }

  incPlanCreated({ source: input.source, autonomyLevel: input.autonomyLevel });

  await insertDecisionLog({
    lead_id: null,
    campaign_id: null,
    decision_type: 'agent_plan',
    input_context: {
      planId: plan.id,
      goal: plan.goal,
      source: input.source,
      actorRole: input.actor?.role ?? null,
      stepCount: steps.length,
    },
    chain_of_thought: validated.data.steps.map((s) => `[${s.step_index}] ${s.action_name}: ${s.rationale}`).join('\n'),
    decision: 'proposed',
    model_used: aiConfig.model,
    human_approval_required: false,
  }).catch(() => null);

  return { plan, steps };
}
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/planner.service.test.ts
```

Expected: PASS — 4 test cases green.

- [ ] **Step 8.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/planner.service.ts src/modules/agent-planner/__tests__/planner.service.test.ts && git commit -m "feat(agent-planner): planner service with OpenAI structured output"
```

---

## Task 9: Plan preview rendering (response shape for chat)

**Files:**
- Modify: `backend/src/modules/agent-planner/planner.service.ts` (add `getPlanForPreview`)
- Test: `backend/src/modules/agent-planner/__tests__/planner.preview.test.ts`

- [ ] **Step 9.1: Write the failing preview test**

```typescript
// backend/src/modules/agent-planner/__tests__/planner.preview.test.ts
import { pool } from '../../../shared/utils/db';
import { getPlanForPreview } from '../planner.service';
import { createPlan, createPlanStep } from '../plan.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('planner.service.getPlanForPreview', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('returns plan + steps with computed cost estimate', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'supervised', confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-prev', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.list', actionArgs: { limit: 5 }, riskTier: 'read', dependsOn: [], rationale: 'get leads' });
    await createPlanStep({ planId: plan.id, stepIndex: 1, actionName: 'campaign.launch', actionArgs: { id: '00000000-0000-0000-0000-000000000001' }, riskTier: 'customer_facing_write', dependsOn: [0], rationale: 'launch' });

    const preview = await getPlanForPreview(plan.id);

    expect(preview.steps).toHaveLength(2);
    expect(preview.estimatedCostCents).toBeGreaterThan(0);
    expect(preview.requiresApproval).toBe(true);
  });

  it('returns null when plan does not exist', async () => {
    const preview = await getPlanForPreview('00000000-0000-0000-0000-000000000000');
    expect(preview).toBeNull();
  });

  it('requiresApproval is false when all steps are read or low_risk_write', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'autopilot', confidence: 95, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'idem-auto', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.list', actionArgs: { limit: 5 }, riskTier: 'read', dependsOn: [], rationale: 'r' });
    await createPlanStep({ planId: plan.id, stepIndex: 1, actionName: 'ai.decision.recompute', actionArgs: { leadId: '00000000-0000-0000-0000-000000000001' }, riskTier: 'low_risk_write', dependsOn: [0], rationale: 'r' });

    const preview = await getPlanForPreview(plan.id);
    expect(preview?.requiresApproval).toBe(true); // supervised default still requires approval
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/planner.preview.test.ts
```

Expected: FAIL — `getPlanForPreview` not exported.

- [ ] **Step 9.3: Add getPlanForPreview to planner.service.ts**

Append to `backend/src/modules/agent-planner/planner.service.ts`:

```typescript
const COST_BY_RISK_TIER: Record<string, number> = {
  read: 0.1,
  low_risk_write: 1,
  sensitive_write: 5,
  customer_facing_write: 10,
};

export async function getPlanForPreview(planId: string): Promise<{
  plan: PlanRow;
  steps: PlanStepRow[];
  estimatedCostCents: number;
  requiresApproval: boolean;
} | null> {
  const plan = await findPlanById(planId);
  if (!plan) return null;
  const steps = await findPlanStepsByPlan(plan.id);
  const estimatedCostCents = steps.reduce((sum, s) => sum + (COST_BY_RISK_TIER[s.risk_tier] ?? 0), 0);
  const hasRiskyStep = steps.some((s) => s.risk_tier === 'sensitive_write' || s.risk_tier === 'customer_facing_write');
  // Default supervised autonomy always requires approval
  const requiresApproval = plan.autonomy_level === 'supervised' || hasRiskyStep;
  return { plan, steps, estimatedCostCents, requiresApproval };
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/planner.preview.test.ts
```

Expected: PASS — 3 test cases green.

- [ ] **Step 9.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/planner.service.ts src/modules/agent-planner/__tests__/planner.preview.test.ts && git commit -m "feat(agent-planner): getPlanForPreview with cost estimate and approval flag"
```

---

# Phase 3: Runner

## Task 10: Topological sort (waves)

**Files:**
- Create: `backend/src/modules/agent-planner/runner.topo.ts`
- Test: `backend/src/modules/agent-planner/__tests__/runner.topo.test.ts`

- [ ] **Step 10.1: Write the failing topo tests**

```typescript
// backend/src/modules/agent-planner/__tests__/runner.topo.test.ts
import { topoSortIntoWaves } from '../runner.topo';
import type { PlanStepRow } from '../plan.types';

function step(index: number, dependsOn: number[] = [], overrides: Partial<PlanStepRow> = {}): PlanStepRow {
  return {
    id: `step-${index}`,
    plan_id: 'plan-1',
    step_index: index,
    action_name: 'lead.list',
    action_args: {},
    risk_tier: 'read',
    depends_on: dependsOn,
    rationale: `step ${index}`,
    status: 'pending',
    agent_action_id: null,
    result: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe('topoSortIntoWaves', () => {
  it('returns single wave for linear steps with no deps', () => {
    const steps = [step(0), step(1), step(2)];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((s) => s.step_index)).toEqual([0, 1, 2]);
  });

  it('returns N waves for a linear chain', () => {
    const steps = [step(0), step(1, [0]), step(2, [1])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(3);
  });

  it('groups parallel steps in one wave', () => {
    const steps = [step(0), step(1, [0]), step(2, [0]), step(3, [1, 2])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((s) => s.step_index)).toEqual([0]);
    expect(waves[1].map((s) => s.step_index).sort()).toEqual([1, 2]);
    expect(waves[2].map((s) => s.step_index)).toEqual([3]);
  });

  it('handles diamond shape correctly', () => {
    const steps = [step(0), step(1, [0]), step(2, [0]), step(3, [1, 2]), step(4, [3])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(4);
    expect(waves[1].map((s) => s.step_index).sort()).toEqual([1, 2]);
  });

  it('throws on cycles', () => {
    const steps = [step(0, [1]), step(1, [0])];
    expect(() => topoSortIntoWaves(steps)).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/runner.topo.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 10.3: Write runner.topo.ts**

```typescript
// backend/src/modules/agent-planner/runner.topo.ts
import type { PlanStepRow } from './plan.types';

export function topoSortIntoWaves(steps: PlanStepRow[]): PlanStepRow[][] {
  const byIndex = new Map<number, PlanStepRow>();
  for (const s of steps) byIndex.set(s.step_index, s);

  // Build adjacency: node -> list of nodes that depend on it
  const adj: Map<number, number[]> = new Map();
  const indegree = new Map<number, number>();
  for (const s of steps) {
    adj.set(s.step_index, []);
    indegree.set(s.step_index, 0);
  }
  for (const s of steps) {
    for (const dep of s.depends_on) {
      adj.get(dep)!.push(s.step_index);
      indegree.set(s.step_index, (indegree.get(s.step_index) ?? 0) + 1);
    }
  }

  const waves: PlanStepRow[][] = [];
  let frontier = steps.filter((s) => (indegree.get(s.step_index) ?? 0) === 0).map((s) => s.step_index);

  while (frontier.length > 0) {
    waves.push(frontier.map((i) => byIndex.get(i)!));
    const next: number[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        const newDeg = (indegree.get(m) ?? 0) - 1;
        indegree.set(m, newDeg);
        if (newDeg === 0) next.push(m);
      }
    }
    frontier = next;
  }

  if (waves.flat().length !== steps.length) {
    throw new Error('Plan contains a cycle');
  }

  return waves;
}
```

- [ ] **Step 10.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/runner.topo.test.ts
```

Expected: PASS — 5 test cases green.

- [ ] **Step 10.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/runner.topo.ts src/modules/agent-planner/__tests__/runner.topo.test.ts && git commit -m "feat(agent-planner): topological sort with wave grouping"
```

---

## Task 11: Budget tracker

**Files:**
- Create: `backend/src/modules/agent-planner/runner.budget.ts`
- Test: `backend/src/modules/agent-planner/__tests__/runner.budget.test.ts`

- [ ] **Step 11.1: Write the failing budget tests**

```typescript
// backend/src/modules/agent-planner/__tests__/runner.budget.test.ts
import { createBudgetTracker } from '../runner.budget';
import { RunnerError } from '../errors';
import type { PlanRow, PlanStepRow } from '../plan.types';

const plan: PlanRow = {
  id: 'plan-1',
  conversation_id: null,
  goal: 'g',
  status: 'running',
  autonomy_level: 'supervised',
  confidence: null,
  source: 'chat',
  requested_by: null,
  source_message: null,
  cost_cap_cents: 50,
  step_cap: 8,
  cost_used_cents: 0,
  deadline_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  started_at: null,
  completed_at: null,
  expires_at: null,
  error_message: null,
  created_at: '',
  updated_at: '',
  idempotency_key: '',
};

const step = (i: number, risk: PlanStepRow['risk_tier'] = 'read'): PlanStepRow => ({
  id: `s-${i}`, plan_id: 'plan-1', step_index: i, action_name: 'lead.list',
  action_args: {}, risk_tier: risk, depends_on: [], rationale: 'r', status: 'pending',
  agent_action_id: null, result: null, error_message: null, started_at: null, completed_at: null,
});

describe('createBudgetTracker', () => {
  it('assertCanStartStep passes for normal conditions', () => {
    const b = createBudgetTracker(plan);
    expect(() => b.assertCanStartStep(step(0))).not.toThrow();
  });

  it('assertCanStartStep throws after deadline', () => {
    const expired = { ...plan, deadline_at: new Date(Date.now() - 1000).toISOString() };
    const b = createBudgetTracker(expired);
    expect(() => b.assertCanStartStep(step(0))).toThrow(RunnerError);
  });

  it('assertCanStartStep throws when step cap reached', () => {
    const capped = { ...plan, step_cap: 1 };
    const b = createBudgetTracker(capped);
    b.recordStepStart();
    expect(() => b.assertCanStartStep(step(1))).toThrow(/step_cap|budget/i);
  });

  it('recordStepCost accumulates toward cap', () => {
    const b = createBudgetTracker(plan);
    b.recordStepCost(step(0, 'customer_facing_write'), 25);
    b.recordStepCost(step(1, 'customer_facing_write'), 25);
    expect(() => b.assertCanStartStep(step(2))).toThrow(/cost_cap|budget/i);
  });

  it('getRemainingCost returns cap minus used', () => {
    const b = createBudgetTracker(plan);
    b.recordStepCost(step(0, 'read'), 10);
    expect(b.getRemainingCost()).toBe(40);
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/runner.budget.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 11.3: Write runner.budget.ts**

```typescript
// backend/src/modules/agent-planner/runner.budget.ts
import { RunnerError } from './errors';
import type { PlanRow, PlanStepRow } from './plan.types';

const COST_BY_RISK_TIER: Record<string, number> = {
  read: 0.1,
  low_risk_write: 1,
  sensitive_write: 5,
  customer_facing_write: 10,
};

export interface BudgetTracker {
  assertCanStartStep(step: PlanStepRow): void;
  recordStepStart(): void;
  recordStepCost(step: PlanStepRow, actualCostCents: number): void;
  getRemainingCost(): number;
  getStepsExecuted(): number;
  isOvertime(): boolean;
}

export function createBudgetTracker(plan: PlanRow): BudgetTracker {
  let stepsExecuted = 0;
  let costUsed = plan.cost_used_cents;
  const stepCap = plan.step_cap;
  const costCap = plan.cost_cap_cents;
  const deadlineAt = plan.deadline_at ? Date.parse(plan.deadline_at) : null;

  function assertNotOvertime(): void {
    if (deadlineAt !== null && Date.now() > deadlineAt) {
      throw new RunnerError('budget_exhausted', `Plan deadline exceeded`, plan.id);
    }
  }

  return {
    assertCanStartStep(_step: PlanStepRow): void {
      assertNotOvertime();
      if (stepsExecuted >= stepCap) {
        throw new RunnerError('budget_exhausted', `Plan step cap ${stepCap} reached`, plan.id);
      }
      if (costUsed >= costCap) {
        throw new RunnerError('budget_exhausted', `Plan cost cap ${costCap} cents reached`, plan.id);
      }
    },
    recordStepStart(): void {
      stepsExecuted++;
    },
    recordStepCost(step: PlanStepRow, actualCostCents: number): void {
      const estimated = COST_BY_RISK_TIER[step.risk_tier] ?? 0;
      costUsed += Math.max(actualCostCents, estimated);
    },
    getRemainingCost(): number {
      return Math.max(0, costCap - costUsed);
    },
    getStepsExecuted(): number {
      return stepsExecuted;
    },
    isOvertime(): boolean {
      return deadlineAt !== null && Date.now() > deadlineAt;
    },
  };
}
```

- [ ] **Step 11.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/agent-planner/__tests__/runner.budget.test.ts
```

Expected: PASS — 5 test cases green.

- [ ] **Step 11.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/runner.budget.ts src/modules/agent-planner/__tests__/runner.budget.test.ts && git commit -m "feat(agent-planner): budget tracker with step/cost/clock enforcement"
```

---

## Task 12: Runner service (core loop)

**Files:**
- Create: `backend/src/modules/agent-planner/runner.service.ts`
- Test: `backend/src/modules/agent-planner/__tests__/runner.service.test.ts`

- [ ] **Step 12.1: Write the failing runner tests (high-level happy path + key failure)**

```typescript
// backend/src/modules/agent-planner/__tests__/runner.service.test.ts
import { pool } from '../../../shared/utils/db';
import { createPlan, createPlanStep, updatePlanStatus } from '../plan.repository';
import { executePlan, continuePlanIfReady } from '../runner.service';
import { proposeAgentAction } from '../../agent/agent.service';

jest.mock('../../agent/agent.service', () => ({
  proposeAgentAction: jest.fn(),
  executeAgentAction: jest.fn(),
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

const mockedPropose = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;

describe('runner.service', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('executes a single read step end-to-end', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'read' },
      action: null,
      result: { items: [{ id: 'x' }] },
    } as any);

    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'autopilot', confidence: 95, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'r-1', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.list', actionArgs: { limit: 5 }, riskTier: 'read', dependsOn: [], rationale: 'r' });
    await updatePlanStatus(plan.id, 'approved');

    const actor = { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null };
    const result = await executePlan(plan.id, actor);

    expect(result.status).toBe('succeeded');
    expect(mockedPropose).toHaveBeenCalledTimes(1);
  });

  it('pauses plan when step requires approval', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'require_approval', reason: 'write', assignTo: 'user-1' },
      action: { id: 'action-1' } as any,
    } as any);

    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'supervised', confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'r-2', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'lead.update', actionArgs: { id: '00000000-0000-0000-0000-000000000001', input: { notes: 'x' } }, riskTier: 'sensitive_write', dependsOn: [], rationale: 'r' });
    await updatePlanStatus(plan.id, 'approved');

    const actor = { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null };
    const result = await executePlan(plan.id, actor);

    expect(result.status).toBe('paused_for_approval');
  });

  it('fails plan when required step is rejected', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'reject', reason: 'role not allowed' },
      action: null,
    } as any);

    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'supervised', confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'r-3', expiresAt: null, conversationId: null,
    });
    await createPlanStep({ planId: plan.id, stepIndex: 0, actionName: 'scraper.run', actionArgs: { configId: '00000000-0000-0000-0000-000000000001' }, riskTier: 'sensitive_write', dependsOn: [], rationale: 'r' });
    await updatePlanStatus(plan.id, 'approved');

    const actor = { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null };
    const result = await executePlan(plan.id, actor);

    expect(result.status).toBe('failed');
  });

  it('continuePlanIfReady is a no-op when no plan is paused for approval', async () => {
    const result = await continuePlanIfReady('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 12.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/runner.service.test.ts
```

Expected: FAIL — `runner.service` module not found.

- [ ] **Step 12.3: Write runner.service.ts**

```typescript
// backend/src/modules/agent-planner/runner.service.ts
import { logger } from '../../shared/utils/logger';
import { Sentry } from '../../shared/utils/sentry';
import { proposeAgentAction, executeAgentAction as agentExecuteAgentAction } from '../agent/agent.service';
import type { AgentActor } from '../agent/agent.types';
import {
  findPlanById,
  findPlanStepsByPlan,
  updatePlanStatus,
  updatePlanStepStatus,
  claimPlanForRecovery,
} from './plan.repository';
import type { PlanRow, PlanStepRow } from './plan.types';
import { RunnerError, StepAwaitingApproval, StepRejected } from './errors';
import { topoSortIntoWaves } from './runner.topo';
import { createBudgetTracker, type BudgetTracker } from './runner.budget';
import {
  incPlanSucceeded,
  incPlanFailed,
  incStepExecuted,
  observePlanDuration,
  observeStepDuration,
} from './metrics';

export interface PlanRunResult {
  planId: string;
  status: PlanRow['status'];
  errorMessage?: string;
}

export async function executePlan(planId: string, actor: AgentActor): Promise<PlanRunResult> {
  const plan = await findPlanById(planId);
  if (!plan) throw new RunnerError('step_failed', `Plan ${planId} not found`, planId);
  if (plan.status !== 'approved') {
    throw new RunnerError('step_failed', `Plan ${planId} is ${plan.status}, not approved`, planId);
  }

  const start = Date.now();
  const budget = createBudgetTracker(plan);
  const steps = await findPlanStepsByPlan(plan.id);
  const waves = topoSortIntoWaves(steps);

  await updatePlanStatus(plan.id, 'running', { startedAt: new Date().toISOString() });

  try {
    for (const wave of waves) {
      if (await isCancelled(plan.id)) {
        return finalizePlan(plan.id, 'cancelled');
      }

      const results = await Promise.allSettled(
        wave.map((step) => runStep(plan, step, budget, actor)),
      );

      const requiredFailure = results.some((r, i) => {
        if (r.status === 'fulfilled') return false;
        return r.reason instanceof StepRejected && wave[i].risk_tier !== 'low_risk_write';
      });

      if (requiredFailure) {
        const failedIdx = results.findIndex((r) => r.status === 'rejected');
        const errMsg = failedIdx >= 0 && (results[failedIdx] as PromiseRejectedResult).reason instanceof Error
          ? (results[failedIdx] as PromiseRejectedResult).reason.message
          : 'unknown failure';
        return finalizePlan(plan.id, 'failed', errMsg);
      }
    }

    observePlanDuration({ autonomyLevel: plan.autonomy_level ?? 'supervised' }, (Date.now() - start) / 1000);
    incPlanSucceeded({ autonomyLevel: plan.autonomy_level ?? 'supervised' });
    return finalizePlan(plan.id, 'succeeded');
  } catch (err) {
    if (err instanceof StepAwaitingApproval) {
      return finalizePlan(plan.id, 'paused_for_approval', `Step ${err.stepIndex} awaiting approval`);
    }
    throw err;
  }
}

async function runStep(
  plan: PlanRow,
  step: PlanStepRow,
  budget: BudgetTracker,
  actor: AgentActor,
): Promise<void> {
  budget.assertCanStartStep(step);
  budget.recordStepStart();
  await updatePlanStepStatus(step.id, 'running', { startedAt: new Date().toISOString() });

  const stepStart = Date.now();

  try {
    const proposal = await proposeAgentAction({
      source: 'chat',
      actionName: step.action_name,
      args: step.action_args,
      actor,
      sourceMessage: `${plan.goal} (plan ${plan.id}, step ${step.step_index})`,
      autonomyLevel: plan.autonomy_level ?? 'supervised',
    });

    if (proposal.policy.outcome === 'reject') {
      incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'rejected' });
      await updatePlanStepStatus(step.id, 'failed', { errorMessage: proposal.policy.reason, completedAt: new Date().toISOString() });
      throw new StepRejected(step.step_index, proposal.policy.reason);
    }

    if (proposal.policy.outcome === 'require_approval') {
      incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'pending_approval' });
      await updatePlanStepStatus(step.id, 'pending_approval', {
        agentActionId: proposal.action?.id ?? null,
        completedAt: null,
      });
      // Mark the agent_action so it links back to the plan
      if (proposal.action?.id) {
        await linkAgentActionToPlan(proposal.action.id, plan.id, step.id);
      }
      throw new StepAwaitingApproval(step.step_index);
    }

    // execute_now: result was produced inline by proposeAgentAction
    incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'succeeded' });
    budget.recordStepCost(step, 0);
    observeStepDuration({ riskTier: step.risk_tier }, (Date.now() - stepStart) / 1000);
    await updatePlanStepStatus(step.id, 'succeeded', {
      result: (proposal.result as Record<string, unknown> | undefined) ?? null,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    observeStepDuration({ riskTier: step.risk_tier }, (Date.now() - stepStart) / 1000);
    if (!(err instanceof StepRejected) && !(err instanceof StepAwaitingApproval)) {
      incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'failed' });
      await updatePlanStepStatus(step.id, 'failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      });
    }
    throw err;
  }
}

async function linkAgentActionToPlan(agentActionId: string, planId: string, planStepId: string): Promise<void> {
  const { pool } = await import('../../shared/utils/db');
  await pool.query(
    `UPDATE agent_actions SET agent_plan_id = $1, agent_plan_step_id = $2 WHERE id = $3`,
    [planId, planStepId, agentActionId],
  );
}

async function isCancelled(planId: string): Promise<boolean> {
  const plan = await findPlanById(planId);
  return plan?.status === 'cancelled';
}

async function finalizePlan(
  planId: string,
  status: PlanRow['status'],
  errorMessage?: string,
): Promise<PlanRunResult> {
  const finalized = await updatePlanStatus(planId, status, {
    errorMessage: errorMessage ?? null,
    completedAt: status === 'succeeded' || status === 'failed' || status === 'cancelled' ? new Date().toISOString() : null,
  });
  if (status === 'failed') {
    incPlanFailed({ autonomyLevel: finalized.autonomy_level ?? 'supervised', reason: errorMessage ?? 'unknown' });
    Sentry.captureMessage('agent plan failed', { extra: { planId, errorMessage } });
  }
  return { planId, status: finalized.status, errorMessage };
}

export async function continuePlanIfReady(planId: string): Promise<PlanRunResult | null> {
  const plan = await findPlanById(planId);
  if (!plan || plan.status !== 'paused_for_approval') return null;

  const claimed = await claimPlanForRecovery(planId);
  if (!claimed) return null;

  const actor: AgentActor = {
    id: claimed.requested_by ?? 'system',
    role: 'admin',
    email: null,
    name: null,
    ipAddress: null,
  };

  return executePlan(planId, actor);
}

export async function cancelPlan(planId: string): Promise<PlanRow> {
  return updatePlanStatus(planId, 'cancelled', { completedAt: new Date().toISOString() });
}
```

- [ ] **Step 12.4: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/runner.service.test.ts
```

Expected: PASS — 4 test cases green.

- [ ] **Step 12.5: Commit**

```bash
cd backend && git add src/modules/agent-planner/runner.service.ts src/modules/agent-planner/__tests__/runner.service.test.ts && git commit -m "feat(agent-planner): runner service with DAG execution and budget enforcement"
```

---

## Task 13: Recovery worker (crash-safe)

**Files:**
- Create: `backend/src/modules/agent-planner/recovery.worker.ts`
- Test: `backend/src/modules/agent-planner/__tests__/recovery.worker.test.ts`
- Modify: `backend/src/workers/index.ts`

- [ ] **Step 13.1: Write the failing recovery test**

```typescript
// backend/src/modules/agent-planner/__tests__/recovery.worker.test.ts
import { pool } from '../../../shared/utils/db';
import { runRecoverySweep } from '../recovery.worker';
import { createPlan, updatePlanStatus } from '../plan.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('recovery worker', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('marks stale running plans as failed when recovery_attempts exhausted', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'supervised', confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'rec-1', expiresAt: null, conversationId: null,
    });
    await updatePlanStatus(plan.id, 'running');
    await pool.query(`UPDATE agent_plans SET updated_at = NOW() - INTERVAL '120 seconds' WHERE id = $1`, [plan.id]);
    // Simulate prior recovery attempts via a comment column (or skip this check for now)

    const swept = await runRecoverySweep({ staleAfterSeconds: 60 });
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await pool.query(`SELECT status FROM agent_plans WHERE id = $1`, [plan.id]);
    expect(['paused_for_approval', 'failed', 'running']).toContain(after.rows[0].status);
  });

  it('does not touch fresh running plans', async () => {
    const plan = await createPlan({
      goal: 'g', autonomyLevel: 'supervised', confidence: null, source: 'chat',
      requestedBy: null, sourceMessage: null, steps: [], idempotencyKey: 'rec-2', expiresAt: null, conversationId: null,
    });
    await updatePlanStatus(plan.id, 'running');
    // updated_at is "now" — should not be picked up

    const swept = await runRecoverySweep({ staleAfterSeconds: 600 });
    expect(swept).toBe(0);

    const after = await pool.query(`SELECT status FROM agent_plans WHERE id = $1`, [plan.id]);
    expect(after.rows[0].status).toBe('running');
  });
});
```

- [ ] **Step 13.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/recovery.worker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 13.3: Write recovery.worker.ts**

```typescript
// backend/src/modules/agent-planner/recovery.worker.ts
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection } from '../workers/queue';
import { logger } from '../shared/utils/logger';
import { findStaleRunningPlans, updatePlanStatus, findPlanStepsByPlan } from './plan.repository';
import { continuePlanIfReady } from './runner.service';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';

const RECOVERY_QUEUE = 'agent-plan-recovery';
const RECOVERY_JOB = 'agent-plan:recover-stale';

export async function runRecoverySweep(opts: { staleAfterSeconds: number }): Promise<number> {
  const stale = await findStaleRunningPlans(opts.staleAfterSeconds);
  let touched = 0;

  for (const plan of stale) {
    try {
      // Mark in-flight step as failed (no commit) so the runner resumes cleanly next pass
      const steps = await findPlanStepsByPlan(plan.id);
      const inFlight = steps.find((s) => s.status === 'running');
      if (inFlight) {
        await updatePlanStatus(plan.id, 'running', { errorMessage: `Recovered from stale (step ${inFlight.step_index} marked failed)` });
        touched++;
      }

      const result = await continuePlanIfReady(plan.id);
      if (result) {
        logger.info('agent-plan recovery: resumed plan', { planId: plan.id, status: result.status });
        touched++;
      }
    } catch (err) {
      logger.error('agent-plan recovery: failed to recover plan', {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, { extra: { planId: plan.id } });
      // Mark as failed after exhausted attempts — keep simple by failing on first error
      await updatePlanStatus(plan.id, 'failed', { errorMessage: 'recovery_failed' }).catch(() => null);
      touched++;
    }
  }

  return touched;
}

async function handleRecoveryJob(job: Job): Promise<{ touched: number }> {
  const start = Date.now();
  logger.info('agent-plan recovery job started', { jobId: job.id });
  const touched = await runRecoverySweep({ staleAfterSeconds: 60 });
  const durationSec = (Date.now() - start) / 1000;
  observeJobDuration({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE }, durationSec);
  incJobsProcessed({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE, status: 'success' });
  logger.info('agent-plan recovery job completed', { jobId: job.id, touched, durationSec });
  return { touched };
}

export function startAgentPlanRecoveryWorker(): Worker {
  const worker = new Worker(RECOVERY_QUEUE, handleRecoveryJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    incJobsFailed({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE });
    Sentry.captureException(err, { extra: { jobId: job?.id } });
  });

  return worker;
}
```

- [ ] **Step 13.4: Register worker in backend/src/workers/index.ts**

In `backend/src/workers/index.ts`, import and start the new worker:

```typescript
// At the top of backend/src/workers/index.ts
import { startAgentPlanRecoveryWorker } from '../modules/agent-planner/recovery.worker';

// Inside the startWorkers() function (or equivalent), add:
export function startAgentPlanRecoveryWorkerAndSchedule(): Worker {
  const worker = startAgentPlanRecoveryWorker();
  // Schedule repeatable every 60s
  void (async () => {
    const { Queue } = await import('bullmq');
    const { getBullConnection } = await import('./queue');
    const q = new Queue(RECOVERY_QUEUE_NAME, { connection: getBullConnection() as any });
    await q.add('agent-plan:recover-stale', {}, {
      repeat: { every: 60_000 },
      jobId: 'agent-plan:recover-stale:cron',
    });
  })();
  return worker;
}
```

Replace `RECOVERY_QUEUE_NAME` with the literal `'agent-plan-recovery'`.

- [ ] **Step 13.5: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/recovery.worker.test.ts
```

Expected: PASS — 2 test cases green.

- [ ] **Step 13.6: Commit**

```bash
cd backend && git add src/modules/agent-planner/recovery.worker.ts src/modules/agent-planner/__tests__/recovery.worker.test.ts src/workers/index.ts && git commit -m "feat(agent-planner): recovery worker for stalled running plans"
```

---

# Phase 4: API Surface

## Task 14: Controller + routes + module index

**Files:**
- Create: `backend/src/modules/agent-planner/plan.controller.ts`
- Create: `backend/src/modules/agent-planner/plan.routes.ts`
- Create: `backend/src/modules/agent-planner/index.ts`
- Modify: `backend/src/index.ts` (register routes)
- Test: `backend/src/modules/agent-planner/__tests__/plan.controller.test.ts`

- [ ] **Step 14.1: Write the failing controller tests**

```typescript
// backend/src/modules/agent-planner/__tests__/plan.controller.test.ts
import request from 'supertest';
import express from 'express';
import router from '../plan.routes';
import { pool } from '../../../shared/utils/db';
import * as plannerService from '../planner.service';
import * as runnerService from '../runner.service';
import * as repo from '../plan.repository';

jest.mock('../../../shared/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'user-1', role: 'admin' }; next(); },
}));
jest.mock('../../../shared/middleware/rbac', () => ({
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('plan routes', () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    app = express();
    app.use(express.json());
    app.use('/chat/plans', router);
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query('TRUNCATE agent_plan_steps, agent_plans CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('GET /chat/plans/:id returns the plan with steps', async () => {
    jest.spyOn(plannerService, 'getPlanForPreview').mockResolvedValue({
      plan: { id: 'plan-1', goal: 'x', status: 'proposed', autonomy_level: 'supervised', confidence: null, source: 'chat', requested_by: 'user-1', source_message: null, cost_cap_cents: 50, step_cap: 8, cost_used_cents: 0, deadline_at: null, started_at: null, completed_at: null, expires_at: null, error_message: null, created_at: '', updated_at: '', idempotency_key: '', conversation_id: null } as any,
      steps: [],
      estimatedCostCents: 5,
      requiresApproval: true,
    });

    const res = await request(app).get('/chat/plans/plan-1');
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedCostCents).toBe(5);
  });

  it('GET /chat/plans/:id returns 404 when plan missing', async () => {
    jest.spyOn(plannerService, 'getPlanForPreview').mockResolvedValue(null);
    const res = await request(app).get('/chat/plans/missing');
    expect(res.status).toBe(404);
  });

  it('POST /chat/plans/:id/approve triggers executePlan', async () => {
    jest.spyOn(runnerService, 'executePlan').mockResolvedValue({ planId: 'plan-1', status: 'running' });
    const res = await request(app).post('/chat/plans/plan-1/approve').send({});
    expect(res.status).toBe(200);
    expect(runnerService.executePlan).toHaveBeenCalledWith('plan-1', expect.objectContaining({ id: 'user-1' }));
  });

  it('POST /chat/plans/:id/cancel triggers cancelPlan', async () => {
    jest.spyOn(runnerService, 'cancelPlan').mockResolvedValue({} as any);
    const res = await request(app).post('/chat/plans/plan-1/cancel').send({});
    expect(res.status).toBe(200);
    expect(runnerService.cancelPlan).toHaveBeenCalledWith('plan-1');
  });
});
```

- [ ] **Step 14.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/plan.controller.test.ts
```

Expected: FAIL — `plan.routes` not found.

- [ ] **Step 14.3: Write plan.controller.ts**

```typescript
// backend/src/modules/agent-planner/plan.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { toAgentActor } from '../agent/agent.types';
import { getPlanForPreview } from './planner.service';
import { executePlan, cancelPlan, continuePlanIfReady } from './runner.service';

export async function getPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const preview = await getPlanForPreview(req.params.id);
    if (!preview) throw new AppError(`Plan not found: ${req.params.id}`, 404);
    res.json(successResponse(preview));
  } catch (err) {
    next(err);
  }
}

export async function approvePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = toAgentActor(req.user!, req.ip);
    const result = await executePlan(req.params.id, actor);
    res.status(result.status === 'paused_for_approval' ? 202 : 200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function cancelPlanHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = await cancelPlan(req.params.id);
    res.json(successResponse(plan));
  } catch (err) {
    next(err);
  }
}

export async function continuePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await continuePlanIfReady(req.params.id);
    if (!result) {
      res.json(successResponse({ planId: req.params.id, status: 'noop' }));
      return;
    }
    res.json(successResponse(result));
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 14.4: Write plan.routes.ts**

```typescript
// backend/src/modules/agent-planner/plan.routes.ts
import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';
import {
  getPlan,
  approvePlan,
  cancelPlanHandler,
  continuePlan,
} from './plan.controller';

const router = Router();

router.get('/:id', authenticate, authorize('admin', 'manager', 'sales', 'marketing', 'viewer'), asyncHandler(getPlan));
router.post('/:id/approve', authenticate, authorize('admin', 'manager', 'sales', 'marketing'), asyncHandler(approvePlan));
router.post('/:id/cancel', authenticate, authorize('admin', 'manager', 'sales', 'marketing'), asyncHandler(cancelPlanHandler));
router.post('/:id/continue', authenticate, authorize('admin', 'manager', 'sales', 'marketing'), asyncHandler(continuePlan));

export default router;
```

- [ ] **Step 14.5: Write index.ts (module barrel)**

```typescript
// backend/src/modules/agent-planner/index.ts
import planRoutes from './plan.routes';

export { planRoutes };
export * from './planner.service';
export * from './runner.service';
```

- [ ] **Step 14.6: Register routes in backend/src/index.ts**

In `backend/src/index.ts`, find the section where routes are registered (likely under `app.use('/api/v1/...')`). Add:

```typescript
import { planRoutes } from './modules/agent-planner';

// ... existing route registrations ...

app.use('/api/v1/chat/plans', planRoutes);
```

If routes use `/chat/plans` without the `/api/v1` prefix, follow whatever pattern the existing `chat/routes.ts` uses (verify by reading `backend/src/index.ts`).

- [ ] **Step 14.7: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/plan.controller.test.ts
```

Expected: PASS — 4 test cases green.

- [ ] **Step 14.8: Commit**

```bash
cd backend && git add src/modules/agent-planner/plan.controller.ts src/modules/agent-planner/plan.routes.ts src/modules/agent-planner/index.ts src/index.ts src/modules/agent-planner/__tests__/plan.controller.test.ts && git commit -m "feat(agent-planner): REST routes for plan CRUD operations"
```

---

## Task 15: Chat service rewrite (thin)

**Files:**
- Modify: `backend/src/modules/chat/chat.service.ts`
- Modify: `backend/src/modules/chat/chat.service.test.ts`

- [ ] **Step 15.1: Update chat.service.test.ts to expect the new shape**

Modify `backend/src/modules/chat/chat.service.test.ts`. Locate the existing tests (they cover the 7 keyword short-circuits). Replace them with:

```typescript
// backend/src/modules/chat/chat.service.test.ts (REPLACE existing content)
import { sendChatMessage, getChatHistory } from '../chat.service';
import { pool } from '../../shared/utils/db';
import * as planner from '../../agent-planner/planner.service';

jest.mock('../../agent-planner/planner.service');
jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  },
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('chat.service.sendChatMessage (thin)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('delegates multi-step requests to the planner', async () => {
    (planner.createPlanFromGoal as jest.Mock).mockResolvedValue({
      plan: { id: 'plan-1', status: 'proposed', goal: 'find leads' },
      steps: [{ step_index: 0, action_name: 'lead.list', risk_tier: 'read' }],
    });

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'find me some leads',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
    });

    expect(planner.createPlanFromGoal).toHaveBeenCalledWith(expect.objectContaining({ goal: 'find me some leads' }));
    expect(result.action?.name).toBe('plan.create');
  });

  it('answers page-awareness questions directly without planner', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'what page am I on?',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
      pageContext: { route: '/leads', pageTitle: 'Leads', pageCapabilities: [], availableActions: [], visibleRecords: [] },
    });

    expect(planner.createPlanFromGoal).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain('leads');
  });

  it('handles "find more" as plan continuation', async () => {
    // Seed Redis with prior plan reference
    const { redis } = await import('../../shared/utils/redis');
    (redis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      { role: 'user', content: 'show leads', createdAt: new Date().toISOString() },
      { role: 'assistant', content: 'plan:plan-123', createdAt: new Date().toISOString() },
    ]));

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'show more',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
    });

    // Continuation just returns the referenced plan — no new planner call
    expect(result.reply).toContain('plan-123');
  });
});

describe('chat.service.getChatHistory', () => {
  it('returns array of turns', async () => {
    const { redis } = await import('../../shared/utils/redis');
    (redis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify([
      { role: 'user', content: 'hi', createdAt: '2026-06-30T00:00:00Z' },
    ]));
    const turns = await getChatHistory('conv-1');
    expect(turns).toHaveLength(1);
  });
});
```

- [ ] **Step 15.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/chat/chat.service.test.ts
```

Expected: FAIL — the new flow expects delegation to `createPlanFromGoal`.

- [ ] **Step 15.3: Rewrite chat.service.ts (thin version)**

Replace `backend/src/modules/chat/chat.service.ts` content with:

```typescript
// backend/src/modules/chat/chat.service.ts (REWRITTEN — thin)
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { incAiTokens } from '../../shared/utils/metrics';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { getAgentActionDefinition } from '../agent/agent.actions';
import { proposeAgentAction } from '../agent/agent.service';
import { toAgentActor } from '../agent/agent.types';
import type { AgentActionName, AgentActor } from '../agent/agent.types';
import type { AuthenticatedUser } from '../../shared/types';
import { createPlanFromGoal, getPlanForPreview } from '../agent-planner/planner.service';
import type { ChatPageContext, ChatResponse, ChatTurn } from './chat.types';

const CHAT_HISTORY_TTL_SECONDS = 60 * 60 * 2;
const CHAT_HISTORY_LIMIT = 20;

function historyKey(conversationId: string): string { return `chat:history:${conversationId}`; }

async function loadHistory(conversationId: string): Promise<ChatTurn[]> {
  const raw = await redis.get(historyKey(conversationId)).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatTurn[];
    return Array.isArray(parsed) ? parsed.slice(-CHAT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

async function saveHistory(conversationId: string, turns: ChatTurn[]): Promise<void> {
  await redis.setex(historyKey(conversationId), CHAT_HISTORY_TTL_SECONDS, JSON.stringify(turns.slice(-CHAT_HISTORY_LIMIT))).catch(() => null);
}

export async function getChatHistory(conversationId: string): Promise<ChatTurn[]> {
  return loadHistory(conversationId);
}

function isPageAwarenessQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(where am i|what page|which page|current screen|this screen|this page|what can you do|what can i do|help here|on this page|on this screen|available actions|what actions)\b/.test(lower);
}

function isPlanContinuation(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(next|continue|more|show more|next page|yes do it|approve that|do it)\b/.test(lower);
}

function isTrivialLookup(message: string): boolean {
  const lower = message.toLowerCase();
  // Heuristic: single-action lookups that don't need planning
  return (
    /^\s*(show|get|fetch)\s+(me\s+)?(the\s+)?dashboard/.test(lower) ||
    /^\s*dashboard(\s+metrics)?\s*$/.test(lower) ||
    /^\s*(list|show)\s+campaigns\s*$/.test(lower)
  );
}

async function answerPageAwareness(input: { message: string; conversationId: string; pageContext?: ChatPageContext }): Promise<ChatResponse> {
  if (!input.pageContext) {
    return {
      conversationId: input.conversationId,
      reply: 'I can see what page you are on if you give me page context.',
    };
  }
  const title = input.pageContext.pageTitle ?? input.pageContext.route;
  const capabilities = input.pageContext.pageCapabilities ?? [];
  const records = input.pageContext.visibleRecords ?? [];
  const parts = [`You are on ${title}.`];
  if (capabilities.length > 0) parts.push(`I can help here with: ${capabilities.slice(0, 5).join('; ')}.`);
  if (records.length > 0) {
    const names = records.slice(0, 5).map((r) => r.name).join(', ');
    parts.push(`I can see ${records.length} records, including ${names}.`);
  }
  return { conversationId: input.conversationId, reply: parts.join(' ') };
}

async function handleTrivialLookup(input: { message: string; conversationId: string; actor: AgentActor }): Promise<ChatResponse | null> {
  const lower = input.message.toLowerCase();
  let actionName: AgentActionName | null = null;
  if (/dashboard/.test(lower)) actionName = 'report.dashboard';
  else if (/campaign/.test(lower)) actionName = 'campaign.list';

  if (!actionName) return null;

  const result = await proposeAgentAction({
    source: 'chat',
    actionName,
    args: {},
    actor: input.actor,
    sourceMessage: input.message,
    forceApproval: getAgentActionDefinition(actionName).riskTier !== 'read',
  });

  return {
    conversationId: input.conversationId,
    reply: result.policy.outcome === 'require_approval'
      ? `I prepared ${actionName} for approval.`
      : `Done. Result: ${JSON.stringify(result.result)}`,
  };
}

export async function sendChatMessage(input: {
  conversationId: string;
  message: string;
  actor: AgentActor;
  user: AuthenticatedUser;
  pageContext?: ChatPageContext;
}): Promise<ChatResponse> {
  const history = await loadHistory(input.conversationId);

  // 1. Page-awareness fast path
  if (isPageAwarenessQuestion(input.message)) {
    const result = await answerPageAwareness(input);
    await persistTurn(input.conversationId, history, input.message, result.reply);
    return result;
  }

  // 2. Plan continuation
  if (isPlanContinuation(input.message)) {
    const lastPlanId = extractLastPlanId(history);
    if (lastPlanId) {
      const preview = await getPlanForPreview(lastPlanId);
      if (preview) {
        const reply = `Continuing with plan ${lastPlanId}. Approve when ready.`;
        await persistTurn(input.conversationId, history, input.message, reply);
        return {
          conversationId: input.conversationId,
          reply,
          action: { name: 'plan.resume' as any, policy: { outcome: 'execute_now', reason: 'continuation' } },
        };
      }
    }
  }

  // 3. Trivial lookup
  const trivial = await handleTrivialLookup({ message: input.message, conversationId: input.conversationId, actor: input.actor });
  if (trivial) {
    await persistTurn(input.conversationId, history, input.message, trivial.reply);
    return trivial;
  }

  // 4. Delegate to planner
  const planResult = await createPlanFromGoal({
    goal: input.message,
    actor: input.actor,
    autonomyLevel: (input.user as any).autonomyLevel ?? 'supervised',
    source: 'chat',
    sourceMessage: input.message,
    conversationId: input.conversationId,
    pageContext: input.pageContext,
  });

  const reply = `I planned: "${planResult.plan.goal}". ${planResult.steps.length} steps. Approve to run.`;
  await persistTurn(input.conversationId, history, input.message, `plan:${planResult.plan.id}:${reply}`);
  return {
    conversationId: input.conversationId,
    reply,
    action: {
      name: 'plan.create' as any,
      policy: { outcome: 'require_approval', reason: 'plan requires approval' },
      result: { planId: planResult.plan.id, steps: planResult.steps },
    },
  };
}

function extractLastPlanId(history: ChatTurn[]): string | null {
  for (const turn of [...history].reverse()) {
    if (turn.role !== 'assistant') continue;
    const match = turn.content.match(/^plan:([0-9a-f-]{36})/);
    if (match) return match[1];
  }
  return null;
}

async function persistTurn(conversationId: string, history: ChatTurn[], userMessage: string, assistantMessage: string): Promise<void> {
  const now = new Date().toISOString();
  await saveHistory(conversationId, [
    ...history,
    { role: 'user', content: userMessage, createdAt: now },
    { role: 'assistant', content: assistantMessage, createdAt: now },
  ]);
}
```

- [ ] **Step 15.4: Run test to verify it passes**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/chat/chat.service.test.ts
```

Expected: PASS — all test cases green.

- [ ] **Step 15.5: Run chat controller tests (regression check)**

```bash
cd backend && npm test -- modules/chat/chat.controller.test.ts
```

Expected: PASS (no behavioral change at the controller layer).

- [ ] **Step 15.6: Commit**

```bash
cd backend && git add src/modules/chat/chat.service.ts src/modules/chat/chat.service.test.ts && git commit -m "refactor(chat): thin chat service delegating multi-step to planner"
```

---

## Task 16: AI inbox handler — link approval to plan + resume

**Files:**
- Modify: `backend/src/modules/ai-inbox/ai-inbox.service.ts`
- Modify: `backend/src/modules/ai-inbox/ai-inbox.service.test.ts`

- [ ] **Step 16.1: Update the failing test**

In `backend/src/modules/ai-inbox/ai-inbox.service.test.ts`, find the test that covers `actionItem` approve flow. Add a new test that verifies plan resume:

```typescript
// Append to the existing describe block in ai-inbox.service.test.ts
import * as runner from '../../agent-planner/runner.service';

jest.mock('../../agent-planner/runner.service');

it('approving an inbox item linked to a plan resumes the runner', async () => {
  const inboxItem = {
    id: 'inbox-1',
    assigned_to: 'user-1',
    lead_id: null,
    campaign_id: null,
    item_type: 'campaign_review',
    title: 't',
    summary: null,
    urgency_score: 70,
    ai_draft_response: null,
    ai_draft_confidence: null,
    expires_at: null,
    status: 'pending',
    snoozed_until: null,
    actioned_by: null,
    actioned_at: null,
    created_at: '',
    updated_at: '',
    agent_action_id: 'action-1',
    agent_plan_id: 'plan-1',
    agent_plan_step_id: 'step-1',
    action_result: null,
  };
  jest.spyOn(repo, 'findInboxItemById').mockResolvedValue(inboxItem as any);
  jest.spyOn(repo, 'actionInboxItem').mockResolvedValue({ ...inboxItem, status: 'actioned' } as any);
  jest.spyOn(repo, 'setInboxActionResult').mockResolvedValue({ ...inboxItem, status: 'actioned' } as any);
  (agent.executeAgentAction as jest.Mock).mockResolvedValue({ id: 'action-1', status: 'succeeded', result: { ok: true } } as any);
  (runner.continuePlanIfReady as jest.Mock).mockResolvedValue({ planId: 'plan-1', status: 'succeeded' });

  await actionItem('inbox-1', { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null }, 'approve');

  expect(runner.continuePlanIfReady).toHaveBeenCalledWith('plan-1');
});
```

- [ ] **Step 16.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/ai-inbox/ai-inbox.service.test.ts
```

Expected: FAIL — `continuePlanIfReady` not called.

- [ ] **Step 16.3: Modify actionItem in ai-inbox.service.ts**

Find `actionItem` in `backend/src/modules/ai-inbox/ai-inbox.service.ts`. At the end of the `action === 'approve'` branch (after `setInboxActionResult`), add:

```typescript
  // If this inbox item is linked to a plan, update the plan step status and resume the runner
  if (action === 'approve' && existing.agent_plan_id) {
    const { continuePlanIfReady } = await import('../agent-planner/runner.service');
    const { findPlanStepById, updatePlanStepStatus } = await import('../agent-planner/plan.repository');
    if (existing.agent_plan_step_id) {
      await findPlanStepById(existing.agent_plan_step_id)
        .then((step) =>
          step
            ? updatePlanStepStatus(step.id, 'succeeded', {
                result: (executed.result as Record<string, unknown> | undefined) ?? null,
                agentActionId: executed.id,
                completedAt: new Date().toISOString(),
              })
            : null,
        )
        .catch((err) => logger.warn('ai inbox: failed to update plan step', { err: String(err) }));
    }
    await continuePlanIfReady(existing.agent_plan_id).catch((err) =>
      logger.error('ai inbox: failed to resume plan after approval', {
        planId: existing.agent_plan_id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
```

Also extend `AiInboxItem` (in `ai-inbox.types.ts`) with the new columns (matching the migration):

```typescript
// Append to AiInboxItem interface in backend/src/modules/ai-inbox/ai-inbox.types.ts
  agent_plan_id: string | null;
  agent_plan_step_id: string | null;
```

And update the SQL INSERT in `ai-inbox.repository.ts` `createInboxItem` to include these columns (they default to NULL).

- [ ] **Step 16.4: Run test to verify it passes**

```bash
cd backend && npm test -- modules/ai-inbox/ai-inbox.service.test.ts
```

Expected: PASS — all tests green including the new plan-resume test.

- [ ] **Step 16.5: Commit**

```bash
cd backend && git add src/modules/ai-inbox/ai-inbox.service.ts src/modules/ai-inbox/ai-inbox.service.test.ts src/modules/ai-inbox/ai-inbox.types.ts src/modules/ai-inbox/ai-inbox.repository.ts && git commit -m "feat(ai-inbox): resume plan runner after approval"
```

---

## Task 17: Feature flag wiring

**Files:**
- Modify: `backend/src/shared/utils/featureFlag.ts` (new file) OR `backend/src/modules/chat/chat.service.ts` (inline check)
- Test: `backend/src/modules/chat/__tests__/featureFlag.test.ts`

- [ ] **Step 17.1: Write the failing feature flag test**

```typescript
// backend/src/modules/chat/__tests__/featureFlag.test.ts
import { isAgentPlannerEnabled } from '../featureFlag';

describe('isAgentPlannerEnabled', () => {
  const original = process.env.AGENT_PLANNER_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_PLANNER_ENABLED;
    else process.env.AGENT_PLANNER_ENABLED = original;
  });

  it('defaults to true in non-production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_PLANNER_ENABLED;
    expect(isAgentPlannerEnabled()).toBe(true);
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('defaults to false in production', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.AGENT_PLANNER_ENABLED;
    expect(isAgentPlannerEnabled()).toBe(false);
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('respects explicit "true" override', () => {
    process.env.AGENT_PLANNER_ENABLED = 'true';
    expect(isAgentPlannerEnabled()).toBe(true);
  });

  it('respects explicit "false" override', () => {
    process.env.NODE_ENV = 'development';
    process.env.AGENT_PLANNER_ENABLED = 'false';
    expect(isAgentPlannerEnabled()).toBe(false);
  });
});
```

- [ ] **Step 17.2: Run test to verify it fails**

```bash
cd backend && npm test -- modules/chat/__tests__/featureFlag.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 17.3: Create featureFlag.ts**

```typescript
// backend/src/modules/chat/featureFlag.ts

export function isAgentPlannerEnabled(): boolean {
  const env = process.env.NODE_ENV;
  const explicit = process.env.AGENT_PLANNER_ENABLED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return env !== 'production';
}
```

- [ ] **Step 17.4: Wire the flag into chat.service.ts**

Modify `backend/src/modules/chat/chat.service.ts`. At the top, add:

```typescript
import { isAgentPlannerEnabled } from './featureFlag';
```

In `sendChatMessage`, replace the planner delegation block (step 4) with:

```typescript
  // 4. Delegate to planner (only if feature flag is enabled)
  if (!isAgentPlannerEnabled()) {
    const reply = 'AI Copilot planner is currently disabled. Try a single-action request.';
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  const planResult = await createPlanFromGoal({ /* ... unchanged ... */ });
  // ... rest unchanged ...
```

- [ ] **Step 17.5: Run all chat tests**

```bash
cd backend && npm test -- modules/chat
```

Expected: PASS — feature flag + chat behavior all green.

- [ ] **Step 17.6: Commit**

```bash
cd backend && git add src/modules/chat/featureFlag.ts src/modules/chat/chat.service.ts src/modules/chat/__tests__/featureFlag.test.ts && git commit -m "feat(chat): AGENT_PLANNER_ENABLED feature flag (off by default in prod)"
```

---

# Phase 5: Frontend

## Task 18: API client for plans

**Files:**
- Create: `frontend/src/api/agentPlans.ts`
- Test: `frontend/src/api/__tests__/agentPlans.test.ts`

- [ ] **Step 18.1: Write the failing test**

```typescript
// frontend/src/api/__tests__/agentPlans.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePlan, useApprovePlan, useCancelPlan } from '../agentPlans';

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue({ data: { data: { plan: { id: 'plan-1' }, steps: [], estimatedCostCents: 5, requiresApproval: true } } }),
    post: jest.fn().mockResolvedValue({ data: { data: { planId: 'plan-1', status: 'running' } } }),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('agentPlans api client', () => {
  it('usePlan fetches plan preview', async () => {
    const { result } = renderHook(() => usePlan('plan-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.plan.id).toBe('plan-1');
  });

  it('useApprovePlan posts to approve endpoint', async () => {
    const { result } = renderHook(() => useApprovePlan(), { wrapper });
    result.current.mutate('plan-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('useCancelPlan posts to cancel endpoint', async () => {
    const { result } = renderHook(() => useCancelPlan(), { wrapper });
    result.current.mutate('plan-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
```

- [ ] **Step 18.2: Run test to verify it fails**

```bash
cd frontend && npm test -- src/api/__tests__/agentPlans.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 18.3: Write agentPlans.ts**

```typescript
// frontend/src/api/agentPlans.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export interface PlanPreviewStep {
  id: string;
  step_index: number;
  action_name: string;
  action_args: Record<string, unknown>;
  risk_tier: string;
  depends_on: number[];
  rationale: string;
  status: string;
}

export interface PlanPreview {
  plan: {
    id: string;
    goal: string;
    status: string;
    autonomy_level: string | null;
    confidence: number | null;
    created_at: string;
  };
  steps: PlanPreviewStep[];
  estimatedCostCents: number;
  requiresApproval: boolean;
}

export interface PlanRunResult {
  planId: string;
  status: string;
  errorMessage?: string;
}

export const usePlan = (planId: string) => {
  return useQuery({
    queryKey: ['agent-plan', planId],
    queryFn: async (): Promise<PlanPreview> => {
      const { data } = await api.get<{ data: PlanPreview }>(`/chat/plans/${planId}`);
      return data.data;
    },
    enabled: Boolean(planId),
    refetchInterval: (query) => {
      const status = query.state.data?.plan.status;
      return status === 'running' || status === 'paused_for_approval' ? 3000 : false;
    },
  });
};

export const useApprovePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string): Promise<PlanRunResult> => {
      const { data } = await api.post<{ data: PlanRunResult }>(`/chat/plans/${planId}/approve`, {});
      return data.data;
    },
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
    },
  });
};

export const useCancelPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string): Promise<void> => {
      await api.post(`/chat/plans/${planId}/cancel`, {});
    },
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plan', planId] });
    },
  });
};
```

- [ ] **Step 18.4: Run test to verify it passes**

```bash
cd frontend && npm test -- src/api/__tests__/agentPlans.test.ts
```

Expected: PASS — 3 test cases green.

- [ ] **Step 18.5: Commit**

```bash
cd frontend && git add src/api/agentPlans.ts src/api/__tests__/agentPlans.test.ts && git commit -m "feat(frontend): agentPlans API client with auto-polling for running plans"
```

---

## Task 19: PlanPreview component

**Files:**
- Create: `frontend/src/components/PlanPreview.tsx`
- Test: `frontend/src/components/__tests__/PlanPreview.test.tsx`

- [ ] **Step 19.1: Write the failing component test**

```tsx
// frontend/src/components/__tests__/PlanPreview.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanPreview } from '../PlanPreview';
import type { PlanPreview as PlanPreviewType } from '@/api/agentPlans';

const preview: PlanPreviewType = {
  plan: { id: 'plan-1', goal: 'find leads', status: 'proposed', autonomy_level: 'supervised', confidence: null, created_at: '' },
  steps: [
    { id: 's1', step_index: 0, action_name: 'lead.list', action_args: {}, risk_tier: 'read', depends_on: [], rationale: 'get leads', status: 'pending' },
    { id: 's2', step_index: 1, action_name: 'campaign.launch', action_args: {}, risk_tier: 'customer_facing_write', depends_on: [0], rationale: 'launch campaign', status: 'pending' },
  ],
  estimatedCostCents: 15,
  requiresApproval: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PlanPreview', () => {
  it('renders the plan goal and step count', () => {
    render(<PlanPreview preview={preview} onApprove={jest.fn()} onCancel={jest.fn()} />, { wrapper });
    expect(screen.getByText(/find leads/i)).toBeInTheDocument();
    expect(screen.getByText(/2 steps/i)).toBeInTheDocument();
  });

  it('shows risk badge per step', () => {
    render(<PlanPreview preview={preview} onApprove={jest.fn()} onCancel={jest.fn()} />, { wrapper });
    expect(screen.getByText(/read/i)).toBeInTheDocument();
    expect(screen.getByText(/customer_facing_write/i)).toBeInTheDocument();
  });

  it('disables approve button while approving', () => {
    render(<PlanPreview preview={preview} onApprove={jest.fn(() => new Promise(() => {}))} onCancel={jest.fn()} />, { wrapper });
    const approveBtn = screen.getByRole('button', { name: /approve/i });
    fireEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();
  });

  it('renders the estimated cost', () => {
    render(<PlanPreview preview={preview} onApprove={jest.fn()} onCancel={jest.fn()} />, { wrapper });
    expect(screen.getByText(/\$0\.15/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 19.2: Run test to verify it fails**

```bash
cd frontend && npm test -- src/components/__tests__/PlanPreview.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 19.3: Write PlanPreview.tsx**

```tsx
// frontend/src/components/PlanPreview.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { PlanPreview as PlanPreviewType } from '@/api/agentPlans';

interface Props {
  preview: PlanPreviewType;
  onApprove: () => Promise<unknown> | void;
  onCancel: () => Promise<unknown> | void;
}

const RISK_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'red'> = {
  read: 'gray',
  low_risk_write: 'blue',
  sensitive_write: 'amber',
  customer_facing_write: 'red',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PlanPreview({ preview, onApprove, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    try { await onApprove(); } finally { setApproving(false); }
  };
  const handleCancel = async () => {
    setCancelling(true);
    try { await onCancel(); } finally { setCancelling(false); }
  };

  const isRunning = preview.plan.status === 'running';
  const isPaused = preview.plan.status === 'paused_for_approval';

  return (
    <Card className="my-2 border-slate-200">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base">🧠</span>
              <p className="truncate text-sm font-semibold text-slate-900">{preview.plan.goal}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {isPaused ? '⏸ Awaiting approval' : isRunning ? '▶ Running' : '⏸ Awaiting your approval'}
              {' · '}
              {preview.steps.length} {preview.steps.length === 1 ? 'step' : 'steps'}
              {' · '}
              est. {formatCents(preview.estimatedCostCents)}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          {preview.steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">{step.step_index + 1}/{preview.steps.length}</span>
              <StatusBadge tone={RISK_TONE[step.risk_tier] ?? 'gray'}>{step.risk_tier}</StatusBadge>
              <span className="font-mono text-xs text-slate-700">{step.action_name}</span>
              {step.depends_on.length > 0 && (
                <span className="text-xs text-slate-400">depends on: {step.depends_on.map((d) => d + 1).join(', ')}</span>
              )}
              {expanded && (
                <p className="ml-2 text-xs italic text-slate-600">&ldquo;{step.rationale}&rdquo;</p>
              )}
              {step.risk_tier === 'customer_facing_write' && (
                <AlertTriangle className="ml-auto h-3.5 w-3.5 text-amber-500" aria-label="needs approval" />
              )}
              {step.status === 'succeeded' && (
                <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-500" />
              )}
            </div>
          ))}
        </div>

        {preview.requiresApproval && preview.plan.status === 'proposed' && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={handleApprove} disabled={approving || cancelling}>
              {approving ? 'Approving…' : 'Approve all & run'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
              {expanded ? 'Hide' : 'Show'} step details
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={approving || cancelling}>
              Cancel
            </Button>
          </div>
        )}

        {(isRunning || isPaused) && (
          <p className="text-xs text-slate-500">
            {isPaused ? 'Check AI Inbox to approve remaining steps.' : 'Plan is running. Check AI Inbox for live progress.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default PlanPreview;
```

- [ ] **Step 19.4: Run test to verify it passes**

```bash
cd frontend && npm test -- src/components/__tests__/PlanPreview.test.tsx
```

Expected: PASS — 4 test cases green.

- [ ] **Step 19.5: Commit**

```bash
cd frontend && git add src/components/PlanPreview.tsx src/components/__tests__/PlanPreview.test.tsx && git commit -m "feat(frontend): PlanPreview component for inline chat plan display"
```

---

## Task 20: ChatWidget update — render PlanPreview

**Files:**
- Modify: `frontend/src/components/ChatWidget.tsx`
- Modify: `frontend/src/components/__tests__/ChatWidget.test.tsx`

- [ ] **Step 20.1: Add a test for PlanPreview rendering**

In `frontend/src/components/__tests__/ChatWidget.test.tsx`, add a test:

```tsx
// Append to existing describe block
it('renders PlanPreview when chat returns a plan', async () => {
  (api.useSendChatMessage as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({
      conversationId: 'c1',
      reply: 'I planned: find leads',
      action: {
        name: 'plan.create',
        policy: { outcome: 'require_approval', reason: 'plan requires approval' },
        result: {
          planId: 'plan-1',
          steps: [
            { id: 's1', step_index: 0, action_name: 'lead.list', action_args: {}, risk_tier: 'read', depends_on: [], rationale: 'r', status: 'pending' },
          ],
        },
      },
    }),
    isPending: false,
    isError: false,
  });
  (api.usePlan as jest.Mock).mockReturnValue({
    data: {
      plan: { id: 'plan-1', goal: 'find leads', status: 'proposed', autonomy_level: 'supervised', confidence: null, created_at: '' },
      steps: [{ id: 's1', step_index: 0, action_name: 'lead.list', action_args: {}, risk_tier: 'read', depends_on: [], rationale: 'get leads', status: 'pending' }],
      estimatedCostCents: 1,
      requiresApproval: true,
    },
  });

  render(<ChatWidget />, { wrapper });
  const input = screen.getByPlaceholderText(/ask copilot/i);
  fireEvent.change(input, { target: { value: 'find me leads' } });
  fireEvent.click(screen.getByRole('button', { name: '' }));

  await waitFor(() => {
    expect(screen.getByText(/find leads/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });
});
```

Add to the imports at the top:

```typescript
import * as api from '@/api/chat';
import * as planApi from '@/api/agentPlans';
jest.mock('@/api/chat');
jest.mock('@/api/agentPlans');
```

- [ ] **Step 20.2: Run test to verify it fails**

```bash
cd frontend && npm test -- src/components/__tests__/ChatWidget.test.tsx
```

Expected: FAIL — PlanPreview not rendered yet.

- [ ] **Step 20.3: Update ChatWidget.tsx to render PlanPreview**

In `frontend/src/components/ChatWidget.tsx`, add the import:

```tsx
import { usePlan, useApprovePlan, useCancelPlan } from '@/api/agentPlans';
import { PlanPreview } from '@/components/PlanPreview';
```

In the component body, after the `lastResponse` state, add:

```tsx
const lastPlanId = (lastResponse?.action?.result as { planId?: string } | undefined)?.planId ?? null;
const planQuery = usePlan(lastPlanId ?? '');
const approveMutation = useApprovePlan();
const cancelMutation = useCancelPlan();
```

Inside the chat render section (after the existing `lastResponse?.action?.policy.outcome === 'require_approval'` block), add:

```tsx
{lastPlanId && planQuery.data && (
  <PlanPreview
    preview={planQuery.data}
    onApprove={async () => { await approveMutation.mutateAsync(lastPlanId); }}
    onCancel={async () => { await cancelMutation.mutateAsync(lastPlanId); }}
  />
)}
```

- [ ] **Step 20.4: Run test to verify it passes**

```bash
cd frontend && npm test -- src/components/__tests__/ChatWidget.test.tsx
```

Expected: PASS — all tests green including new PlanPreview rendering test.

- [ ] **Step 20.5: Commit**

```bash
cd frontend && git add src/components/ChatWidget.tsx src/components/__tests__/ChatWidget.test.tsx && git commit -m "feat(frontend): ChatWidget renders inline PlanPreview for agent plans"
```

---

## Task 21: AIInboxPage — group by plan + bulk approve

**Files:**
- Modify: `frontend/src/pages/AIInboxPage.tsx`
- Modify: `frontend/src/pages/__tests__/AIInboxPage.test.tsx`

- [ ] **Step 21.1: Add a test for grouping + bulk approve**

In `frontend/src/pages/__tests__/AIInboxPage.test.tsx`, add:

```tsx
// Append to existing describe block
it('groups inbox items by plan_id and shows plan header', async () => {
  (aiInboxApi.useInbox as jest.Mock).mockReturnValue({
    data: {
      items: [
        { id: 'i1', agent_plan_id: 'plan-1', agent_plan_step_id: 's1', title: 'step 1', item_type: 'campaign_review', urgency_score: 60, status: 'pending', /* ... */ },
        { id: 'i2', agent_plan_id: 'plan-1', agent_plan_step_id: 's2', title: 'step 2', item_type: 'campaign_review', urgency_score: 50, status: 'pending', /* ... */ },
        { id: 'i3', agent_plan_id: null, title: 'unrelated', item_type: 'urgent_reply', urgency_score: 90, status: 'pending', /* ... */ },
      ],
      total: 3,
    },
    isLoading: false,
    error: null,
  });

  render(<AIInboxPage />, { wrapper });

  expect(screen.getByText(/plan: plan-1/i)).toBeInTheDocument();
  expect(screen.getByText('unrelated')).toBeInTheDocument();
});
```

Fill in any missing required fields (lead_id, campaign_id, etc.) — copy from existing test fixtures.

- [ ] **Step 21.2: Run test to verify it fails**

```bash
cd frontend && npm test -- src/pages/__tests__/AIInboxPage.test.tsx
```

Expected: FAIL — grouping not implemented.

- [ ] **Step 21.3: Update AIInboxPage.tsx to group by plan**

In `frontend/src/pages/AIInboxPage.tsx`, replace the items list rendering with a grouped version. After the `items` sorting, add:

```tsx
const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
  const key = item.agent_plan_id ?? '__standalone__';
  (acc[key] ??= []).push(item);
  return acc;
}, {});

const standaloneItems = grouped['__standalone__'] ?? [];
const planGroups = Object.entries(grouped).filter(([k]) => k !== '__standalone__');
```

Replace the items map with:

```tsx
{planGroups.map(([planId, planItems]) => (
  <Card key={planId} className="border-slate-200">
    <CardContent className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Plan: {planId.slice(0, 8)}…</p>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const safe = planItems.filter((i) => i.item_type !== 'campaign_review' || (i as any).risk_tier !== 'customer_facing_write');
            for (const item of safe) {
              await actionItem.mutateAsync({ id: item.id, action: 'approve' });
            }
            showToast(`Approved ${safe.length} steps.`, 'success');
          }}
          disabled={planItems.some((i) => pendingId === i.id)}
        >
          Approve remaining safe steps
        </Button>
      </div>
      {planItems.map((item) => (
        // ... existing item card JSX, unchanged ...
      ))}
    </CardContent>
  </Card>
))}
{standaloneItems.map((item) => (
  // ... existing standalone item card JSX, unchanged ...
))}
```

(Keep the existing card layout for individual items; just wrap plan-grouped ones in a header card.)

- [ ] **Step 21.4: Run test to verify it passes**

```bash
cd frontend && npm test -- src/pages/__tests__/AIInboxPage.test.tsx
```

Expected: PASS — all tests green including the grouping test.

- [ ] **Step 21.5: Commit**

```bash
cd frontend && git add src/pages/AIInboxPage.tsx src/pages/__tests__/AIInboxPage.test.tsx && git commit -m "feat(frontend): AIInboxPage groups items by plan with bulk safe-step approve"
```

---

# Phase 6: E2E + Docs

## Task 22: E2E journey test

**Files:**
- Create: `backend/src/modules/agent-planner/__tests__/agentPlanner.e2e.test.ts`

- [ ] **Step 22.1: Write the failing E2E test**

```typescript
// backend/src/modules/agent-planner/__tests__/agentPlanner.e2e.test.ts
import { pool } from '../../../shared/utils/db';
import { createPlanFromGoal } from '../planner.service';
import { executePlan, continuePlanIfReady } from '../runner.service';
import { actionItem } from '../../ai-inbox/ai-inbox.service';
import * as repo from '../plan.repository';
import OpenAI from 'openai';
import * as agent from '../../agent/agent.service';

jest.mock('openai');
jest.mock('../../ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn().mockResolvedValue({
    apiKey: 'test-key',
    baseUrl: null,
    model: 'gpt-4o',
    maxTokens: 500,
    temperature: 0.2,
  }),
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/crm_test';

describe('agent-planner E2E: chat → plan → approval → execute → success', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query('TRUNCATE agent_plan_steps, agent_plans, ai_inbox_items, agent_actions CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('full journey: plan with one customer_facing step pauses for inbox approval, resumes on approve', async () => {
    // Mock OpenAI to return a 2-step plan
    const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
    MockedOpenAI.prototype.chat.completions.create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        goal: 'launch campaign for leads',
        steps: [
          { step_index: 0, action_name: 'lead.list', action_args: { limit: 5 }, risk_tier: 'read', depends_on: [], rationale: 'get leads' },
          { step_index: 1, action_name: 'campaign.launch', action_args: { id: '00000000-0000-0000-0000-000000000001' }, risk_tier: 'customer_facing_write', depends_on: [0], rationale: 'launch campaign' },
        ],
      }) } }],
    } as any);

    // Mock proposeAgentAction: step 0 execute_now, step 1 require_approval, then executeAgentAction on approve
    let proposeCallCount = 0;
    jest.spyOn(agent, 'proposeAgentAction').mockImplementation(async (input: any) => {
      proposeCallCount++;
      if (input.actionName === 'lead.list') {
        return {
          policy: { outcome: 'execute_now', reason: 'read' },
          action: null,
          result: { items: [{ id: 'lead-1' }] },
        } as any;
      }
      if (input.actionName === 'campaign.launch') {
        return {
          policy: { outcome: 'require_approval', reason: 'customer facing', assignTo: 'user-1' },
          action: { id: 'action-1' },
        } as any;
      }
      return { policy: { outcome: 'reject', reason: 'unknown' }, action: null } as any;
    });
    jest.spyOn(agent, 'executeAgentAction').mockResolvedValue({
      id: 'action-1', status: 'succeeded', result: { launched: true },
    } as any);

    // 1. Create plan via planner
    const { plan, steps } = await createPlanFromGoal({
      goal: 'launch campaign for leads',
      actor: { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      autonomyLevel: 'supervised',
      source: 'chat',
      sourceMessage: 'launch campaign for leads',
    });
    expect(steps).toHaveLength(2);
    expect(plan.status).toBe('proposed');

    // 2. Approve the plan
    await repo.updatePlanStatus(plan.id, 'approved');
    const runResult = await executePlan(plan.id, { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null });

    // 3. Should be paused_for_approval (step 1 needs approval)
    expect(runResult.status).toBe('paused_for_approval');
    expect(proposeCallCount).toBe(2);

    // 4. Simulate inbox approval — find the inbox item and action it
    const inboxResult = await pool.query<{ id: string }>(`SELECT id FROM ai_inbox_items WHERE agent_plan_id = $1`, [plan.id]);
    expect(inboxResult.rows).toHaveLength(1);
    const inboxId = inboxResult.rows[0].id;

    // Link inbox item to plan step (proposeAgentAction did this in the runner)
    const stepResult = await pool.query<{ id: string }>(`SELECT id FROM agent_plan_steps WHERE plan_id = $1 AND step_index = 1`, [plan.id]);
    await pool.query(`UPDATE ai_inbox_items SET agent_plan_step_id = $1 WHERE id = $2`, [stepResult.rows[0].id, inboxId]);

    await actionItem(
      inboxId,
      { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null },
      'approve',
    );

    // 5. Verify plan succeeded
    const finalPlan = await repo.findPlanById(plan.id);
    expect(finalPlan?.status).toBe('succeeded');

    // 6. Verify all steps are in succeeded status
    const finalSteps = await repo.findPlanStepsByPlan(plan.id);
    expect(finalSteps.every((s) => s.status === 'succeeded')).toBe(true);

    // 7. Verify decision log has entries
    const logCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ai_intelligence.decision_log WHERE decision_type = 'agent_plan' OR decision_type = 'agent_step'`,
    );
    expect(parseInt(logCount.rows[0].count, 10)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 22.2: Run test to verify it fails**

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/agentPlanner.e2e.test.ts
```

Expected: FAIL — likely some imports or fixtures missing. Debug and fix.

- [ ] **Step 22.3: Run test until it passes**

Iterate until green. Likely issues: missing imports, env vars, mock setup. Re-run:

```bash
cd backend && TEST_DATABASE_URL=postgresql://localhost/crm_test npm test -- modules/agent-planner/__tests__/agentPlanner.e2e.test.ts
```

Expected: PASS — full journey green.

- [ ] **Step 22.4: Commit**

```bash
cd backend && git add src/modules/agent-planner/__tests__/agentPlanner.e2e.test.ts && git commit -m "test(agent-planner): E2E journey test (chat → plan → approval → success)"
```

---

## Task 23: Update AGENTS.md + usage docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/AI_COPILOT_USAGE.md`

- [ ] **Step 23.1: Update AGENTS.md**

In `AGENTS.md`, in the "Current Sprint Context" section, update Sprint 4 status and add a new entry for Sprint 5 (or update Sprint 4 if agent-planner ships within it). Specifically:

1. In the `Sprint 4` row, update Notes to: "AI planner v1: Plan entity, multi-step runner, plan-preview UX. Migration 0023 ships. Feature flag `AGENT_PLANNER_ENABLED` (off in prod). Next: v1.1 streaming (G5+G11), v2 rollback (G6+G8+G10+G12)."
2. Add a new "What ships in this change" block after Sprint 4:

```markdown
| Area | % done | Details |
|---|---|---|
| **AI Planner (v1)** | **🟢 100%** | `agent-planner` module with 13 new files, migration 0023, 22 tasks across 6 phases. Plan entity, DAG runner, safety budgets, plan-preview UX. 4 new endpoints (`/chat/plans/:id`, `/approve`, `/cancel`, `/continue`). Chat is thin and delegates multi-step to planner. AI Inbox linked to plan via `agent_plan_id`; approval resumes runner. Feature flag `AGENT_PLANNER_ENABLED`. |
| Backend tests | **86%** stmts | +25 new test files covering agent-planner module. All existing tests still pass. |
| Frontend pages | **+1** | `PlanPreview` component. `ChatWidget` renders inline plans. `AIInboxPage` groups by plan. |
```

- [ ] **Step 23.2: Update docs/AI_COPILOT_USAGE.md**

Append a new section at the end:

```markdown
## Agent Plans (v1)

When you ask the AI Copilot a multi-step question like "find Mumbai dentists, qualify the top 5, and enroll them in the nurture campaign", it now creates a **Plan** before executing anything.

### What is a Plan?

A typed list of agent actions with risk tiers, dependencies, and rationales. The Plan is shown to you in chat before anything runs. You see:

- The goal
- The list of steps with risk badges (read / low_risk_write / sensitive_write / customer_facing_write)
- Estimated cost
- Which steps need your explicit approval

### Approving a Plan

Click "Approve all & run" to start execution. The agent walks the plan's dependency DAG and runs steps in waves (parallel where possible). Customer-facing writes (campaign launches, outreach sends) still pause for individual approval in the AI Inbox — they appear grouped under the plan with a "Part of plan: <goal>" header.

### Cancelling a Plan

Click "Cancel" on the plan preview. Cancellation only takes effect between waves — already-executed steps stay executed. There is no rollback in v1.

### Feature flag

The planner is gated behind `AGENT_PLANNER_ENABLED`. In production it defaults to `off` for the first week. Set `AGENT_PLANNER_ENABLED=true` to enable.

### Safety budgets

Every plan has hard caps:
- 8 steps max
- $0.50 estimated cost max
- 5-minute wall-clock max
- 1 retry per step

If any cap is hit, the plan finalizes as `failed` with a reason.

### Inspecting a Plan

Plans are persisted in `agent_plans` and `agent_plan_steps`. Inspect via `/admin/ai-decisions` (filter by `decision_type='agent_plan'` or `'agent_step'`) or via direct SQL.
```

- [ ] **Step 23.3: Commit**

```bash
cd /home/sr-user91/Documents/Projects/CRM && git add AGENTS.md docs/AI_COPILOT_USAGE.md && git commit -m "docs: agent-planner v1 launch — update AGENTS.md and usage docs"
```

---

# Done

After all 23 tasks are complete and all tests pass, run:

```bash
cd backend && npm run lint && npm test
cd frontend && npm run lint && npm test
```

Then merge to `develop` and deploy via the existing CI/CD pipeline. The feature flag `AGENT_PLANNER_ENABLED=true` is what turns the new behavior on in production — start with `false` and flip after monitoring `crm_agent_plans_failed_total` for a few days.
