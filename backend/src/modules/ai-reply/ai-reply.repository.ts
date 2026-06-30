import { pool, queryOne } from '../../shared/utils/db';
import type { IntentClass } from './ai-reply.types';

export async function upsertConversationSummary(
  leadId: string,
  summary: string,
  intentClass: IntentClass,
  sentiment: 'positive' | 'neutral' | 'negative',
): Promise<void> {
  await pool.query(
    `INSERT INTO lead_conversation_summaries
       (lead_id, summary, last_interaction_at, last_intent_class, sentiment, interaction_count, updated_at)
     VALUES ($1, $2, NOW(), $3, $4, 1, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET
       summary             = EXCLUDED.summary,
       last_interaction_at = NOW(),
       last_intent_class   = EXCLUDED.last_intent_class,
       sentiment           = EXCLUDED.sentiment,
       interaction_count   = lead_conversation_summaries.interaction_count + 1,
       updated_at          = NOW()`,
    [leadId, summary, intentClass, sentiment],
  );
}

export async function appendObjectionToProfile(
  leadId: string,
  objectionType: string,
  messageText: string,
): Promise<void> {
  const entry = JSON.stringify({
    type: objectionType,
    text: messageText.slice(0, 200),
    logged_at: new Date().toISOString(),
  });
  await pool.query(
    `UPDATE lead_ai_profiles
     SET objection_log = objection_log || $2::jsonb,
         updated_at    = NOW()
     WHERE lead_id = $1`,
    [leadId, `[${entry}]`],
  );
}

export async function appendBuyingSignalToProfile(leadId: string, signal: string): Promise<void> {
  const entry = JSON.stringify({ signal, detected_at: new Date().toISOString() });
  await pool.query(
    `UPDATE lead_ai_profiles
     SET buying_signals = buying_signals || $2::jsonb,
         updated_at     = NOW()
     WHERE lead_id = $1`,
    [leadId, `[${entry}]`],
  );
}

export async function updateProfileNextAction(
  leadId: string,
  nextBestAction: string,
  reason: string,
  confidence: number,
): Promise<void> {
  await pool.query(
    `UPDATE lead_ai_profiles
     SET next_best_action            = $2,
         next_best_action_reason     = $3,
         next_best_action_confidence = $4,
         updated_at                  = NOW()
     WHERE lead_id = $1`,
    [leadId, nextBestAction, reason, confidence],
  );
}

/** Returns assigned_to and the campaign with lowest ai_min_confidence (most permissive active campaign). */
export async function getLeadCampaignContext(leadId: string): Promise<{
  assignedTo: string | null;
  campaignId: string | null;
  autonomyLevel: string;
  aiMinConfidence: number;
} | null> {
  const row = await queryOne<{
    assigned_to: string | null;
    campaign_id: string | null;
    autonomy_level: string;
    ai_min_confidence: number;
  }>(
    `SELECT l.assigned_to,
            cl.campaign_id,
            c.autonomy_level,
            c.ai_min_confidence
     FROM leads l
     LEFT JOIN campaign_leads cl ON cl.lead_id = l.id
     LEFT JOIN campaigns c ON c.id = cl.campaign_id AND c.status = 'active'
     WHERE l.id = $1 AND l.deleted_at IS NULL
     ORDER BY c.ai_min_confidence ASC NULLS LAST
     LIMIT 1`,
    [leadId],
  );

  if (!row) return null;

  return {
    assignedTo: row.assigned_to,
    campaignId: row.campaign_id,
    autonomyLevel: row.autonomy_level ?? 'guarded',
    aiMinConfidence: row.ai_min_confidence ?? 70,
  };
}

