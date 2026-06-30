import {
  loadCredentials,
  sendMessage,
  healthCheck,
  verifyWebhook,
} from './openwa.connector';
import { createMemoryStateRepository } from './openwa.antiban';

const validCredentials = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'secret-key',
  sessionId: 'session-1',
  numbers: ['+1111111111', '+2222222222'],
};

let sharedRepo = createMemoryStateRepository();

jest.mock('./openwa.antiban', () => {
  const actual = jest.requireActual('./openwa.antiban');
  return {
    ...actual,
    jitter: jest.fn().mockResolvedValue(undefined),
    createStateRepository: jest.fn().mockImplementation(() => sharedRepo),
  };
});

function mockFetchResponse(status: number, body: unknown): void {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response);
}

describe('loadCredentials', () => {
  it('validates and returns credentials with anti-ban defaults', async () => {
    const result = await loadCredentials(validCredentials);
    expect(result.baseUrl).toBe('http://localhost:8080');
    expect(result.numbers).toEqual(['+1111111111', '+2222222222']);
    expect(result.antiBan).toEqual({
      rateLimitPerHour: 20,
      rateLimitPerDay: 100,
      jitterMinMs: 1000,
      jitterMaxMs: 5000,
      warmupMax: 10,
      cooldownMinutes: 60,
      enabled: true,
    });
  });

  it('throws AppError(422) for invalid shape', async () => {
    await expect(loadCredentials({ baseUrl: 'not-a-url' })).rejects.toThrow(
      'OpenWA credentials invalid',
    );
  });

  it('throws AppError(422) when numbers is empty', async () => {
    await expect(
      loadCredentials({ ...validCredentials, numbers: [] }),
    ).rejects.toThrow('at least one sender number');
  });

  it('throws AppError(422) when baseUrl is not http/https', async () => {
    await expect(
      loadCredentials({ ...validCredentials, baseUrl: 'ftp://localhost' }),
    ).rejects.toThrow('baseUrl must start with');
  });
});

describe('sendMessage', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    sharedRepo = createMemoryStateRepository();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ messageId: 'msg-123' })),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('succeeds and returns messageId + numberUsed', async () => {
    const result = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-1',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.messageId).toBe('msg-123');
    expect(result.data.numberUsed).toBe('+1111111111');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'http://localhost:8080/api/sessions/session-1/messages/send-text',
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'x-api-key': 'secret-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ chatId: '1234567890@c.us', text: 'Hello' }),
    });
  });

  it('wraps chatId when it already ends with @c.us', async () => {
    await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-1',
      campaignId: 'camp-1',
      to: '1234567890@c.us',
      body: 'Hello',
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ chatId: '1234567890@c.us', text: 'Hello' }),
    );
  });

  it('uses LRU number rotation', async () => {
    const first = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-1',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
      integrationId: 'int-lru',
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.numberUsed).toBe('+1111111111');

    const second = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-2',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
      integrationId: 'int-lru',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.numberUsed).toBe('+2222222222');

    const third = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-3',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
      integrationId: 'int-lru',
    });

    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.data.numberUsed).toBe('+1111111111');
  });

  it('applies cooldown on 403 block', async () => {
    fetchSpy.mockRestore();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: 'blocked' })),
    } as unknown as Response);

    const result = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-1',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
      integrationId: 'int-cooldown',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.retryable).toBe(false);

    const state = await sharedRepo.get('int-cooldown', '+1111111111');
    expect(state.cooldownUntil).not.toBeNull();
    expect(new Date(state.cooldownUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it('fails with non-retryable on 400 invalid chatId', async () => {
    fetchSpy.mockRestore();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: 'invalid chat id' })),
    } as unknown as Response);

    const result = await sendMessage({
      credentials: validCredentials,
      leadId: 'lead-1',
      campaignId: 'camp-1',
      to: '+1234567890',
      body: 'Hello',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.retryable).toBe(false);
  });
});

describe('healthCheck', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ status: 'OK' })),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns ok on 200', async () => {
    const result = await healthCheck({ credentials: validCredentials });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('OK');
  });

  it('fails on 5xx', async () => {
    fetchSpy.mockRestore();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response);

    const result = await healthCheck({ credentials: validCredentials });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(result.retryable).toBe(true);
  });
});

describe('verifyWebhook', () => {
  it('returns the not_implemented placeholder', () => {
    expect(verifyWebhook({ foo: 'bar' }, 'sig')).toEqual({
      ok: false,
      reason: 'not_implemented',
    });
  });
});
