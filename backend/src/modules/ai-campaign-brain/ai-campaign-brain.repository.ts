import { pool, queryOne } from '../../shared/utils/db';
import type { CampaignBrief } from './ai-campaign-brain.types';

interface UpsertBriefInput {
  campaign_id: string;
  total_leads_evaluated: number;
  eligible_leads: number;
  high_fit_leads: number;
  segment_summary: string;
  recommended_offer_angle: string;
  expected_objections: string[];
  risk_warnings: string[];
  recommended_sequence: object[];
  template_suggestions: object[];
  recommended_autonomy_level: string;
  confidence_score: number;
}

export async function upsertCampaignBrief(input: UpsertBriefInput): Promise<CampaignBrief> {
  const row = await queryOne<CampaignBrief>(
    `INSERT INTO campaign_ai_briefs
       (campaign_id, total_leads_evaluated, eligible_leads, high_fit_leads,
        segment_summary, recommended_offer_angle, expected_objections, risk_warnings,
        recommended_sequence, template_suggestions, recommended_autonomy_level,
        confidence_score, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',NOW())
     ON CONFLICT (campaign_id) DO UPDATE SET
       total_leads_evaluated      = EXCLUDED.total_leads_evaluated,
       eligible_leads             = EXCLUDED.eligible_leads,
       high_fit_leads             = EXCLUDED.high_fit_leads,
       segment_summary            = EXCLUDED.segment_summary,
       recommended_offer_angle    = EXCLUDED.recommended_offer_angle,
       expected_objections        = EXCLUDED.expected_objections,
       risk_warnings              = EXCLUDED.risk_warnings,
       recommended_sequence       = EXCLUDED.recommended_sequence,
       template_suggestions       = EXCLUDED.template_suggestions,
       recommended_autonomy_level = EXCLUDED.recommended_autonomy_level,
       confidence_score           = EXCLUDED.confidence_score,
       status                     = 'draft',
       approved_by                = NULL,
       approved_at                = NULL
     RETURNING *`,
    [
      input.campaign_id,
      input.total_leads_evaluated,
      input.eligible_leads,
      input.high_fit_leads,
      input.segment_summary,
      input.recommended_offer_angle,
      JSON.stringify(input.expected_objections),
      JSON.stringify(input.risk_warnings),
      JSON.stringify(input.recommended_sequence),
      JSON.stringify(input.template_suggestions),
      input.recommended_autonomy_level,
      input.confidence_score,
    ],
  );
  if (!row) throw new Error(`Failed to upsert campaign brief for campaign ${input.campaign_id}`);
  return row;
}

export async function findBriefByCampaignId(campaignId: string): Promise<CampaignBrief | null> {
  return queryOne<CampaignBrief>(`SELECT * FROM campaign_ai_briefs WHERE campaign_id = $1`, [
    campaignId,
  ]);
}

/** Returns the latest approved AI brief for a campaign, or null if none exists. */
export async function findCampaignBrief(campaignId: string): Promise<CampaignBrief | null> {
  return queryOne<CampaignBrief>(
    `SELECT * FROM campaign_ai_briefs
     WHERE campaign_id = $1 AND status = 'approved'
     ORDER BY approved_at DESC NULLS LAST
     LIMIT 1`,
    [campaignId],
  );
}

export async function approveBrief(campaignId: string, approvedBy: string): Promise<void> {
  await pool.query(
    `UPDATE campaign_ai_briefs SET status = 'approved', approved_by = $2, approved_at = NOW()
     WHERE campaign_id = $1`,
    [campaignId, approvedBy],
  );
}

export async function rejectBrief(campaignId: string): Promise<void> {
  await pool.query(`UPDATE campaign_ai_briefs SET status = 'rejected' WHERE campaign_id = $1`, [
    campaignId,
  ]);
}

/** Returns basic campaign info + aggregated lead AI profile stats. */
export async function getCampaignLeadStats(campaignId: string): Promise<{
  campaign: { id: string; name: string; target_industries: string[]; tone: string };
  totalLeads: number;
  eligibleLeads: number;
  highFitLeads: number;
  topPainPoints: string[];
} | null> {
  const campaign = await queryOne<{
    id: string;
    name: string;
    target_industries: string[];
    tone: string;
  }>(
    `SELECT id, name, target_industries, tone FROM campaigns WHERE id = $1 AND deleted_at IS NULL`,
    [campaignId],
  );
  if (!campaign) return null;

  const stats = await queryOne<{
    total_leads: string;
    eligible_leads: string;
    high_fit_leads: string;
  }>(
    `SELECT
       COUNT(cl.lead_id)::text                                               AS total_leads,
       COUNT(cl.lead_id) FILTER (WHERE l.status = 'active')::text           AS eligible_leads,
       COUNT(cl.lead_id) FILTER (
         WHERE p.buying_intent IN ('high','medium') AND l.status = 'active'
       )::text                                                               AS high_fit_leads
     FROM campaign_leads cl
     JOIN leads l ON l.id = cl.lead_id AND l.deleted_at IS NULL
     LEFT JOIN lead_ai_profiles p ON p.lead_id = l.id
     WHERE cl.campaign_id = $1`,
    [campaignId],
  );

  // Collect top pain points from AI profiles
  const painResult = await pool.query<{ pain_points: string[] }>(
    `SELECT p.pain_points
     FROM lead_ai_profiles p
     JOIN campaign_leads cl ON cl.lead_id = p.lead_id
     WHERE cl.campaign_id = $1
     LIMIT 50`,
    [campaignId],
  );

  const freq: Record<string, number> = {};
  for (const row of painResult.rows) {
    for (const pt of row.pain_points ?? []) {
      freq[pt] = (freq[pt] ?? 0) + 1;
    }
  }
  const topPainPoints = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pt]) => pt);

  return {
    campaign,
    totalLeads: parseInt(stats?.total_leads ?? '0', 10),
    eligibleLeads: parseInt(stats?.eligible_leads ?? '0', 10),
    highFitLeads: parseInt(stats?.high_fit_leads ?? '0', 10),
    topPainPoints,
  };
}
