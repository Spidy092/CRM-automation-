import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  findScoringConfig,
  updateScoringConfig,
  findScoringRules,
  findActiveScoringRules,
  findScoringRuleById,
  insertScoringRule,
  updateScoringRule,
  deleteScoringRule,
  updateLeadScore,
} from './scoring.repository';
import { pool } from '../../shared/utils/db';
import {
  ScoringConfig,
  ScoringRule,
  CreateScoringRuleInput,
  UpdateScoringRuleInput,
  LeadScore,
} from './scoring.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export async function getConfig(): Promise<ScoringConfig | null> {
  return findScoringConfig();
}

export async function updateConfig(
  data: { hot_min_score?: number; warm_min_score?: number; assignment_threshold?: number },
  actor: Actor,
): Promise<ScoringConfig> {
  const config = await updateScoringConfig(data, actor.id);

  await writeAuditLog({
    userId: actor.id,
    action: 'scoring_config.updated',
    entityType: 'scoring_config',
    entityId: config.id,
    newValue: config,
    ipAddress: actor.ipAddress ?? null,
  });

  return config;
}

export async function getAllRules(): Promise<ScoringRule[]> {
  return findScoringRules();
}

export async function getRuleById(id: string): Promise<ScoringRule> {
  const rule = await findScoringRuleById(id);
  if (!rule) {
    throw new AppError('Scoring rule not found', 404);
  }
  return rule;
}

export async function createRule(
  input: CreateScoringRuleInput,
  actor: Actor,
): Promise<ScoringRule> {
  const rule = await insertScoringRule(
    {
      factor: input.factor,
      weight: input.weight,
      condition: input.condition,
      score_value: input.score_value,
      is_active: input.is_active ?? true,
    },
    actor.id,
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'scoring_rule.created',
    entityType: 'scoring_rule',
    entityId: rule.id,
    newValue: rule,
    ipAddress: actor.ipAddress ?? null,
  });

  return rule;
}

export async function updateRuleById(
  id: string,
  input: UpdateScoringRuleInput,
  actor: Actor,
): Promise<ScoringRule> {
  const existing = await findScoringRuleById(id);
  if (!existing) {
    throw new AppError('Scoring rule not found', 404);
  }

  const updated = await updateScoringRule(id, input);

  await writeAuditLog({
    userId: actor.id,
    action: 'scoring_rule.updated',
    entityType: 'scoring_rule',
    entityId: id,
    oldValue: existing,
    newValue: updated,
    ipAddress: actor.ipAddress ?? null,
  });

  return updated;
}

export async function deleteRuleById(id: string, actor: Actor): Promise<void> {
  const existing = await findScoringRuleById(id);
  if (!existing) {
    throw new AppError('Scoring rule not found', 404);
  }

  await deleteScoringRule(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'scoring_rule.deleted',
    entityType: 'scoring_rule',
    entityId: id,
    oldValue: existing,
    ipAddress: actor.ipAddress ?? null,
  });
}

interface LeadRow {
  id: string;
  website: string | null;
  google_rating: number | null;
  review_count: number | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  country: string | null;
  source: string | null;
  replied_at: Date | null;
  social_links: Record<string, string> | null;
}

function evaluateCondition(
  lead: LeadRow,
  factor: string,
  condition: Record<string, unknown>,
): boolean {
  const leadRecord = lead as unknown as Record<string, unknown>;

  // Numeric threshold: {"gte": N} — compare lead[factor] against N
  if ('gte' in condition) {
    const value = leadRecord[factor];
    return (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !Number.isNaN(Number(value)) &&
      Number(value) >= Number(condition.gte)
    );
  }

  // Field existence: {"exists": "fieldName"} — check lead[fieldName] is truthy
  if ('exists' in condition) {
    const field = String(condition.exists);
    const val = leadRecord[field];
    if (val === null || val === undefined || val === '') return false;
    if (typeof val === 'object' && Object.keys(val).length === 0) return false;
    return true;
  }

  // Industry list match: {"industries": [...]}
  if ('industries' in condition) {
    const industries = condition.industries as string[];
    return Array.isArray(industries) && industries.includes(String(lead.industry ?? ''));
  }

  // Country list match: {"countries": [...]}
  if ('countries' in condition) {
    const countries = condition.countries as string[];
    return Array.isArray(countries) && countries.includes(String(lead.country ?? ''));
  }

  // Source list match: {"source": [...]}
  if ('source' in condition) {
    const sources = condition.source as string[];
    return Array.isArray(sources) && sources.includes(String(leadRecord['source_platform'] ?? ''));
  }

  // Prior engagement: {"replied": true}
  if ('replied' in condition && condition.replied === true) {
    return lead.replied_at !== null;
  }

  // Generic value match: {"match": value | value[]}
  if ('match' in condition) {
    const matchTarget = condition.match;
    const leadValue = String(leadRecord[factor] ?? '');
    if (Array.isArray(matchTarget)) {
      return (matchTarget as string[]).includes(leadValue);
    }
    return leadValue === String(matchTarget);
  }

  return false;
}

export async function calculateLeadScore(leadId: string): Promise<LeadScore> {
  const leadResult = await pool.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [leadId]);
  if (leadResult.rows.length === 0) {
    throw new AppError('Lead not found', 404);
  }
  const lead = leadResult.rows[0];

  const config = await findScoringConfig();
  const rules = await findActiveScoringRules();

  let totalScore = 0;
  const factors: Array<{ factor: string; score: number; matched: boolean }> = [];

  for (const rule of rules) {
    const matched = evaluateCondition(lead, rule.factor, rule.condition);

    if (matched) {
      totalScore += rule.score_value;
    }

    factors.push({
      factor: rule.factor,
      score: rule.score_value,
      matched,
    });
  }

  totalScore = Math.min(100, Math.max(0, totalScore));

  let classification: 'hot' | 'warm' | 'cold' = 'cold';
  if (config) {
    if (totalScore >= config.hot_min_score) {
      classification = 'hot';
    } else if (totalScore >= config.warm_min_score) {
      classification = 'warm';
    }
  } else {
    if (totalScore >= 70) classification = 'hot';
    else if (totalScore >= 40) classification = 'warm';
  }

  await updateLeadScore(leadId, totalScore, classification);

  return {
    lead_id: leadId,
    score: totalScore,
    classification,
    factors,
  };
}

export async function recalculateAllScores(): Promise<{ processed: number }> {
  const leadsResult = await pool.query<{ id: string }>(
    'SELECT id FROM leads WHERE deleted_at IS NULL',
  );
  let processed = 0;

  for (const lead of leadsResult.rows) {
    try {
      await calculateLeadScore(lead.id);
      processed++;
    } catch (error) {
      // Log but continue with other leads
      logger.error(`Failed to calculate score for lead ${String(lead.id)}:`, {
        error: String(error),
      });
    }
  }

  return { processed };
}
