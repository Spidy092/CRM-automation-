import { pool } from '../../shared/utils/db';
import {
  findPipelines,
  findPipelineById,
  findPipelineWithStages,
  insertPipeline,
  updatePipeline,
  deletePipeline,
  insertStage,
  updateStage,
  deleteStage,
  findStagesByPipeline,
  findStageById,
  moveLeadToStage,
  findDefaultPipeline,
} from './pipeline.repository';

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

describe('pipeline.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findPipelines', () => {
    it('returns rows', async () => {
      const rows = [{ id: 'p1', name: 'Default' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      const result = await findPipelines();
      expect(result).toEqual(rows);
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM pipelines'));
    });
  });

  describe('findPipelineById', () => {
    it('returns row when found', async () => {
      const row = { id: 'p1', name: 'Default' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await findPipelineById('p1');
      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      const result = await findPipelineById('missing');
      expect(result).toBeNull();
    });
  });

  describe('findPipelineWithStages', () => {
    it('returns pipeline with stages', async () => {
      const pipeline = { id: 'p1', name: 'Default' };
      const stages = [{ id: 's1', name: 'New', position: 1 }];
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([pipeline]))
        .mockResolvedValueOnce(mockQueryResult(stages));
      const result = await findPipelineWithStages('p1');
      expect(result).toEqual({ ...pipeline, stages });
    });

    it('returns null when pipeline missing', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      const result = await findPipelineWithStages('missing');
      expect(result).toBeNull();
    });
  });

  describe('insertPipeline', () => {
    it('inserts and returns the row', async () => {
      const row = { id: 'p1', name: 'Sales', is_default: false };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await insertPipeline('Sales', false, 'admin-1');
      expect(result).toEqual(row);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pipelines'),
        ['Sales', false, 'admin-1'],
      );
    });
  });

  describe('updatePipeline', () => {
    it('updates name only', async () => {
      const row = { id: 'p1', name: 'New Name', is_default: false };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await updatePipeline('p1', { name: 'New Name' });
      expect(result).toEqual(row);
    });

    it('updates is_default only', async () => {
      const row = { id: 'p1', name: 'X', is_default: true };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await updatePipeline('p1', { is_default: true });
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_default = $1'),
        [true, 'p1'],
      );
    });

    it('throws 404 when no row returned', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(updatePipeline('missing', { name: 'x' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('deletePipeline', () => {
    it('executes delete', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await deletePipeline('p1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM pipelines'),
        ['p1'],
      );
    });
  });

  describe('insertStage', () => {
    it('inserts and returns the stage', async () => {
      const row = { id: 's1', pipeline_id: 'p1', name: 'New', position: 1 };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await insertStage('p1', 'New', 1, false, false);
      expect(result).toEqual(row);
    });
  });

  describe('updateStage', () => {
    it('updates all fields', async () => {
      const row = { id: 's1', name: 'X', position: 2, is_terminal_won: true, is_terminal_lost: false };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await updateStage('s1', {
        name: 'X',
        position: 2,
        is_terminal_won: true,
        is_terminal_lost: false,
      });
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pipeline_stages'),
        ['X', 2, true, false, 's1'],
      );
    });

    it('throws 404 when no row returned', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(updateStage('missing', { name: 'x' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('deleteStage', () => {
    it('executes delete', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await deleteStage('s1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM pipeline_stages'),
        ['s1'],
      );
    });
  });

  describe('findStagesByPipeline', () => {
    it('returns stages ordered', async () => {
      const rows = [{ id: 's1' }, { id: 's2' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      const result = await findStagesByPipeline('p1');
      expect(result).toEqual(rows);
    });
  });

  describe('findStageById', () => {
    it('returns row when found', async () => {
      const row = { id: 's1', name: 'New' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findStageById('s1')).resolves.toEqual(row);
    });

    it('returns null when missing', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findStageById('missing')).resolves.toBeNull();
    });
  });

  describe('moveLeadToStage', () => {
    it('updates lead pipeline_stage_id', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await moveLeadToStage('lead-1', 'stage-1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads SET pipeline_stage_id'),
        ['stage-1', 'lead-1'],
      );
    });
  });

  describe('findDefaultPipeline', () => {
    it('returns default pipeline', async () => {
      const row = { id: 'p1', is_default: true };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findDefaultPipeline()).resolves.toEqual(row);
    });

    it('returns null when no default', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findDefaultPipeline()).resolves.toBeNull();
    });
  });
});
