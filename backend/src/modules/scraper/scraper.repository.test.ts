import { findScraperConfigs, findScraperConfigById, insertScraperConfig, updateScraperConfig, deleteScraperConfig, insertScraperLog, updateScraperLog, findScraperLogsByConfig, countScraperLogsByConfig } from './scraper.repository';
import { query, queryOne, pool } from '../../shared/utils/db';

jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  pool: {
    query: jest.fn(),
  },
}));

describe('Scraper Repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findScraperConfigs', () => {
    it('returns configs', async () => {
      const mockRows = [{ id: '1', name: 'Test' }];
      (query as jest.Mock).mockResolvedValue(mockRows);

      const result = await findScraperConfigs();
      expect(result).toEqual(mockRows);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, name'));
    });
  });

  describe('findScraperConfigById', () => {
    it('returns a config by id', async () => {
      const mockRow = { id: '1', name: 'Test' };
      (queryOne as jest.Mock).mockResolvedValue(mockRow);

      const result = await findScraperConfigById('1');
      expect(result).toEqual(mockRow);
      expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('SELECT id, name'), ['1']);
    });
  });

  describe('insertScraperConfig', () => {
    it('inserts and returns config', async () => {
      const mockRow = { id: '1', name: 'New Config' };
      (queryOne as jest.Mock).mockResolvedValue(mockRow);

      const result = await insertScraperConfig({
        name: 'New Config',
        source_type: 'google_places',
        config: { query: 'test' },
      }, 'admin');

      expect(result).toEqual(mockRow);
      expect(queryOne).toHaveBeenCalled();
    });
  });

  describe('updateScraperConfig', () => {
    it('updates and returns config', async () => {
      const mockRow = { id: '1', name: 'Updated Config' };
      (queryOne as jest.Mock).mockResolvedValue(mockRow);

      const result = await updateScraperConfig('1', { name: 'Updated Config' });
      expect(result).toEqual(mockRow);
      expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('UPDATE scraper_configs'), expect.any(Array));
    });
  });

  describe('deleteScraperConfig', () => {
    it('deletes config', async () => {
      await deleteScraperConfig('1');
      expect(pool.query).toHaveBeenCalledWith('DELETE FROM scraper_configs WHERE id = $1', ['1']);
    });
  });

  describe('insertScraperLog', () => {
    it('inserts log', async () => {
      const mockRow = { id: 'log-1' };
      (queryOne as jest.Mock).mockResolvedValue(mockRow);

      const result = await insertScraperLog({ config_id: '1', status: 'running' });
      expect(result).toEqual(mockRow);
    });
  });

  describe('updateScraperLog', () => {
    it('updates log', async () => {
      const mockRow = { id: 'log-1', status: 'completed' };
      (queryOne as jest.Mock).mockResolvedValue(mockRow);

      const result = await updateScraperLog('log-1', { status: 'completed' });
      expect(result).toEqual(mockRow);
    });
  });

  describe('findScraperLogsByConfig', () => {
    it('returns logs', async () => {
      (query as jest.Mock).mockResolvedValue([{ id: 'log-1' }]);
      const result = await findScraperLogsByConfig('1', 10, 0);
      expect(result).toHaveLength(1);
    });
  });

  describe('countScraperLogsByConfig', () => {
    it('returns count', async () => {
      (queryOne as jest.Mock).mockResolvedValue({ count: '5' });
      const result = await countScraperLogsByConfig('1');
      expect(result).toBe(5);
    });
  });
});
