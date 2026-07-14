import { pool } from '../../shared/utils/db';
import { logger } from '../../shared/utils/logger';
import { AppError } from '../../shared/middleware/errorHandler';
import { Campaign, CampaignLead, CampaignStats } from './campaigns.types';

export async function findCampaigns(): Promise<Campaign[]> {
  const result = await pool.query<Campaign>(
    'SELECT * FROM campaigns WHERE deleted_at IS NULL ORDER BY created_at DESC',
  );
  return result.rows;
}

export async function findActiveCampaignsByPipeline(pipelineId: string): Promise<Campaign[]> {
  const result = await pool.query<Campaign>(
    `SELECT * FROM campaigns WHERE pipeline_id = $1 AND status = 'active' AND sequence_id IS NOT NULL AND deleted_at IS NULL`,
    [pipelineId],
  );
  return result.rows;
}

/**
 * Campaigns that explicitly target this specific stage (stage-level trigger).
 */
export async function findActiveCampaignsByStage(stageId: string): Promise<Campaign[]> {
  const result = await pool.query<Campaign>(
    `SELECT * FROM campaigns
     WHERE trigger_stage_id = $1
       AND status = 'active'
       AND sequence_id IS NOT NULL
       AND deleted_at IS NULL`,
    [stageId],
  );
  return result.rows;
}

/**
 * Campaigns linked to a pipeline but with no specific trigger stage set —
 * these are "catch-all" campaigns that enroll on any stage move.
 */
export async function findActiveCampaignsByPipelineNoStage(
  pipelineId: string,
): Promise<Campaign[]> {
  const result = await pool.query<Campaign>(
    `SELECT * FROM campaigns
     WHERE pipeline_id = $1
       AND trigger_stage_id IS NULL
       AND status = 'active'
       AND sequence_id IS NOT NULL
       AND deleted_at IS NULL`,
    [pipelineId],
  );
  return result.rows;
}

