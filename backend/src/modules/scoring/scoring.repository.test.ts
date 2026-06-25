import { pool } from '../../shared/utils/db';
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

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

describe('scoring.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findScoringConfig', () => {
    it('returns config when present', async () => {
      const row = { id: 'cfg-1', hot_min_score: 70 };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findScoringConfig()).resolves.toEqual(row);
    });

    it('returns null when no config', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findScoringConfig()).resolves.toBeNull();
    });
  });

  describe('updateScoringConfig', () => {
    it('inserts new config when none exists', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([]))
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-new', hot_min_score: 70 }]));
      const result = await updateScoringConfig({ hot_min_score: 70 }, 'admin-1');
      expect(result.id).toBe('cfg-new');
      expect(mockPoolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO scoring_config'),
        expect.any(Array),
      );
    });

    it('updates existing config partially', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1' }]))
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1', hot_min_score: 80 }]));
      const result = await updateScoringConfig({ hot_min_score: 80 }, 'admin-1');
      expect(result.hot_min_score).toBe(80);
      expect(mockPoolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE scoring_config'),
        expect.any(Array),
      );
    });

    it('throws 404 when update returns no row', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1' }]))
        .mockResolvedValueOnce(mockQueryResult([]));
      await expect(updateScoringConfig({ hot_min_score: 80 }, 'admin-1')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('findScoringRules', () => {
    it('returns all rules', async () => {
      const rows = [{ id: 'r1' }, { id: 'r2' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      await expect(findScoringRules()).resolves.toEqual(rows);
    });
  });

  describe('findActiveScoringRules', () => {
    it('returns active rules only', async () => {
      const rows = [{ id: 'r1', is_active: true }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      const result = await findActiveScoringRules();
      expect(result).toEqual(rows);
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('is_active = TRUE'));
    });
  });

  describe('findScoringRuleById', () => {
    it('returns row when found', async () => {
      const row = { id: 'r1' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findScoringRuleById('r1')).resolves.toEqual(row);
    });

    it('returns null when missing', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findScoringRuleById('missing')).resolves.toBeNull();
    });
  });

  describe('insertScoringRule', () => {
    it('inserts and returns rule', async () => {
      const row = { id: 'r1', factor: 'has_website', weight: 10 };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await insertScoringRule(
        { factor: 'has_website', weight: 10, condition: {}, score_value: 10, is_active: true },
        'admin-1',
      );
      expect(result).toEqual(row);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO scoring_rules'),
        ['has_website', 10, '{}', 10, true, 'admin-1'],
      );
    });
  });

  describe('updateScoringRule', () => {
    it('updates fields and returns row', async () => {
      const row = { id: 'r1', weight: 20 };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await updateScoringRule('r1', { weight: 20 });
      expect(result).toEqual(row);
    });

    it('serializes condition to JSON', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([{ id: 'r1' }]));
      await updateScoringRule('r1', { condition: { match: 'x' } });
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scoring_rules'),
        ['{"match":"x"}', 'r1'],
      );
    });

    it('throws 404 when no row', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(updateScoringRule('missing', { weight: 1 })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('deleteScoringRule', () => {
    it('executes delete', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await deleteScoringRule('r1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM scoring_rules'),
        ['r1'],
      );
    });
  });

  describe('updateLeadScore', () => {
    it('updates lead score and classification', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await updateLeadScore('lead-1', 85, 'hot');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads SET lead_score'),
        [85, 'hot', 'lead-1'],
      );
    });
  });
});
