import { pool, query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { TemplateVariant, TemplateVariantAssignment } from './template-ab.types';

const VARIANT_COLS = `id, template_id, name, variant_key, subject, body, split_pct, is_winner, status, created_at, updated_at`;

export async function findVariantsByTemplate(templateId: string): Promise<TemplateVariant[]> {
  return query<TemplateVariant>(
    `SELECT ${VARIANT_COLS} FROM template_variants WHERE template_id = $1 ORDER BY variant_key`,
    [templateId],
  );
}

export async function findTemplateVariantById(id: string): Promise<TemplateVariant | null> {
  return queryOne<TemplateVariant>(`SELECT ${VARIANT_COLS} FROM template_variants WHERE id = $1`, [
    id,
  ]);
}

export async function insertTemplateVariant(data: {
  template_id: string;
  name: string;
  variant_key: string;
  subject?: string;
  body: string;
  split_pct: number;
}): Promise<TemplateVariant> {
  const row = await queryOne<TemplateVariant>(
    `INSERT INTO template_variants (template_id, name, variant_key, subject, body, split_pct)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${VARIANT_COLS}`,
    [
      data.template_id,
      data.name,
      data.variant_key,
      data.subject ?? null,
      data.body,
      data.split_pct,
    ],
  );
  if (!row) throw new AppError('Failed to create template variant', 500);
  return row;
}

export async function updateTemplateVariant(
  id: string,
  fields: Partial<{ name: string; subject: string; body: string; split_pct: number }>,
): Promise<TemplateVariant> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.subject !== undefined) {
    sets.push(`subject = $${i++}`);
    params.push(fields.subject);
  }
  if (fields.body !== undefined) {
    sets.push(`body = $${i++}`);
    params.push(fields.body);
  }
  if (fields.split_pct !== undefined) {
    sets.push(`split_pct = $${i++}`);
    params.push(fields.split_pct);
  }

  if (sets.length === 0) {
    const existing = await findTemplateVariantById(id);
    if (!existing) throw new AppError('Template variant not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE template_variants SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${VARIANT_COLS}`;
  const row = await queryOne<TemplateVariant>(sql, params);
  if (!row) throw new AppError('Template variant not found', 404);
  return row;
}

export async function deleteTemplateVariant(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM template_variants WHERE id = $1 RETURNING id',
    [id],
  );
  if (!result) throw new AppError('Template variant not found', 404);
}

export async function setTemplateVariantWinner(variantId: string): Promise<void> {
  await pool.query(
    `UPDATE template_variants SET is_winner = true, status = 'winner', updated_at = NOW()
     WHERE id = $1`,
    [variantId],
  );
  await pool.query(
    `UPDATE template_variants SET is_winner = false, updated_at = NOW()
     WHERE template_id = (SELECT template_id FROM template_variants WHERE id = $1)
       AND id != $1`,
    [variantId],
  );
}

export async function assignLeadToTemplateVariant(
  variantId: string,
  leadId: string,
): Promise<TemplateVariantAssignment> {
  const row = await queryOne<TemplateVariantAssignment>(
    `INSERT INTO template_variant_assignments (variant_id, lead_id)
     VALUES ($1, $2)
     ON CONFLICT (variant_id, lead_id) DO NOTHING
     RETURNING id, variant_id, lead_id, assigned_at`,
    [variantId, leadId],
  );
  return (
    row ?? { id: '', variant_id: variantId, lead_id: leadId, assigned_at: new Date().toISOString() }
  );
}

export async function assignLeadToTemplateVariantByWeight(
  templateId: string,
  leadId: string,
): Promise<TemplateVariant | null> {
  const variants = await findVariantsByTemplate(templateId);
  if (variants.length === 0) return null;

  const totalWeight = variants.reduce((sum, v) => sum + v.split_pct, 0);
  let random = Math.random() * totalWeight;

  for (const variant of variants) {
    random -= variant.split_pct;
    if (random <= 0) {
      await assignLeadToTemplateVariant(variant.id, leadId);
      return variant;
    }
  }

  const fallback = variants[0];
  await assignLeadToTemplateVariant(fallback.id, leadId);
  return fallback;
}

export async function getTemplateVariantMetrics(variantId: string): Promise<{
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
     JOIN template_variant_assignments tva ON tva.lead_id = ol.lead_id
     WHERE tva.variant_id = $1`,
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