export async function findCampaignById(id: string): Promise<Campaign | null> {
  const result = await pool.query<Campaign>(
    'SELECT * FROM campaigns WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

export async function insertCampaign(
  data: {
    name: string;
    tone: string;
    target_industries: string[];
    target_countries: string[];
    sequence_id?: string;
    pipeline_id?: string;
    trigger_stage_id?: string | null;
    ai_personalization_enabled?: boolean;
    autonomy_level?: string;
    ab_test_enabled?: boolean;
    ab_test_metric?: string;
    ab_test_min_samples?: number;
    ab_test_confidence?: number;
    ab_test_auto_promote?: boolean;
  },
  createdBy: string,
): Promise<Campaign> {
  // Set autonomy_level explicitly rather than relying on the column default —
  // migration 1750000000022 stored a malformed default ('''guarded''') that
  // violates campaigns_autonomy_level_check. Default to the intended 'guarded'.
  const result = await pool.query<Campaign>(
    `INSERT INTO campaigns (name, tone, target_industries, target_countries, sequence_id, pipeline_id,
       trigger_stage_id, ai_personalization_enabled, autonomy_level,
       ab_test_enabled, ab_test_metric, ab_test_min_samples, ab_test_confidence, ab_test_auto_promote,
       created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      data.name,
      data.tone,
      data.target_industries,
      data.target_countries,
      data.sequence_id || null,
      data.pipeline_id || null,
      data.trigger_stage_id ?? null,
      data.ai_personalization_enabled ?? false,
      data.autonomy_level ?? 'guarded',
      data.ab_test_enabled ?? false,
      data.ab_test_metric ?? 'open_rate',
      data.ab_test_min_samples ?? 100,
      data.ab_test_confidence ?? 95,
      data.ab_test_auto_promote ?? true,
      createdBy,
    ],
  );
  return result.rows[0];
}

export async function updateCampaign(
  id: string,
  data: {
    name?: string;
    tone?: string;
    target_industries?: string[];
    target_countries?: string[];
    sequence_id?: string;
    pipeline_id?: string;
    trigger_stage_id?: string | null;
    ai_personalization_enabled?: boolean;
    ab_test_enabled?: boolean;
    ab_test_metric?: string;
    ab_test_min_samples?: number;
    ab_test_confidence?: number;
    ab_test_auto_promote?: boolean;
  },
): Promise<Campaign> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.tone !== undefined) {
    fields.push(`tone = $${paramIndex++}`);
    values.push(data.tone);
  }
  if (data.target_industries !== undefined) {
    fields.push(`target_industries = $${paramIndex++}`);
    values.push(data.target_industries);
  }
  if (data.target_countries !== undefined) {
    fields.push(`target_countries = $${paramIndex++}`);
    values.push(data.target_countries);
  }
  if (data.sequence_id !== undefined) {
    fields.push(`sequence_id = $${paramIndex++}`);
    values.push(data.sequence_id);
  }
  if (data.pipeline_id !== undefined) {
    fields.push(`pipeline_id = $${paramIndex++}`);
    values.push(data.pipeline_id);
  }
  if ('trigger_stage_id' in data) {
    fields.push(`trigger_stage_id = $${paramIndex++}`);
    values.push(data.trigger_stage_id ?? null);
  }
  if (data.ai_personalization_enabled !== undefined) {
    fields.push(`ai_personalization_enabled = $${paramIndex++}`);
    values.push(data.ai_personalization_enabled);
  }
  if (data.ab_test_enabled !== undefined) {
    fields.push(`ab_test_enabled = $${paramIndex++}`);
    values.push(data.ab_test_enabled);
  }
  if (data.ab_test_metric !== undefined) {
    fields.push(`ab_test_metric = $${paramIndex++}`);
    values.push(data.ab_test_metric);
  }
  if (data.ab_test_min_samples !== undefined) {
    fields.push(`ab_test_min_samples = $${paramIndex++}`);
    values.push(data.ab_test_min_samples);
  }
  if (data.ab_test_confidence !== undefined) {
    fields.push(`ab_test_confidence = $${paramIndex++}`);
    values.push(data.ab_test_confidence);
  }
  if (data.ab_test_auto_promote !== undefined) {
    fields.push(`ab_test_auto_promote = $${paramIndex++}`);
    values.push(data.ab_test_auto_promote);
  }

  values.push(id);
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Campaign not found', 404);
  return row;
}

export async function deleteCampaign(id: string): Promise<void> {
  await pool.query('UPDATE campaigns SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [
    id,
  ]);
}

export async function launchCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'active', launched_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Campaign not found', 404);
  return row;
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'paused' WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Campaign not found', 404);
  return row;
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'active' WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Campaign not found', 404);
  return row;
}

export async function addLeadsToCampaign(
  campaignId: string,
  leadIds: string[],
): Promise<CampaignLead[]> {
  const results: CampaignLead[] = [];
  for (const leadId of leadIds) {
    try {
      const result = await pool.query<CampaignLead>(
        `INSERT INTO campaign_leads (campaign_id, lead_id)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2
         )
         RETURNING *`,
        [campaignId, leadId],
      );
      if (result.rows[0]) {
        results.push(result.rows[0]);
      }
    } catch (error) {
      const pgCode = (error as { code?: string }).code;
      if (pgCode === '23505') {
        // Duplicate — skip silently (ON CONFLICT should already handle this, but be safe)
        continue;
      }
      logger.warn('Failed to add lead to campaign', {
        campaignId,
        leadId,
        pgCode,
        error: String(error),
      });
      throw error;
    }
  }
  return results;
}

export async function removeLeadFromCampaign(campaignId: string, leadId: string): Promise<void> {
  await pool.query('DELETE FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2', [
    campaignId,
    leadId,
  ]);
}

export async function findCampaignLeads(campaignId: string): Promise<string[]> {
  const result = await pool.query<{ lead_id: string }>(
    `SELECT cl.lead_id FROM campaign_leads cl
     JOIN campaigns c ON c.id = cl.campaign_id
     WHERE cl.campaign_id = $1 AND c.deleted_at IS NULL`,
    [campaignId],
  );
  return result.rows.map((r) => r.lead_id);
}

export interface CampaignLeadProgressRow {
  lead_id: string;
  contact_name: string | null;
  business_name: string | null;
  lead_status: string;
  latest_step: number | null;
  step_status: string | null;
  step_time: string | null;
  step_error: string | null;
}

export async function findCampaignLeadsWithProgress(
  campaignId: string,
): Promise<CampaignLeadProgressRow[]> {
  const result = await pool.query<CampaignLeadProgressRow>(
    `SELECT
      l.id as lead_id,
      l.contact_name,
      l.business_name,
      l.status as lead_status,
      ol.step_number as latest_step,
      ol.status as step_status,
      ol.created_at as step_time,
      ol.error_message as step_error
    FROM campaign_leads cl
    JOIN leads l ON cl.lead_id = l.id
    LEFT JOIN LATERAL (
      SELECT step_number, status, created_at, error_message
      FROM outreach_logs
      WHERE lead_id = cl.lead_id AND campaign_id = cl.campaign_id
      ORDER BY created_at DESC
      LIMIT 1
    ) ol ON true
    WHERE cl.campaign_id = $1`,
    [campaignId],
  );
  return result.rows;
}

export interface LatestOutreachLogRow {
  id: string;
  step_number: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  template_id: string | null;
  status: string;
  error_message: string | null;
}

/** Most recent outreach_logs row for a specific lead within a campaign — used to retry a failed send. */
export async function findLatestOutreachLogForLead(
  campaignId: string,
  leadId: string,
): Promise<LatestOutreachLogRow | null> {
  const result = await pool.query<LatestOutreachLogRow>(
    `SELECT id, step_number, channel, template_id, status, error_message
     FROM outreach_logs
     WHERE campaign_id = $1 AND lead_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [campaignId, leadId],
  );
  return result.rows[0] ?? null;
}

export interface CampaignLeadRow {
  id: string;
  business_name: string;
  phone: string;
  email: string;
  status: 'active' | 'paused' | 'won' | 'lost' | 'opted_out';
}

export async function findCampaignLeadRows(campaignId: string): Promise<CampaignLeadRow[]> {
  const result = await pool.query<CampaignLeadRow>(
    `SELECT l.id, l.business_name, l.phone, l.email, l.status
     FROM campaign_leads cl
     JOIN campaigns c ON c.id = cl.campaign_id
     JOIN leads l ON l.id = cl.lead_id
     WHERE cl.campaign_id = $1
       AND c.deleted_at IS NULL
       AND l.deleted_at IS NULL
     ORDER BY cl.added_at ASC`,
    [campaignId],
  );
  return result.rows;
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const leadsResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) as total FROM campaign_leads cl
     JOIN campaigns c ON c.id = cl.campaign_id
     WHERE cl.campaign_id = $1 AND c.deleted_at IS NULL`,
    [campaignId],
  );

  const outreachResult = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM outreach_logs
     WHERE campaign_id = $1
     GROUP BY status`,
    [campaignId],
  );

  const stats: CampaignStats = {
    total_leads: parseInt(leadsResult.rows[0]?.total || '0'),
    sent: 0,
    delivered: 0,
    opened: 0,
    replied: 0,
    failed: 0,
  };

  for (const row of outreachResult.rows) {
    switch (row.status) {
      case 'sent':
        stats.sent = parseInt(row.count);
        break;
      case 'delivered':
        stats.delivered = parseInt(row.count);
        break;
      case 'opened':
        stats.opened = parseInt(row.count);
        break;
      case 'replied':
        stats.replied = parseInt(row.count);
        break;
      case 'failed':
        stats.failed = parseInt(row.count);
        break;
    }
  }

  return stats;
}
