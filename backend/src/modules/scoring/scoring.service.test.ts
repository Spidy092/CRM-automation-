jest.mock('./scoring.repository', () => ({
  findScoringConfig: jest.fn(),
  updateScoringConfig: jest.fn(),
  findScoringRules: jest.fn(),
  findActiveScoringRules: jest.fn(),
  findScoringRuleById: jest.fn(),
  insertScoringRule: jest.fn(),
  updateScoringRule: jest.fn(),
  deleteScoringRule: jest.fn(),
  updateLeadScore: jest.fn(),
}));
jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import { AppError } from '../../shared/middleware/errorHandler';
import { pool } from '../../shared/utils/db';
import {
  findScoringConfig,
  updateScoringConfig as updateScoringConfigRepo,
  findScoringRules,
  findActiveScoringRules,
  findScoringRuleById,
  insertScoringRule,
  updateScoringRule as updateScoringRuleRepo,
  deleteScoringRule,
  updateLeadScore,
} from './scoring.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  calculateLeadScore,
  createRule,
  deleteRuleById,
  getAllRules,
  getConfig,
  getRuleById,
  recalculateAllScores,
  updateConfig,
  updateRuleById,
} from './scoring.service';

const config = {
  id: 'cfg-1',
  hot_min_score: 70,
  warm_min_score: 40,
  assignment_threshold: 70,
  updated_by: 'admin-1',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const baseRule = {
  id: 'rule-1',
  factor: 'has_website',
  weight: 10,
  condition: {},
  score_value: 10,
  is_active: true,
  created_by: 'admin-1',
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getConfig / updateConfig', () => {
  it('getConfig returns null when unset', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue(null);
    await expect(getConfig()).resolves.toBeNull();
  });

  it('updateConfig persists and audits', async () => {
    (updateScoringConfigRepo as jest.Mock).mockResolvedValue({ ...config, hot_min_score: 80 });
    const res = await updateConfig({ hot_min_score: 80 }, actor);
    expect(res.hot_min_score).toBe(80);
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('getRuleById / createRule / updateRuleById / deleteRuleById', () => {
  it('throws 404 when rule not found', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(null);
    await expect(getRuleById('x')).rejects.toBeInstanceOf(AppError);
  });

  it('createRule inserts and audits', async () => {
    (insertScoringRule as jest.Mock).mockResolvedValue(baseRule);
    const res = await createRule(
      { factor: 'has_website', weight: 10, condition: {}, score_value: 10 },
      actor,
    );
    expect(res.factor).toBe('has_website');
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('updateRuleById throws 404 when missing', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(null);
    await expect(updateRuleById('x', { weight: 5 }, actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updateRuleById persists and audits', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(baseRule);
    (updateScoringRuleRepo as jest.Mock).mockResolvedValue({ ...baseRule, weight: 25 });
    const res = await updateRuleById('rule-1', { weight: 25 }, actor);
    expect(res.weight).toBe(25);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('deleteRuleById throws 404 when missing', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(null);
    await expect(deleteRuleById('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deleteRuleById deletes and audits', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(baseRule);
    await deleteRuleById('rule-1', actor);
    expect(deleteScoringRule).toHaveBeenCalledWith('rule-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('calculateLeadScore', () => {
  it('throws 404 when lead missing', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
    await expect(calculateLeadScore('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('sums matched rule scores and classifies hot', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: 'lead-1',
          website: 'https://acme.com',
          google_rating: 4.5,
          review_count: 50,
          email: 'a@b.com',
          phone: '+1234567890',
          industry: 'Tech',
          country: 'US',
        },
      ],
    });
    (findScoringConfig as jest.Mock).mockResolvedValue(config);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'has_website', score_value: 30, condition: { exists: 'website' } },
      { factor: 'google_rating', score_value: 30, condition: { gte: 4.0 } },
      { factor: 'review_count', score_value: 20, condition: { gte: 10 } },
      { factor: 'has_email', score_value: 10, condition: { exists: 'email' } },
    ]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);

    const res = await calculateLeadScore('lead-1');
    expect(res.score).toBe(90);
    expect(res.classification).toBe('hot');
    expect(updateLeadScore).toHaveBeenCalledWith('lead-1', 90, 'hot');
  });

  it('uses fallback classification when no config', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'lead-1', website: null, google_rating: null, review_count: null, email: null, phone: null }],
    });
    (findScoringConfig as jest.Mock).mockResolvedValue(null);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([]);
    const res = await calculateLeadScore('lead-1');
    expect(res.classification).toBe('cold');
  });
});

