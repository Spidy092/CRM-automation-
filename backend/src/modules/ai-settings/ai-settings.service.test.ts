import crypto from 'crypto';
import { findAiSettings, upsertAiSettings } from './ai-settings.repository';
import {
  getAiConfig,
  getAiSettingsPublic,
  updateAiSettings,
} from './ai-settings.service';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('./ai-settings.repository', () => ({
  findAiSettings: jest.fn(),
  upsertAiSettings: jest.fn(),
}));

jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedFind = findAiSettings as jest.Mock;
const mockedUpsert = upsertAiSettings as jest.Mock;

const baseRow = {
  id: 's-1',
  enabled: true,
  base_url: 'https://api.openai.com',
  encrypted_api_key: 'plain:my-key',
  model: 'gpt-4o',
  max_tokens: 500,
  temperature: '0.7',
  system_prompt_override: null,
  cache_ttl_seconds: 3600,
  updated_by: 'u-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

describe('ai-settings service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENCRYPTION_KEY;
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  describe('getAiSettingsPublic', () => {
    it('throws a 404 error when no settings exist', async () => {
      mockedFind.mockResolvedValueOnce(null);

      await expect(getAiSettingsPublic()).rejects.toThrow(AppError);
      await expect(getAiSettingsPublic()).rejects.toThrow('AI settings not found');
    });

    it('returns public settings with has_api_key true', async () => {
      mockedFind.mockResolvedValueOnce(baseRow);

      const result = await getAiSettingsPublic();

      expect(result).toEqual({
        id: baseRow.id,
        enabled: baseRow.enabled,
        base_url: baseRow.base_url,
        has_api_key: true,
        model: baseRow.model,
        max_tokens: baseRow.max_tokens,
        temperature: 0.7,
        system_prompt_override: baseRow.system_prompt_override,
        cache_ttl_seconds: baseRow.cache_ttl_seconds,
        updated_by: baseRow.updated_by,
        updated_at: baseRow.updated_at,
      });
    });

    it('returns public settings with has_api_key false', async () => {
      mockedFind.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: null });

      const result = await getAiSettingsPublic();

      expect(result.has_api_key).toBe(false);
    });
  });

  describe('updateAiSettings', () => {
    it('updates all supported fields and encrypts an API key in plaintext mode', async () => {
      mockedUpsert.mockResolvedValueOnce({
        ...baseRow,
        enabled: false,
        base_url: 'http://localhost:11434',
        encrypted_api_key: 'plain:new-key',
        model: 'llama3',
        max_tokens: 500,
        temperature: '0.5',
        system_prompt_override: 'override',
        cache_ttl_seconds: 60,
        updated_by: 'u-2',
      });

      const result = await updateAiSettings(
        {
          enabled: false,
          base_url: 'http://localhost:11434',
          api_key: 'new-key',
          model: 'llama3',
          max_tokens: 600,
          temperature: 0.5,
          system_prompt_override: 'override',
          cache_ttl_seconds: 60,
        },
        'u-2',
      );

      expect(result.enabled).toBe(false);
      expect(result.has_api_key).toBe(true);
      expect(mockedUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_by: 'u-2',
          enabled: false,
          base_url: 'http://localhost:11434',
          model: 'llama3',
          max_tokens: 500,
          temperature: 0.5,
          system_prompt_override: 'override',
          cache_ttl_seconds: 60,
          encrypted_api_key: 'plain:new-key',
        }),
      );
    });

    it('clears the API key when api_key is null', async () => {
      mockedUpsert.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: null });

      const result = await updateAiSettings({ api_key: null }, 'u-1');

      expect(result.has_api_key).toBe(false);
      expect(mockedUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_by: 'u-1',
          encrypted_api_key: null,
        }),
      );
    });

    it('leaves fields undefined out of the repo input', async () => {
      mockedUpsert.mockResolvedValueOnce(baseRow);

      await updateAiSettings({}, 'u-1');

      expect(mockedUpsert).toHaveBeenCalledWith({ updated_by: 'u-1' });
    });

    it('encrypts and decrypts API key when ENCRYPTION_KEY is set', async () => {
      const key = crypto.randomBytes(32).toString('hex');
      process.env.ENCRYPTION_KEY = key;
      mockedUpsert.mockImplementationOnce((input) =>
        Promise.resolve({ ...baseRow, encrypted_api_key: input.encrypted_api_key }),
      );

      await updateAiSettings({ api_key: 'secret-key' }, 'u-1');

      const storedKey = mockedUpsert.mock.calls[0][0].encrypted_api_key;
      expect(storedKey).not.toContain('plain:');

      mockedFind.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: storedKey });
      const config = await getAiConfig();

      expect(config?.apiKey).toBe('secret-key');
    });

    it('stores API key as plaintext when ENCRYPTION_KEY is not 32 bytes', async () => {
      process.env.ENCRYPTION_KEY = 'deadbeef';
      mockedUpsert.mockImplementationOnce((input) =>
        Promise.resolve({ ...baseRow, encrypted_api_key: input.encrypted_api_key }),
      );

      await updateAiSettings({ api_key: 'plain-secret' }, 'u-1');

      const storedKey = mockedUpsert.mock.calls[0][0].encrypted_api_key;
      expect(storedKey).toBe('plain:plain-secret');
    });
  });

  describe('getAiConfig', () => {
    it('returns null when settings do not exist', async () => {
      mockedFind.mockResolvedValueOnce(null);

      const result = await getAiConfig();

      expect(result).toBeNull();
    });

    it('returns null when AI is disabled', async () => {
      mockedFind.mockResolvedValueOnce({ ...baseRow, enabled: false });

      const result = await getAiConfig();

      expect(result).toBeNull();
    });

    it('returns null when no API key is configured', async () => {
      mockedFind.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: null });

      const result = await getAiConfig();

      expect(result).toBeNull();
    });

    it('returns null when encrypted key exists but cannot be decrypted', async () => {
      process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      mockedFind.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: 'invalid-ciphertext' });

      await expect(getAiConfig()).rejects.toThrow();
    });

    it('returns empty string and logs error when encrypted key exists without ENCRYPTION_KEY', async () => {
      const key = crypto.randomBytes(32).toString('hex');
      process.env.ENCRYPTION_KEY = key;
      mockedUpsert.mockImplementationOnce((input) =>
        Promise.resolve({ ...baseRow, encrypted_api_key: input.encrypted_api_key }),
      );
      await updateAiSettings({ api_key: 'secret' }, 'u-1');
      const encrypted = mockedUpsert.mock.calls[0][0].encrypted_api_key;

      delete process.env.ENCRYPTION_KEY;
      mockedFind.mockResolvedValueOnce({ ...baseRow, encrypted_api_key: encrypted });

      const result = await getAiConfig();
      expect(result).toBeNull();
    });

    it('returns full config when enabled with plaintext key', async () => {
      mockedFind.mockResolvedValueOnce(baseRow);

      const result = await getAiConfig();

      expect(result).toEqual({
        apiKey: 'my-key',
        baseUrl: baseRow.base_url,
        model: baseRow.model,
        maxTokens: 500,
        temperature: 0.7,
        systemPromptOverride: baseRow.system_prompt_override,
        cacheTtlSeconds: baseRow.cache_ttl_seconds,
      });
    });

    it('caps max_tokens at 500', async () => {
      mockedFind.mockResolvedValueOnce({ ...baseRow, max_tokens: 1000 });

      const result = await getAiConfig();

      expect(result?.maxTokens).toBe(500);
    });
  });
});
