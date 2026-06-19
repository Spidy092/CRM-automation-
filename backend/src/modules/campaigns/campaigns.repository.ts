import { pool } from '../../shared/utils/db';
import { Campaign, CampaignLead, CampaignStats } from './campaigns.types';

export async function findCampaigns(): Promise<Campaign[]> {
  const result = await pool.query<Campaign>('SELECT * FROM campaigns ORDER BY created_at DESC');
  return result.rows;
}

export async function findCampaignById(id: string): Promise<Campaign | null> {
  const result = await pool.query<Campaign>('SELECT * FROM campaigns WHERE id = $1', [id]);
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
  },
  createdBy: string,
): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `INSERT INTO campaigns (name, tone, target_industries, target_countries, sequence_id, pipeline_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.name,
      data.tone,
      data.target_industries,
      data.target_countries,
      data.sequence_id || null,
      data.pipeline_id || null,
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

  values.push(id);
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function deleteCampaign(id: string): Promise<void> {
  await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
}

export async function launchCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'active', launched_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0];
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'paused' WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0];
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  const result = await pool.query<Campaign>(
    `UPDATE campaigns SET status = 'active' WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0];
}

export async function addLeadsToCampaign(
  campaignId: string,
  leadIds: string[],
): Promise<CampaignLead[]> {
  const results: CampaignLead[] = [];
  for (const leadId of leadIds) {
    try {
      const result = await pool.query<CampaignLead>(
        `INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ($1, $2)
         ON CONFLICT (campaign_id, lead_id) DO NOTHING RETURNING *`,
        [campaignId, leadId],
      );
      if (result.rows[0]) {
        results.push(result.rows[0]);
      }
    } catch (error) {
      // Skip duplicates or invalid leads
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
    'SELECT lead_id FROM campaign_leads WHERE campaign_id = $1',
    [campaignId],
  );
  return result.rows.map((r) => r.lead_id);
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const leadsResult = await pool.query<{ total: string }>(
    'SELECT COUNT(*) as total FROM campaign_leads WHERE campaign_id = $1',
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
