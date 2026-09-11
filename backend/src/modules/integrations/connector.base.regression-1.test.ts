import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { loggedFetch } = jest.requireActual('./connector.base.ts') as typeof import('./connector.base');

describe('loggedFetch provider error details', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns the provider message without returning the full error body', async () => {
    const responseBody = JSON.stringify({
      error: {
        message: 'Invalid OAuth access token',
        fbtrace_id: 'trace-that-must-not-be-exposed',
      },
    });
    const text = jest.fn(async (): Promise<string> => responseBody);
    const response = {
      ok: false,
      status: 401,
      text,
    } as unknown as Response;
    const mockFetch = jest.fn(async () => response);
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await loggedFetch(
      'https://graph.facebook.com/v25.0/messages',
      { method: 'POST', body: '{"redacted":true}' },
      { channel: 'whatsapp' },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: 'Invalid OAuth access token',
    });
    if (!result.ok) expect(result.error).not.toContain('trace-that-must-not-be-exposed');
  });
});
