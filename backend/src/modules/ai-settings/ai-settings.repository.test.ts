import { pool } from '../../shared/utils/db';
import { findAiSettings, upsertAiSettings } from './ai-settings.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockedPool = pool as unknown as { query: jest.Mock };

const baseRow = {
  id: 's-1',
  enabled: true,
  base_url: 'https://api.openai.com',
  encrypted_api_key: 'enc-key',
  model: 'gpt-4o',
  max_tokens: 500,
  temperature: '0.7',
  system_prompt_override: null,
  cache_ttl_seconds: 3600,
  updated_by: 'u-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

describe('ai-settings repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAiSettings', () => {
    it('returns the first ai_settings row', async () => {
      mockedPool.query.mockResolvedValueOnce({ rows: [baseRow] });

      const result = await findAiSettings();

      expect(result).toEqual(baseRow);
      expect(mockedPool.query).toHaveBeenCalledTimes(1);
      expect(mockedPool.query.mock.calls[0][0]).toContain('SELECT');
      expect(mockedPool.query.mock.calls[0][0]).toContain('FROM ai_settings');
    });

    it('returns null when no row exists', async () => {
      mockedPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await findAiSettings();

      expect(result).toBeNull();
    });

    it('rethrows database errors', async () => {
      const error = new Error('connection failed');
      mockedPool.query.mockRejectedValueOnce(error);

      await expect(findAiSettings()).rejects.toThrow(error);
    });
  });

  describe('upsertAiSettings', () => {
    it('inserts default row and updates with no additional fields', async () => {
      mockedPool.query.mockResolvedValueOnce({ rows: [] });
      mockedPool.query.mockResolvedValueOnce({ rows: [{ ...baseRow }] });

      const result = await upsertAiSettings({});

      expect(result).toEqual(baseRow);
      expect(mockedPool.query).toHaveBeenCalledTimes(2);
      expect(mockedPool.query.mock.calls[0][0]).toContain('INSERT INTO ai_settings');
      expect(mockedPool.query.mock.calls[1][0]).toContain('UPDATE ai_settings');
    });

    it('sets each supported field when provided', async () => {
      mockedPool.query.mockResolvedValueOnce({ rows: [] });
      mockedPool.query.mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            enabled: false,
            base_url: 'http://localhost:11434',
            encrypted_api_key: null,
            model: 'llama3',
            max_tokens: 100,
            temperature: '0.5',
            system_prompt_override: 'override',
            cache_ttl_seconds: 60,
            updated_by: 'u-2',
          },
        ],
      });

      const result = await upsertAiSettings({
        enabled: false,
        base_url: 'http://localhost:11434',
        encrypted_api_key: null,
        model: 'llama3',
        max_tokens: 100,
        temperature: 0.5,
        system_prompt_override: 'override',
        cache_ttl_seconds: 60,
        updated_by: 'u-2',
      });

      expect(result.enabled).toBe(false);
      expect(result.base_url).toBe('http://localhost:11434');
      expect(result.encrypted_api_key).toBeNull();
      expect(result.model).toBe('llama3');
      expect(result.max_tokens).toBe(100);
      expect(result.temperature).toBe('0.5');
      expect(result.system_prompt_override).toBe('override');
      expect(result.cache_ttl_seconds).toBe(60);
      expect(result.updated_by).toBe('u-2');

      const updateSql = mockedPool.query.mock.calls[1][0] as string;
      const values = mockedPool.query.mock.calls[1][1] as unknown[];
      expect(updateSql).toContain('enabled = $1');
      expect(updateSql).toContain('base_url = $2');
      expect(updateSql).toContain('encrypted_api_key = $3');
      expect(updateSql).toContain('model = $4');
      expect(updateSql).toContain('max_tokens = $5');
      expect(updateSql).toContain('temperature = $6');
      expect(updateSql).toContain('system_prompt_override = $7');
      expect(updateSql).toContain('cache_ttl_seconds = $8');
      expect(updateSql).toContain('updated_by = $9');
      expect(values).toEqual([
        false,
        'http://localhost:11434',
        null,
        'llama3',
        100,
        0.5,
        'override',
        60,
        'u-2',
      ]);
    });

    it('skips clauses for fields that are undefined', async () => {
      mockedPool.query.mockResolvedValueOnce({ rows: [] });
      mockedPool.query.mockResolvedValueOnce({ rows: [{ ...baseRow }] });

      await upsertAiSettings({ model: 'gpt-4o-mini' });

      const updateSql = mockedPool.query.mock.calls[1][0] as string;
      expect(updateSql).toContain('model = $1');
      expect(updateSql).not.toContain('enabled =');
      expect(updateSql).not.toContain('base_url =');
      expect(updateSql).not.toContain('encrypted_api_key =');
    });

    it('propagates database errors', async () => {
      const error = new Error('insert failed');
      mockedPool.query.mockRejectedValueOnce(error);

      await expect(upsertAiSettings({ model: 'x' })).rejects.toThrow(error);
    });
  });
});
