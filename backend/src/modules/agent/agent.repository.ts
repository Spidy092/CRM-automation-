import { pool, queryOne } from '../../shared/utils/db';
import type { AgentActionRow, AgentActionStatus, CreateAgentActionInput } from './agent.types';

function parseRow(row: AgentActionRow): AgentActionRow {
  return {
    ...row,
    action_args: row.action_args ?? {},
    result: row.result ?? null,
  };
}

export async function createAgentAction(input: CreateAgentActionInput): Promise<AgentActionRow> {
  const row = await queryOne<AgentActionRow>(
    `INSERT INTO agent_actions
       (source, action_name, action_args, risk_tier, status, requested_by, requester_role,
        requester_email, requester_name, approved_by, lead_id, campaign_id, confidence,
        autonomy_level, idempotency_key, source_message, expires_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
     ON CONFLICT (idempotency_key) DO UPDATE
       SET updated_at = NOW()
     RETURNING *`,
    [
      input.source,
      input.actionName,
      JSON.stringify(input.actionArgs),
      input.riskTier,
      input.status,
      input.requestedBy ?? null,
      input.requesterRole ?? null,
      input.requesterEmail ?? null,
      input.requesterName ?? null,
      input.approvedBy ?? null,
      input.leadId ?? null,
      input.campaignId ?? null,
      input.confidence ?? null,
      input.autonomyLevel ?? null,
      input.idempotencyKey,
      input.sourceMessage ?? null,
      input.expiresAt ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create agent action');
  return parseRow(row);
}

export async function findAgentActionById(id: string): Promise<AgentActionRow | null> {
  const row = await queryOne<AgentActionRow>('SELECT * FROM agent_actions WHERE id = $1', [id]);
  return row ? parseRow(row) : null;
}

export async function findAgentActionByIdempotencyKey(
  idempotencyKey: string,
): Promise<AgentActionRow | null> {
  const row = await queryOne<AgentActionRow>(
    'SELECT * FROM agent_actions WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  return row ? parseRow(row) : null;
}

export async function updateAgentActionStatus(
  id: string,
  status: AgentActionStatus,
  fields?: {
    approvedBy?: string | null;
    result?: unknown;
    errorMessage?: string | null;
    executedAt?: string | null;
  },
): Promise<AgentActionRow> {
  const row = await queryOne<AgentActionRow>(
    `UPDATE agent_actions
     SET status = $2,
         approved_by = COALESCE($3, approved_by),
         result = COALESCE($4, result),
         error_message = $5,
         executed_at = COALESCE($6, executed_at),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      fields?.approvedBy ?? null,
      fields?.result === undefined ? null : JSON.stringify(fields.result),
      fields?.errorMessage ?? null,
      fields?.executedAt ?? null,
    ],
  );
  if (!row) throw new Error(`Agent action not found: ${id}`);
  return parseRow(row);
}

export async function linkPlanToAction(
  actionId: string,
  planId: string,
  planStepId: string,
): Promise<void> {
  await pool.query(
    `UPDATE agent_actions
     SET agent_plan_id = $1, agent_plan_step_id = $2
     WHERE id = $3`,
    [planId, planStepId, actionId],
  );
}

export async function claimAgentActionForExecution(id: string): Promise<AgentActionRow | null> {
  const result = await pool.query<AgentActionRow>(
    `UPDATE agent_actions
     SET status = 'executing', updated_at = NOW()
     WHERE id = $1
       AND status IN ('proposed', 'pending_approval', 'approved')
     RETURNING *`,
    [id],
  );
  return result.rows[0] ? parseRow(result.rows[0]) : null;
}