describe('getAllRules / getRuleById', () => {
  it('getAllRules returns the rules from the repository', async () => {
    (findScoringRules as jest.Mock).mockResolvedValue([baseRule]);
    await expect(getAllRules()).resolves.toEqual([baseRule]);
  });

  it('getRuleById throws 404 when missing', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(null);
    await expect(getRuleById('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('getRuleById returns the rule when found', async () => {
    (findScoringRuleById as jest.Mock).mockResolvedValue(baseRule);
    await expect(getRuleById('rule-1')).resolves.toEqual(baseRule);
  });
});

describe('calculateLeadScore classification fallback branches', () => {
  const leadWithEmail = {
    id: 'lead-1',
    website: 'https://x.com',
    google_rating: null,
    review_count: null,
    email: 'a@b.com',
    phone: null,
    industry: null,
    country: null,
    source: null,
    replied_at: null,
    social_links: null,
  };

  it('classifies as warm via fallback when score is 40-69 and config is null', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [leadWithEmail] });
    (findScoringConfig as jest.Mock).mockResolvedValue(null);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 50, condition: { exists: 'email' } },
    ]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);
    const res = await calculateLeadScore('lead-1');
    expect(res.score).toBe(50);
    expect(res.classification).toBe('warm');
    expect(updateLeadScore).toHaveBeenCalledWith('lead-1', 50, 'warm');
  });

  it('classifies as hot via fallback when score >= 70 and config is null', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [leadWithEmail] });
    (findScoringConfig as jest.Mock).mockResolvedValue(null);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 80, condition: { exists: 'email' } },
    ]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);
    const res = await calculateLeadScore('lead-1');
    expect(res.classification).toBe('hot');
  });

  it('classifies as warm via config thresholds (between warm and hot)', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [leadWithEmail] });
    (findScoringConfig as jest.Mock).mockResolvedValue({
      hot_min_score: 80,
      warm_min_score: 50,
      assignment_threshold: 70,
      updated_by: 'admin-1',
      updated_at: '2026-06-19T00:00:00.000Z',
    });
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 60, condition: { exists: 'email' } },
    ]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);
    const res = await calculateLeadScore('lead-1');
    expect(res.classification).toBe('warm');
  });

  it('caps score at 100', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [leadWithEmail] });
    (findScoringConfig as jest.Mock).mockResolvedValue(config);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 200, condition: { exists: 'email' } },
    ]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);
    const res = await calculateLeadScore('lead-1');
    expect(res.score).toBe(100);
  });
});

describe('recalculateAllScores', () => {
  it('processes all leads and returns count', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'lead-1' }, { id: 'lead-2' }, { id: 'lead-3' }],
    });
    (findScoringConfig as jest.Mock).mockResolvedValue(config);
    (findActiveScoringRules as jest.Mock).mockResolvedValue([]);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);

    const res = await recalculateAllScores();
    expect(res.processed).toBe(3);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM leads WHERE deleted_at IS NULL'),
    );
  });

  it('continues processing when one lead throws', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'lead-1' }, { id: 'lead-2' }],
    });
    (findScoringConfig as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await recalculateAllScores();
    expect(res.processed).toBe(0);
  });
});

describe('evaluateCondition via calculateLeadScore (all condition types)', () => {
  // Exercises each branch of the private evaluateCondition() function
  // through the public calculateLeadScore() entrypoint.
  const baseLead = {
    id: 'lead-1',
    website: 'https://x.com',
    google_rating: 4.5,
    review_count: 50,
    email: 'a@b.com',
    phone: '+1',
    industry: 'SaaS',
    country: 'US',
    source_platform: 'google_ads',
    replied_at: new Date('2026-06-01'),
    social_links: { linkedin: 'x' },
  };

  beforeEach(() => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [baseLead] });
    (findScoringConfig as jest.Mock).mockResolvedValue(null);
    (updateLeadScore as jest.Mock).mockResolvedValue(undefined);
  });

  it('gte: matches when lead value >= threshold', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'google_rating', score_value: 10, condition: { gte: 4.0 } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
    expect(res.score).toBe(10);
  });

  it('gte: does not match when lead value is null', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ ...baseLead, google_rating: null }],
    });
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'google_rating', score_value: 10, condition: { gte: 4.0 } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
  });

  it('exists: matches truthy field', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 5, condition: { exists: 'email' } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('exists: does not match empty string', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ ...baseLead, email: '' }] });
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 5, condition: { exists: 'email' } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
  });

  it('industries: matches when industry is in list', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'industry', score_value: 5, condition: { industries: ['SaaS', 'Retail'] } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('industries: does not match when industry is null', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ ...baseLead, industry: null }] });
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'industry', score_value: 5, condition: { industries: ['SaaS'] } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
  });

  it('countries: matches when country is in list', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'country', score_value: 5, condition: { countries: ['US', 'CA'] } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('source: matches when source is in list', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'source', score_value: 5, condition: { source: ['google_ads', 'facebook'] } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('replied: matches when replied_at is not null', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'replied', score_value: 5, condition: { replied: true } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('replied: does not match when replied: false', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'replied', score_value: 5, condition: { replied: false } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
  });

  it('match: matches scalar value', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'industry', score_value: 5, condition: { match: 'SaaS' } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('match: matches when value is in array', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'industry', score_value: 5, condition: { match: ['SaaS', 'Retail'] } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(true);
  });

  it('match: does not match unrelated scalar', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'industry', score_value: 5, condition: { match: 'Healthcare' } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
  });

  it('unknown condition key returns false', async () => {
    (findActiveScoringRules as jest.Mock).mockResolvedValue([
      { factor: 'email', score_value: 5, condition: { something_else: true } },
    ]);
    const res = await calculateLeadScore('lead-1');
    expect(res.factors[0].matched).toBe(false);
    expect(res.score).toBe(0);
  });
});
