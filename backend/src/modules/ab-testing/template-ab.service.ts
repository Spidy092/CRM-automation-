import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  TemplateVariant,
  CreateTemplateVariantInput,
  UpdateTemplateVariantInput,
  TemplateVariantResult,
  TemplateABTestReport,
} from './template-ab.types';
import {
  findVariantsByTemplate,
  findTemplateVariantById,
  insertTemplateVariant,
  updateTemplateVariant,
  deleteTemplateVariant,
  setTemplateVariantWinner,
  getTemplateVariantMetrics,
} from './template-ab.repository';
import { twoProportionZTest } from './ab-testing.significance';

function computeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export async function listTemplateVariants(templateId: string): Promise<TemplateVariant[]> {
  return findVariantsByTemplate(templateId);
}

export async function getTemplateVariant(id: string): Promise<TemplateVariant> {
  const variant = await findTemplateVariantById(id);
  if (!variant) throw new AppError('Template variant not found', 404);
  return variant;
}

export async function createTemplateVariant(
  templateId: string,
  input: CreateTemplateVariantInput,
  actor: { id: string; role: string; ipAddress?: string | null },
): Promise<TemplateVariant> {
  const existing = await findVariantsByTemplate(templateId);
  const totalPct = existing.reduce((sum, v) => sum + v.split_pct, 0) + input.splitPct;
  if (totalPct > 100) {
    throw new AppError(`Total split percentage would be ${totalPct}% (max 100%)`, 400);
  }

  if (existing.some((v) => v.variant_key === input.variantKey)) {
    throw new AppError(`Variant ${input.variantKey} already exists`, 409);
  }

  const variant = await insertTemplateVariant({
    template_id: templateId,
    name: input.name,
    variant_key: input.variantKey,
    subject: input.subject,
    body: input.body,
    split_pct: input.splitPct,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'template_ab.variant.created',
    entityType: 'template',
    entityId: templateId,
    newValue: { variant: variant.name, key: variant.variant_key, split: variant.split_pct },
    ipAddress: actor.ipAddress ?? null,
  });

  return variant;
}

export async function updateTemplateVariantById(
  variantId: string,
  input: UpdateTemplateVariantInput,
  actor: { id: string; role: string; ipAddress?: string | null },
): Promise<TemplateVariant> {
  const existing = await findTemplateVariantById(variantId);
  if (!existing) throw new AppError('Template variant not found', 404);

  if (input.splitPct !== undefined && input.splitPct !== existing.split_pct) {
    const variants = await findVariantsByTemplate(existing.template_id);
    const otherPct = variants
      .filter((v) => v.id !== variantId)
      .reduce((sum, v) => sum + v.split_pct, 0);
    if (otherPct + input.splitPct > 100) {
      throw new AppError('Total split percentage would exceed 100%', 400);
    }
  }

  const variant = await updateTemplateVariant(variantId, {
    name: input.name,
    subject: input.subject,
    body: input.body,
    split_pct: input.splitPct,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'template_ab.variant.updated',
    entityType: 'template',
    entityId: existing.template_id,
    oldValue: { name: existing.name, split: existing.split_pct },
    newValue: { name: variant.name, split: variant.split_pct },
    ipAddress: actor.ipAddress ?? null,
  });

  return variant;
}

export async function deleteTemplateVariantById(
  variantId: string,
  actor: { id: string; role: string; ipAddress?: string | null },
): Promise<void> {
  const existing = await findTemplateVariantById(variantId);
  if (!existing) throw new AppError('Template variant not found', 404);
  if (existing.is_winner) throw new AppError('Cannot delete the winning variant', 400);

  await deleteTemplateVariant(variantId);

  await writeAuditLog({
    userId: actor.id,
    action: 'template_ab.variant.deleted',
    entityType: 'template',
    entityId: existing.template_id,
    oldValue: { name: existing.name },
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function getTemplateVariantResults(variantId: string): Promise<TemplateVariantResult> {
  const variant = await findTemplateVariantById(variantId);
  if (!variant) throw new AppError('Template variant not found', 404);

  const metrics = await getTemplateVariantMetrics(variantId);
  return {
    variant,
    metrics: {
      ...metrics,
      openRate: computeRate(metrics.opened, metrics.sent),
      clickRate: computeRate(metrics.clicked, metrics.sent),
      replyRate: computeRate(metrics.replied, metrics.sent),
    },
  };
}

export async function getTemplateABTestReport(templateId: string): Promise<TemplateABTestReport> {
  const variants = await findVariantsByTemplate(templateId);

  if (variants.length === 0) {
    return {
      templateId,
      variants: [],
      winner: null,
      isSignificant: false,
      pValue: null,
      totalSent: 0,
    };
  }

  const results: TemplateVariantResult[] = [];
  for (const v of variants) {
    results.push(await getTemplateVariantResults(v.id));
  }

  const totalSent = results.reduce((sum, r) => sum + r.metrics.sent, 0);
  let isSignificant = false;
  let pValue: number | null = null;
  let winner: TemplateVariantResult | null = results.find((r) => r.variant.is_winner) ?? null;

  if (results.length === 2 && totalSent >= 50) {
    const a = results[0].metrics;
    const b = results[1].metrics;
    const zResult = twoProportionZTest(a.opened, a.sent, b.opened, b.sent);
    isSignificant = zResult.isSignificant;
    pValue = zResult.pValue;
    if (isSignificant && zResult.winnerIndex !== null) {
      winner = results[zResult.winnerIndex];
    }
  }

  return { templateId, variants: results, winner, isSignificant, pValue, totalSent };
}

export async function checkAndPromoteTemplateWinner(
  templateId: string,
): Promise<TemplateVariant | null> {
  const report = await getTemplateABTestReport(templateId);
  if (!report.isSignificant || !report.winner) return null;

  const existingWinner = report.variants.find((v) => v.variant.is_winner);
  if (existingWinner) return null;

  await setTemplateVariantWinner(report.winner.variant.id);

  await writeAuditLog({
    userId: 'system',
    action: 'template_ab.winner_promoted',
    entityType: 'template',
    entityId: templateId,
    newValue: {
      winner: report.winner.variant.name,
      key: report.winner.variant.variant_key,
      pValue: report.pValue,
    },
    ipAddress: null,
  });

  logger.info('Template A/B test winner auto-promoted', {
    templateId,
    winner: report.winner.variant.name,
    pValue: report.pValue,
  });

  return report.winner.variant;
}
