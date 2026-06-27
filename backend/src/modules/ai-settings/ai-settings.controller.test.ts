import type { Request, Response, NextFunction } from 'express';
import {
  getAiSettingsHandler,
  updateAiSettingsHandler,
} from './ai-settings.controller';
import * as aiSettingsService from './ai-settings.service';

jest.mock('./ai-settings.service', () => ({
  getAiSettingsPublic: jest.fn(),
  updateAiSettings: jest.fn(),
}));

const mockedService = aiSettingsService as jest.Mocked<typeof aiSettingsService>;

function buildRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function buildNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

const publicSettings = {
  id: 's-1',
  enabled: true,
  base_url: 'https://api.openai.com',
  has_api_key: true,
  model: 'gpt-4o',
  max_tokens: 500,
  temperature: 0.7,
  system_prompt_override: null,
  cache_ttl_seconds: 3600,
  updated_by: 'u-1',
  updated_at: '2026-01-02T00:00:00Z',
};

describe('ai-settings controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAiSettingsHandler', () => {
    it('returns public AI settings on success', async () => {
      mockedService.getAiSettingsPublic.mockResolvedValueOnce(publicSettings);

      const req = {} as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getAiSettingsHandler(req, res, next);

      expect(mockedService.getAiSettingsPublic).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: publicSettings,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      const error = new Error('service failed');
      mockedService.getAiSettingsPublic.mockRejectedValueOnce(error);

      const req = {} as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getAiSettingsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('updateAiSettingsHandler', () => {
    it('updates AI settings and returns the result', async () => {
      mockedService.updateAiSettings.mockResolvedValueOnce(publicSettings);

      const req = {
        body: {
          enabled: false,
          base_url: 'http://localhost:11434',
          api_key: 'new-key',
          model: 'llama3',
          max_tokens: 100,
          temperature: 0.5,
          system_prompt_override: 'override',
          cache_ttl_seconds: 60,
        },
        user: { id: 'u-2' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await updateAiSettingsHandler(req, res, next);

      expect(mockedService.updateAiSettings).toHaveBeenCalledWith(
        {
          enabled: false,
          base_url: 'http://localhost:11434',
          api_key: 'new-key',
          model: 'llama3',
          max_tokens: 100,
          temperature: 0.5,
          system_prompt_override: 'override',
          cache_ttl_seconds: 60,
        },
        'u-2',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: publicSettings,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns a validation error for an invalid payload', async () => {
      const req = {
        body: {
          base_url: 'not-a-url',
          max_tokens: 1000,
          temperature: 5,
          cache_ttl_seconds: 10,
        },
        user: { id: 'u-1' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await updateAiSettingsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = (next as jest.Mock).mock.calls[0][0] as Error;
      expect(err.message).toContain('base_url');
      expect(err.message).toContain('max_tokens');
      expect(err.message).toContain('temperature');
      expect(err.message).toContain('cache_ttl_seconds');
    });

    it('forwards service errors to next', async () => {
      const error = new Error('update failed');
      mockedService.updateAiSettings.mockRejectedValueOnce(error);

      const req = {
        body: { model: 'gpt-4o' },
        user: { id: 'u-1' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await updateAiSettingsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
