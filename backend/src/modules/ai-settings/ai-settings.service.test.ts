import { findAiSettings, upsertAiSettings } from './ai-settings.repository';
import { getAiSettingsPublic, updateAiSettings, getAiConfig } from './ai-settings.service';
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

const baseRow = {
  id: 'cfg-1',
  enabled: true,
  base_url: 'https://api.openai.com',
  encrypted_api_key: 'encrypted-key',
  model: 'gpt-4o',
  max_tokens: 500,
  temperature: '0.7',
  system_prompt_override: null,
  cache_ttl_seconds: 3600,
  updated_by: 'admin-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ai-settings.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (findAiSettings as jest.Mock).mockReset();
    (upsertAiSettings as jest.Mock).mockReset();
  });

  describe('getAiSettingsPublic', () => {
    it('returns public settings when row exists', async () => {
      (findAiSettings as jest.Mock).mockResolvedValueOnce(baseRow);
      const result = await getAiSettingsPublic();
      expect(result.id).toBe('cfg-1');
      expect(result.enabled).toBe(true);
      expect(result.has_api_key).toBe(true);
      expect(result.max_tokens).toBe(500);
      expect(result.temperature).toBe(0.7);
    });

    it('throws 404 when row does not exist', async () => {
      (findAiSettings as jest.Mock).mockResolvedValueOnce(null);
      await expect(getAiSettingsPublic()).rejects.toBeInstanceOf(AppError);
      await expect(getAiSettingsPublic()).rejects.toMatchObject({
        statusCode: 404,
        message: 'AI settings not found',
      });
    });
  });

  describe('updateAiSettings', () => {
    it('encrypts API key when provided', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      (upsertAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        encrypted_api_key: 'cipher-text',
      });
      const result = await updateAiSettings(
        { api_key: 'sk-new-key' },
        'admin-1',
      );
      const callArg = (upsertAiSettings as jest.Mock).mock.calls[0][0];
      expect(callArg.updated_by).toBe('admin-1');
      expect(callArg.encrypted_api_key).toBeTruthy();
      expect(callArg.encrypted_api_key).not.toBe('sk-new-key');
      expect(result.has_api_key).toBe(true);
    });

    it('clears API key when null provided', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      (upsertAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        encrypted_api_key: null,
      });
      const result = await updateAiSettings({ api_key: null }, 'admin-1');
      expect(upsertAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          encrypted_api_key: null,
        }),
      );
      expect(result.has_api_key).toBe(false);
    });

    it('clamps max_tokens to 500', async () => {
      (upsertAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        max_tokens: 500,
      });
      await updateAiSettings({ max_tokens: 1000 }, 'admin-1');
      expect(upsertAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 500 }),
      );
    });

    it('stores plaintext when ENCRYPTION_KEY is missing', async () => {
      delete process.env.ENCRYPTION_KEY;
      (upsertAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        encrypted_api_key: 'plain:sk-plain',
      });
      await updateAiSettings({ api_key: 'sk-plain' }, 'admin-1');
      expect(upsertAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          encrypted_api_key: 'plain:sk-plain',
        }),
      );
    });
  });

  describe('getAiConfig', () => {
    it('returns null when row is null', async () => {
      (findAiSettings as jest.Mock).mockResolvedValueOnce(null);
      const result = await getAiConfig();
      expect(result).toBeNull();
    });

    it('returns null when AI is disabled', async () => {
      (findAiSettings as jest.Mock).mockResolvedValueOnce({ ...baseRow, enabled: false });
      const result = await getAiConfig();
      expect(result).toBeNull();
    });

    it('returns null when API key is missing', async () => {
      (findAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        encrypted_api_key: null,
      });
      const result = await getAiConfig();
      expect(result).toBeNull();
    });

    it('returns full config with decrypted key when valid', async () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      // Encrypt a real key to use as the stored value
      const crypto = jest.requireActual('crypto');
      const key = Buffer.from('a'.repeat(64), 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update('sk-real-key', 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const encrypted = Buffer.concat([iv, tag, enc]).toString('base64');

      (findAiSettings as jest.Mock).mockResolvedValueOnce({
        ...baseRow,
        encrypted_api_key: encrypted,
      });
      const result = await getAiConfig();
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe('sk-real-key');
      expect(result?.model).toBe('gpt-4o');
      expect(result?.maxTokens).toBe(500);
      expect(result?.temperature).toBe(0.7);
    });
  });
});
