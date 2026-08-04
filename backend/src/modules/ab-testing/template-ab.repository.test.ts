import { pool, query, queryOne } from '../../shared/utils/db';
import {
  findVariantsByTemplate,
  findTemplateVariantById,
  insertTemplateVariant,
  updateTemplateVariant,
  deleteTemplateVariant,
  setTemplateVariantWinner,
  assignLeadToTemplateVariant,
  assignLeadToTemplateVariantByWeight,
  getTemplateVariantMetrics,
} from './template-ab.repository';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;
const mockQuery = query as unknown as jest.Mock;
const mockQueryOne = queryOne as unknown as jest.Mock;

describe('template-ab.repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('findVariantsByTemplate', () => {
    it('queries variants ordered by variant_key', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'v1' }]);
      const result = await findVariantsByTemplate('t1');
      expect(result).toEqual([{ id: 'v1' }]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY variant_key'), [
        't1',
      ]);
    });
  });

  describe('findTemplateVariantById', () => {
    it('returns the row when found', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'v1' });
      const result = await findTemplateVariantById('v1');
      expect(result).toEqual({ id: 'v1' });
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await findTemplateVariantById('missing');
      expect(result).toBeNull();
    });
  });

  describe('insertTemplateVariant', () => {
    it('inserts and returns the created variant', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'v1', name: 'A' });
      const result = await insertTemplateVariant({
        template_id: 't1',
        name: 'A',
        variant_key: 'a',
        body: 'hello',
        split_pct: 50,
      });
      expect(result).toEqual({ id: 'v1', name: 'A' });
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO template_variants'),
        ['t1', 'A', 'a', null, 'hello', 50],
      );
    });

    it('throws an AppError when insert returns no row', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(
        insertTemplateVariant({
          template_id: 't1',
          name: 'A',
          variant_key: 'a',
          body: 'hello',
          split_pct: 50,
        }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('updateTemplateVariant', () => {
    it('builds a dynamic SET clause for provided fields', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'v1', name: 'New' });
      const result = await updateTemplateVariant('v1', { name: 'New', split_pct: 60 });
      expect(result).toEqual({ id: 'v1', name: 'New' });
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('SET name = $1, split_pct = $2'),
        ['New', 60, 'v1'],
      );
    });

    it('returns the existing variant unchanged when no fields are given', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'v1', name: 'Existing' });
      const result = await updateTemplateVariant('v1', {});
      expect(result).toEqual({ id: 'v1', name: 'Existing' });
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('SELECT'), ['v1']);
    });

    it('throws AppError(404) when no fields given and the variant does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(updateTemplateVariant('missing', {})).rejects.toThrow(AppError);
    });

    it('throws AppError(404) when update affects no row', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(updateTemplateVariant('v1', { name: 'X' })).rejects.toThrow(AppError);
    });
  });

  describe('deleteTemplateVariant', () => {
    it('resolves when the variant is deleted', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'v1' });
      await expect(deleteTemplateVariant('v1')).resolves.toBeUndefined();
    });

    it('throws AppError(404) when nothing was deleted', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(deleteTemplateVariant('missing')).rejects.toThrow(AppError);
    });
  });

  describe('setTemplateVariantWinner', () => {
    it('marks the variant a winner and clears winner flag on siblings', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await setTemplateVariantWinner('v1');
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
      expect(mockPoolQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("status = 'winner'"), [
        'v1',
      ]);
      expect(mockPoolQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('is_winner = false'),
        ['v1'],
      );
    });
  });

  describe('assignLeadToTemplateVariant', () => {
    it('returns the inserted assignment row', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'a1',
        variant_id: 'v1',
        lead_id: 'l1',
        assigned_at: '2026-01-01',
      });
      const result = await assignLeadToTemplateVariant('v1', 'l1');
      expect(result).toEqual({
        id: 'a1',
        variant_id: 'v1',
        lead_id: 'l1',
        assigned_at: '2026-01-01',
      });
    });

    it('returns a synthetic assignment on conflict (no row returned)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await assignLeadToTemplateVariant('v1', 'l1');
      expect(result.variant_id).toBe('v1');
      expect(result.lead_id).toBe('l1');
      expect(result.id).toBe('');
      expect(typeof result.assigned_at).toBe('string');
    });
  });

  describe('assignLeadToTemplateVariantByWeight', () => {
    it('returns null when the template has no variants', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await assignLeadToTemplateVariantByWeight('t1', 'l1');
      expect(result).toBeNull();
    });

    it('picks a variant weighted by split_pct and assigns the lead to it', async () => {
      const variants = [
        { id: 'v1', split_pct: 100 },
        { id: 'v2', split_pct: 0 },
      ];
      mockQuery.mockResolvedValueOnce(variants); // findVariantsByTemplate
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 * 100 = 50, first variant covers it
      mockQueryOne.mockResolvedValueOnce(null); // assignLeadToTemplateVariant insert (conflict path, fine)
      const result = await assignLeadToTemplateVariantByWeight('t1', 'l1');
      expect(result).toEqual(variants[0]);
      randomSpy.mockRestore();
    });

    it('falls back to the first variant if the weighted loop never resolves', async () => {
      const variants = [{ id: 'v1', split_pct: 0 }];
      mockQuery.mockResolvedValueOnce(variants);
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9); // random * 0 total weight = 0
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await assignLeadToTemplateVariantByWeight('t1', 'l1');
      expect(result).toEqual(variants[0]);
      randomSpy.mockRestore();
    });
  });

  describe('getTemplateVariantMetrics', () => {
    it('parses aggregate counts from the row', async () => {
      mockQueryOne.mockResolvedValueOnce({
        sent: '10',
        delivered: '8',
        opened: '5',
        clicked: '2',
        replied: '1',
        failed: '1',
      });
      const result = await getTemplateVariantMetrics('v1');
      expect(result).toEqual({
        sent: 10,
        delivered: 8,
        opened: 5,
        clicked: 2,
        replied: 1,
        failed: 1,
      });
    });

    it('defaults to zero for every metric when no row is returned', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await getTemplateVariantMetrics('v1');
      expect(result).toEqual({
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        failed: 0,
      });
    });
  });
});
