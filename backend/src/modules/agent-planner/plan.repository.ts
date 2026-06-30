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
