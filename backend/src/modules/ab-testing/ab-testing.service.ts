/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- TODO: refactor away from `any` casts (legacy debt) */
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  CampaignVariant,
  CreateVariantInput,
  UpdateVariantInput,
  ABTestConfig,
  VariantResult,
  ABTestReport,
  ABTestActor,
} from './ab-testing.types';
import {
  findVariantsByCampaign,
  findVariantById,
  insertVariant,
  updateVariant,
  deleteVariant,
  setWinner,
  assignLeadToVariantByWeight,
  getVariantMetrics,
  recordSnapshot,
} from './ab-testing.repository';
import { findCampaignById } from '../campaigns/campaigns.repository';
import { twoProportionZTest, findWinner } from './ab-testing.significance';

// ── Config Helpers ────────────────────────────────────────────────────────

function getConfigFromCampaign(campaign: any): ABTestConfig {
  return {
    enabled: campaign.ab_test_enabled ?? false,
    metric: campaign.ab_test_metric ?? 'open_rate',
    minSamples: campaign.ab_test_min_samples ?? 100,
    confidence: campaign.ab_test_confidence ?? 95,
    autoPromote: campaign.ab_test_auto_promote ?? true,
  };
}

// ── Variant CRUD ──────────────────────────────────────────────────────────

export async function listVariants(campaignId: string): Promise<CampaignVariant[]> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);
  return findVariantsByCampaign(campaignId);
}

export async function getVariant(id: string): Promise<CampaignVariant> {
  const variant = await findVariantById(id);
  if (!variant) throw new AppError('Variant not found', 404);
  return variant;
}

export async function createVariant(
  campaignId: string,
  input: CreateVariantInput,
  actor: ABTestActor,
): Promise<CampaignVariant> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);

  // Validate total split percentage
  const existing = await findVariantsByCampaign(campaignId);
  const totalPct = existing.reduce((sum, v) => sum + v.split_pct, 0) + input.splitPct;
  if (totalPct > 100) {
    throw new AppError(`Total split percentage would be ${totalPct}% (max 100%)`, 400);
  }

  // Check duplicate variant key
  if (existing.some((v) => v.variant_key === input.variantKey)) {
    throw new AppError(`Variant ${input.variantKey} already exists`, 409);
  }

  const variant = await insertVariant({
    campaign_id: campaignId,
    name: input.name,
    variant_key: input.variantKey,
    template_id: input.templateId,
    split_pct: input.splitPct,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'ab_test.variant.created',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { variant: variant.name, key: variant.variant_key, split: variant.split_pct },
    ipAddress: actor.ipAddress ?? null,
  });

  return variant;
}

export async function updateVariantById(
  variantId: string,
  input: UpdateVariantInput,
  actor: ABTestActor,
): Promise<CampaignVariant> {
  const existing = await findVariantById(variantId);
  if (!existing) throw new AppError('Variant not found', 404);

  // Validate total split if changing percentage
  if (input.splitPct !== undefined && input.splitPct !== existing.split_pct) {
    const variants = await findVariantsByCampaign(existing.campaign_id);
    const otherPct = variants
      .filter((v) => v.id !== variantId)
      .reduce((sum, v) => sum + v.split_pct, 0);
    if (otherPct + input.splitPct > 100) {
      throw new AppError('Total split percentage would exceed 100%', 400);
    }
  }

  const variant = await updateVariant(variantId, {
    name: input.name,
    template_id: input.templateId,
    split_pct: input.splitPct,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'ab_test.variant.updated',
    entityType: 'campaign',
    entityId: existing.campaign_id,
    oldValue: { name: existing.name, split: existing.split_pct },
    newValue: { name: variant.name, split: variant.split_pct },
    ipAddress: actor.ipAddress ?? null,
  });

  return variant;
}

export async function deleteVariantById(variantId: string, actor: ABTestActor): Promise<void> {
  const existing = await findVariantById(variantId);
  if (!existing) throw new AppError('Variant not found', 404);

  if (existing.is_winner) {
    throw new AppError('Cannot delete the winning variant', 400);
  }

  await deleteVariant(variantId);

  await writeAuditLog({
    userId: actor.id,
    action: 'ab_test.variant.deleted',
    entityType: 'campaign',
    entityId: existing.campaign_id,
    oldValue: { name: existing.name },
    ipAddress: actor.ipAddress ?? null,
  });
}

// ── Lead Assignment ───────────────────────────────────────────────────────

export async function assignLead(
  campaignId: string,
  leadId: string,
): Promise<CampaignVariant | null> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);
  if (!campaign.ab_test_enabled) return null;

  return assignLeadToVariantByWeight(campaignId, leadId);
}

// ── Metrics & Reports ─────────────────────────────────────────────────────

function computeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export async function getVariantResults(variantId: string): Promise<VariantResult> {
  const variant = await findVariantById(variantId);
  if (!variant) throw new AppError('Variant not found', 404);

  const metrics = await getVariantMetrics(variantId);

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

export async function getABTestReport(campaignId: string): Promise<ABTestReport> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);

  const config = getConfigFromCampaign(campaign);
  const variants = await findVariantsByCampaign(campaignId);

  if (variants.length === 0) {
    return {
      campaignId,
      config,
      variants: [],
      winner: null,
      isSignificant: false,
      pValue: null,
      confidenceLevel: 0,
      totalSent: 0,
    };
  }

  // Fetch metrics for each variant
  const results: VariantResult[] = [];
  for (const v of variants) {
    const result = await getVariantResults(v.id);
    results.push(result);
  }

  const totalSent = results.reduce((sum, r) => sum + r.metrics.sent, 0);
  const existingWinner = results.find((r) => r.variant.is_winner);

  // Determine significance if we have enough samples
  let isSignificant = false;
  let pValue: number | null = null;
  let confidenceLevel = 0;
  let winner: VariantResult | null = existingWinner ?? null;

  if (results.length >= 2 && totalSent >= config.minSamples) {
    // Get metric values for comparison
    const metricValues = results.map((r) => {
      switch (config.metric) {
        case 'open_rate':
          return r.metrics.openRate;
        case 'click_rate':
          return r.metrics.clickRate;
        case 'reply_rate':
          return r.metrics.replyRate;
        default:
          return r.metrics.openRate;
      }
    });

    // For two variants, run Z-test
    if (results.length === 2) {
      const metricA = results[0].metrics;
      const metricB = results[1].metrics;

      let successA: number, successB: number;
      switch (config.metric) {
        case 'open_rate':
          successA = metricA.opened;
          successB = metricB.opened;
          break;
        case 'click_rate':
          successA = metricA.clicked;
          successB = metricB.clicked;
          break;
        case 'reply_rate':
          successA = metricA.replied;
          successB = metricB.replied;
          break;
        default:
          successA = metricA.opened;
          successB = metricB.opened;
      }

      const zResult = twoProportionZTest(successA, metricA.sent, successB, metricB.sent);
      isSignificant = zResult.isSignificant && zResult.confidenceLevel >= config.confidence;
      pValue = zResult.pValue;
      confidenceLevel = zResult.confidenceLevel;

      if (isSignificant && zResult.winnerIndex !== null) {
        winner = results[zResult.winnerIndex];
      }
    } else {
      // For 3+ variants, use chi-squared (simplified: compare best vs rest)
      const winnerIdx = findWinner(metricValues);
      if (winnerIdx !== null) {
        winner = results[winnerIdx];
        // Simple significance: if best has > 2x the sample of worst
        const minSent = Math.min(...results.map((r) => r.metrics.sent));
        const maxSent = Math.max(...results.map((r) => r.metrics.sent));
        if (minSent > 0 && maxSent / minSent > 2) {
          isSignificant = true;
          confidenceLevel = config.confidence;
        }
      }
    }
  }

  return {
    campaignId,
    config,
    variants: results,
    winner,
    isSignificant,
    pValue,
    confidenceLevel,
    totalSent,
  };
}

// ── Auto-Promote Winner ───────────────────────────────────────────────────

export async function checkAndPromoteWinner(campaignId: string): Promise<CampaignVariant | null> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) return null;

  const config = getConfigFromCampaign(campaign);
  if (!config.enabled || !config.autoPromote) return null;

  const report = await getABTestReport(campaignId);
  if (!report.isSignificant || !report.winner) return null;

  // Check if already has a winner
  const existingWinner = report.variants.find((v) => v.variant.is_winner);
  if (existingWinner) return null;

  // Promote the winner
  await setWinner(report.winner.variant.id);

  await writeAuditLog({
    userId: 'system',
    action: 'ab_test.winner_promoted',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: {
      winner: report.winner.variant.name,
      key: report.winner.variant.variant_key,
      pValue: report.pValue,
      confidence: report.confidenceLevel,
    },
    ipAddress: null,
  });

  logger.info('A/B test winner auto-promoted', {
    campaignId,
    winner: report.winner.variant.name,
    pValue: report.pValue,
  });

  return report.winner.variant;
}

// ── Snapshot Recording ────────────────────────────────────────────────────

export async function recordVariantSnapshots(campaignId: string): Promise<void> {
  const variants = await findVariantsByCampaign(campaignId);

  for (const variant of variants) {
    const metrics = await getVariantMetrics(variant.id);
    await recordSnapshot({
      variant_id: variant.id,
      sent: metrics.sent,
      delivered: metrics.delivered,
      opened: metrics.opened,
      clicked: metrics.clicked,
      replied: metrics.replied,
      failed: metrics.failed,
      open_rate: computeRate(metrics.opened, metrics.sent),
      click_rate: computeRate(metrics.clicked, metrics.sent),
      reply_rate: computeRate(metrics.replied, metrics.sent),
    });
  }
}
