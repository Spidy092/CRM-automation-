import { pool } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { ScoringConfig, ScoringRule } from './scoring.types';

export async function findScoringConfig(): Promise<ScoringConfig | null> {
  const result = await pool.query<ScoringConfig>('SELECT * FROM scoring_config LIMIT 1');
  return result.rows[0] || null;
}

export async function updateScoringConfig(
  data: { hot_min_score?: number; warm_min_score?: number; assignment_threshold?: number },
  updatedBy: string,
): Promise<ScoringConfig> {
  const existing = await findScoringConfig();

  if (!existing) {
    const result = await pool.query<ScoringConfig>(
      `INSERT INTO scoring_config (hot_min_score, warm_min_score, assignment_threshold, updated_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        data.hot_min_score ?? 70,
        data.warm_min_score ?? 40,
        data.assignment_threshold ?? 70,
        updatedBy,
      ],
    );
    return result.rows[0];
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.hot_min_score !== undefined) {
    fields.push(`hot_min_score = $${paramIndex++}`);
    values.push(data.hot_min_score);
  }
  if (data.warm_min_score !== undefined) {
    fields.push(`warm_min_score = $${paramIndex++}`);
    values.push(data.warm_min_score);
  }
  if (data.assignment_threshold !== undefined) {
    fields.push(`assignment_threshold = $${paramIndex++}`);
    values.push(data.assignment_threshold);
  }

  fields.push(`updated_by = $${paramIndex++}`);
  values.push(updatedBy);

  values.push(existing.id);
  const result = await pool.query<ScoringConfig>(
    `UPDATE scoring_config SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Scoring config not found', 404);
  return row;
}

export async function findScoringRules(): Promise<ScoringRule[]> {
  const result = await pool.query<ScoringRule>(
    'SELECT * FROM scoring_rules ORDER BY created_at DESC',
  );
  return result.rows;
}

export async function findActiveScoringRules(): Promise<ScoringRule[]> {
  const result = await pool.query<ScoringRule>(
    'SELECT * FROM scoring_rules WHERE is_active = TRUE ORDER BY weight DESC',
  );
  return result.rows;
}

export async function findScoringRuleById(id: string): Promise<ScoringRule | null> {
  const result = await pool.query<ScoringRule>('SELECT * FROM scoring_rules WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function insertScoringRule(
  data: {
    factor: string;
    weight: number;
    condition: Record<string, unknown>;
    score_value: number;
    is_active: boolean;
  },
  createdBy: string,
): Promise<ScoringRule> {
  const result = await pool.query<ScoringRule>(
    `INSERT INTO scoring_rules (factor, weight, condition, score_value, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      data.factor,
      data.weight,
      JSON.stringify(data.condition),
      data.score_value,
      data.is_active,
      createdBy,
    ],
  );
  return result.rows[0];
}

export async function updateScoringRule(
  id: string,
  data: {
    factor?: string;
    weight?: number;
    condition?: Record<string, unknown>;
    score_value?: number;
    is_active?: boolean;
  },
): Promise<ScoringRule> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.factor !== undefined) {
    fields.push(`factor = $${paramIndex++}`);
    values.push(data.factor);
  }
  if (data.weight !== undefined) {
    fields.push(`weight = $${paramIndex++}`);
    values.push(data.weight);
  }
  if (data.condition !== undefined) {
    fields.push(`condition = $${paramIndex++}`);
    values.push(JSON.stringify(data.condition));
  }
  if (data.score_value !== undefined) {
    fields.push(`score_value = $${paramIndex++}`);
    values.push(data.score_value);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(data.is_active);
  }

  values.push(id);
  const result = await pool.query<ScoringRule>(
    `UPDATE scoring_rules SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Scoring rule not found', 404);
  return row;
}

export async function deleteScoringRule(id: string): Promise<void> {
  await pool.query('DELETE FROM scoring_rules WHERE id = $1', [id]);
}

export async function updateLeadScore(
  leadId: string,
  score: number,
  classification: 'hot' | 'warm' | 'cold',
): Promise<void> {
  await pool.query('UPDATE leads SET lead_score = $1, classification = $2 WHERE id = $3', [
    score,
    classification,
    leadId,
  ]);
}
