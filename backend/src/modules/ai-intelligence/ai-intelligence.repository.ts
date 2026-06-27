import { pool } from '../../shared/utils/db';
import {
  LeadAiProfileRow,
  AiDecisionLogRow,
  UpsertAiProfileInput,
  InsertDecisionLogInput,
} from './ai-intelligence.types';

// ── Lead AI Profile ──────────────────────────────────────────────────────

export async function findAiProfileByLeadId(leadId: string): Promise<LeadAiProfileRow | null> {
  const res = await pool.query<LeadAiProfileRow>(
    'SELECT * FROM lead_ai_profiles WHERE lead_id = $1',
    [leadId],
  );
  return res.rows[0] ?? null;
}

export async function upsertAiProfile(input: UpsertAiProfileInput): Promise<LeadAiProfileRow> {
  const res = await pool.query<LeadAiProfileRow>(
    `INSERT INTO lead_ai_profiles (
        lead_id, website_quality_score, pain_points, offer_angle,
        inferred_budget_range, buying_intent, reachability_score,
        preferred_channel, ai_notes, next_best_action,
        next_best_action_reason, next_best_action_confidence,
        enrichment_status, last_enriched_at, updated_at
      ) VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        website_quality_score       = EXCLUDED.website_quality_score,
        pain_points                 = EXCLUDED.pain_points,
        offer_angle                 = EXCLUDED.offer_angle,
        inferred_budget_range       = EXCLUDED.inferred_budget_range,
        buying_intent               = EXCLUDED.buying_intent,
        reachability_score          = EXCLUDED.reachability_score,
        preferred_channel           = EXCLUDED.preferred_channel,
        ai_notes                    = EXCLUDED.ai_notes,
        next_best_action            = EXCLUDED.next_best_action,
        next_best_action_reason     = EXCLUDED.next_best_action_reason,
        next_best_action_confidence = EXCLUDED.next_best_action_confidence,
        enrichment_status           = EXCLUDED.enrichment_status,
        last_enriched_at            = EXCLUDED.last_enriched_at,
        updated_at                  = NOW()
      RETURNING *`,
    [
      input.lead_id,
      input.website_quality_score ?? null,
      JSON.stringify(input.pain_points ?? []),
      input.offer_angle ?? null,
      input.inferred_budget_range ?? null,
      input.buying_intent ?? 'unknown',
      input.reachability_score ?? null,
      input.preferred_channel ?? null,
      input.ai_notes ?? null,
      input.next_best_action ?? null,
      input.next_best_action_reason ?? null,
      input.next_best_action_confidence ?? null,
      input.enrichment_status,
      input.last_enriched_at ?? null,
    ],
  );
  return res.rows[0];
}

export async function setEnrichmentStatus(
  leadId: string,
  status: 'pending' | 'running' | 'done' | 'failed',
): Promise<void> {
  await pool.query(
    `INSERT INTO lead_ai_profiles (lead_id, enrichment_status, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET enrichment_status = $2, updated_at = NOW()`,
    [leadId, status],
  );
}

export async function updateNextBestAction(
  leadId: string,
  action: string,
  reason: string,
  confidence: number,
): Promise<LeadAiProfileRow> {
  const res = await pool.query<LeadAiProfileRow>(
    `UPDATE lead_ai_profiles
     SET next_best_action = $1,
         next_best_action_reason = $2,
         next_best_action_confidence = $3,
         updated_at = NOW()
     WHERE lead_id = $4
     RETURNING *`,
    [action, reason, confidence, leadId],
  );
  if (!res.rows[0]) {
    throw new Error(`Lead AI profile not found for lead ${leadId}`);
  }
  return res.rows[0];
}

// ── AI Decision Log ──────────────────────────────────────────────────────

export async function listDecisionLogsByLead(
  leadId: string,
  limit: number,
  offset: number,
): Promise<{ rows: AiDecisionLogRow[]; total: number }> {
  const [rowsRes, countRes] = await Promise.all([
    pool.query<AiDecisionLogRow>(
      `SELECT * FROM ai_decision_log
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [leadId, limit, offset],
    ),
    pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ai_decision_log WHERE lead_id = $1',
      [leadId],
    ),
  ]);
  return { rows: rowsRes.rows, total: parseInt(countRes.rows[0]?.count ?? '0', 10) };
}

export async function listDecisionLogs(opts: {
  decisionType?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: AiDecisionLogRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.decisionType) {
    params.push(opts.decisionType);
    conditions.push(`decision_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_decision_log ${where}`,
    params,
  );

  const rowsRes = await pool.query<AiDecisionLogRow>(
    `SELECT * FROM ai_decision_log ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, opts.offset],
  );

  return { rows: rowsRes.rows, total: parseInt(countRes.rows[0]?.count ?? '0', 10) };
}

export async function insertDecisionLog(input: InsertDecisionLogInput): Promise<AiDecisionLogRow> {
  const res = await pool.query<AiDecisionLogRow>(
    `INSERT INTO ai_decision_log (
        lead_id, campaign_id, decision_type, input_context,
        chain_of_thought, decision, confidence, tokens_used,
        latency_ms, model_used, autonomy_level, human_approval_required
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
    [
      input.lead_id ?? null,
      input.campaign_id ?? null,
      input.decision_type,
      JSON.stringify(input.input_context),
      input.chain_of_thought ?? null,
      input.decision,
      input.confidence ?? null,
      input.tokens_used ?? null,
      input.latency_ms ?? null,
      input.model_used ?? null,
      input.autonomy_level ?? null,
      input.human_approval_required ?? false,
    ],
  );
  return res.rows[0];
}
