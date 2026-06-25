import { getConfigById, createConfig, updateConfig, runScrape, listConfigs } from './scraper.service';
import * as repo from './scraper.repository';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('./scraper.repository');
jest.mock('../../shared/utils/audit', () => ({
  writeAuditLog: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockActor = { id: 'admin-id', role: 'admin' as const };

describe('Scraper Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listConfigs', () => {
    it('lists configs', async () => {
      (repo.findScraperConfigs as jest.Mock).mockResolvedValue([{ id: '1' }]);
      const result = await listConfigs();
      expect(result).toHaveLength(1);
    });
  });

  describe('getConfigById', () => {
    it('returns config if found', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1' });
      const result = await getConfigById('1');
      expect(result.id).toBe('1');
    });

    it('throws 404 if not found', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(null);
      await expect(getConfigById('1')).rejects.toThrow(AppError);
    });
  });

  describe('createConfig', () => {
    it('creates config successfully', async () => {
      process.env.GOOGLE_PLACES_API_KEY = 'test-key';
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({ id: '1', name: 'Test', source_type: 'google_places' });
      
      const result = await createConfig({
        name: 'Test',
        source_type: 'google_places',
        config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY' },
      }, mockActor);
      
      expect(result.id).toBe('1');
    });

    it('throws if api key env var is missing', async () => {
      delete process.env.GOOGLE_PLACES_API_KEY_MISSING;
      await expect(createConfig({
        name: 'Test',
        source_type: 'google_places',
        config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY_MISSING' },
      }, mockActor)).rejects.toThrow(AppError);
    });
  });

  describe('updateConfig', () => {
    it('updates config successfully', async () => {
      process.env.TEST_KEY = 'val';
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1', name: 'Old', source_type: 'google_places' });
      (repo.updateScraperConfig as jest.Mock).mockResolvedValue({ id: '1', name: 'New', source_type: 'google_places' });
      
      const result = await updateConfig('1', { name: 'New', config: { apiKeyRef: 'TEST_KEY' } }, mockActor);
      expect(result.name).toBe('New');
    });
  });

  describe('runScrape', () => {
    it('throws if config is inactive', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1', is_active: false });
      await expect(runScrape('1', mockActor)).rejects.toThrow(AppError);
    });

    it('handles google places scrape', async () => {
      process.env.GOOGLE_PLACES_API_KEY = 'test';
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: '1',
        is_active: true,
        source_type: 'google_places',
        config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'restaurants' },
      });
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-1' });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
      });

      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });
  });
});
