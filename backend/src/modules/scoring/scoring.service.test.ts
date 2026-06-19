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
  getConfig,
  getRuleById,
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
      { factor: 'has_website', score_value: 30, condition: {} },
      { factor: 'has_google_rating', score_value: 30, condition: {} },
      { factor: 'high_review_count', score_value: 20, condition: {} },
      { factor: 'has_email', score_value: 10, condition: {} },
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
