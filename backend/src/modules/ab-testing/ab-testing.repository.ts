import { pool, query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { CampaignVariant, VariantAssignment, VariantSnapshot } from './ab-testing.types';

const VARIANT_COLS = `id, campaign_id, name, variant_key, template_id, split_pct, is_winner, status, created_at, updated_at`;

// ── Variants CRUD ─────────────────────────────────────────────────────────

export async function findVariantsByCampaign(campaignId: string): Promise<CampaignVariant[]> {
  return query<CampaignVariant>(
    `SELECT ${VARIANT_COLS} FROM campaign_variants WHERE campaign_id = $1 ORDER BY variant_key`,
    [campaignId],
  );
}

export async function findVariantById(id: string): Promise<CampaignVariant | null> {
  return queryOne<CampaignVariant>(`SELECT ${VARIANT_COLS} FROM campaign_variants WHERE id = $1`, [
    id,
  ]);
}

export async function insertVariant(data: {
  campaign_id: string;
  name: string;
  variant_key: string;
  template_id: string;
  split_pct: number;
}): Promise<CampaignVariant> {
  const row = await queryOne<CampaignVariant>(
    `INSERT INTO campaign_variants (campaign_id, name, variant_key, template_id, split_pct)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${VARIANT_COLS}`,
    [data.campaign_id, data.name, data.variant_key, data.template_id, data.split_pct],
  );
  if (!row) throw new AppError('Failed to create variant', 500);
  return row;
}

export async function updateVariant(
  id: string,
  fields: Partial<{ name: string; template_id: string; split_pct: number }>,
): Promise<CampaignVariant> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.template_id !== undefined) {
    sets.push(`template_id = $${i++}`);
    params.push(fields.template_id);
  }
  if (fields.split_pct !== undefined) {
    sets.push(`split_pct = $${i++}`);
    params.push(fields.split_pct);
  }

  if (sets.length === 0) {
    const existing = await findVariantById(id);
    if (!existing) throw new AppError('Variant not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE campaign_variants SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${VARIANT_COLS}`;
  const row = await queryOne<CampaignVariant>(sql, params);
  if (!row) throw new AppError('Variant not found', 404);
  return row;
}

export async function deleteVariant(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM campaign_variants WHERE id = $1 RETURNING id',
    [id],
  );
  if (!result) throw new AppError('Variant not found', 404);
}

export async function setWinner(variantId: string): Promise<void> {
  await pool.query(
    `UPDATE campaign_variants SET is_winner = true, status = 'winner', updated_at = NOW()
     WHERE id = $1`,
    [variantId],
  );
  // Clear winner flag on other variants in the same campaign
  await pool.query(
    `UPDATE campaign_variants SET is_winner = false, updated_at = NOW()
     WHERE campaign_id = (SELECT campaign_id FROM campaign_variants WHERE id = $1)
       AND id != $1`,
    [variantId],
  );
}

// ── Variant Assignments ───────────────────────────────────────────────────

export async function assignLeadToVariant(
  variantId: string,
  leadId: string,
): Promise<VariantAssignment> {
  const row = await queryOne<VariantAssignment>(
    `INSERT INTO variant_assignments (variant_id, lead_id)
     VALUES ($1, $2)
     ON CONFLICT (variant_id, lead_id) DO NOTHING
     RETURNING id, variant_id, lead_id, assigned_at`,
    [variantId, leadId],
  );
  // If ON CONFLICT did nothing, row is null — that's fine (idempotent)
  return (
    row ?? { id: '', variant_id: variantId, lead_id: leadId, assigned_at: new Date().toISOString() }
  );
}

export async function findVariantForLead(
  campaignId: string,
  leadId: string,
): Promise<CampaignVariant | null> {
  return queryOne<CampaignVariant>(
    `SELECT cv.${VARIANT_COLS.replace(/,\s*/g, ', cv.').replace('id,', 'cv.id,')}
     FROM campaign_variants cv
     JOIN variant_assignments va ON va.variant_id = cv.id
     WHERE cv.campaign_id = $1 AND va.lead_id = $2`,
    [campaignId, leadId],
  );
}

export async function assignLeadToVariantByWeight(
  campaignId: string,
  leadId: string,
): Promise<CampaignVariant | null> {
  // Weighted random selection based on split_pct
  const variants = await findVariantsByCampaign(campaignId);
  if (variants.length === 0) return null;

  const totalWeight = variants.reduce((sum, v) => sum + v.split_pct, 0);
  let random = Math.random() * totalWeight;

  for (const variant of variants) {
    random -= variant.split_pct;
    if (random <= 0) {
      await assignLeadToVariant(variant.id, leadId);
      return variant;
    }
  }

  // Fallback: assign to first variant
  const fallback = variants[0];
  await assignLeadToVariant(fallback.id, leadId);
  return fallback;
}

// ── Variant Snapshots (Metrics) ───────────────────────────────────────────

export async function recordSnapshot(data: {
  variant_id: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  failed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
}): Promise<VariantSnapshot> {
  const row = await queryOne<VariantSnapshot>(
    `INSERT INTO variant_snapshots
       (variant_id, sent, delivered, opened, clicked, replied, failed, open_rate, click_rate, reply_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.variant_id,
      data.sent,
      data.delivered,
      data.opened,
      data.clicked,
      data.replied,
      data.failed,
      data.open_rate,
      data.click_rate,
      data.reply_rate,
    ],
  );
  if (!row) throw new AppError('Failed to record snapshot', 500);
  return row;
}

export async function getLatestSnapshot(variantId: string): Promise<VariantSnapshot | null> {
  return queryOne<VariantSnapshot>(
    `SELECT * FROM variant_snapshots WHERE variant_id = $1 ORDER BY snapshot_at DESC LIMIT 1`,
    [variantId],
  );
}

export async function getVariantMetrics(variantId: string): Promise<{
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  failed: number;
}> {
  const row = await queryOne<{
    sent: string;
    delivered: string;
    opened: string;
    clicked: string;
    replied: string;
    failed: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE ol.status IN ('sent', 'delivered', 'opened', 'clicked', 'replied')) as sent,
       COUNT(*) FILTER (WHERE ol.status IN ('delivered', 'opened', 'clicked', 'replied')) as delivered,
       COUNT(*) FILTER (WHERE ol.status IN ('opened', 'clicked', 'replied')) as opened,
       COUNT(*) FILTER (WHERE ol.status IN ('clicked', 'replied')) as clicked,
       COUNT(*) FILTER (WHERE ol.status = 'replied') as replied,
       COUNT(*) FILTER (WHERE ol.status IN ('failed', 'bounced')) as failed
     FROM outreach_logs ol
     JOIN variant_assignments va ON va.lead_id = ol.lead_id
     WHERE va.variant_id = $1 AND ol.campaign_id = (SELECT campaign_id FROM campaign_variants WHERE id = $1)`,
    [variantId],
  );

  return {
    sent: parseInt(row?.sent ?? '0', 10),
    delivered: parseInt(row?.delivered ?? '0', 10),
    opened: parseInt(row?.opened ?? '0', 10),
    clicked: parseInt(row?.clicked ?? '0', 10),
    replied: parseInt(row?.replied ?? '0', 10),
    failed: parseInt(row?.failed ?? '0', 10),
  };
}
