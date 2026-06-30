import {
  isOpenWACredentials,
  openWACredentialsSchema,
  openWANumberConfigSchema,
  antiBanConfigSchema,
  openWASendRequestSchema,
  openWASendResponseSchema,
  openWAHealthResponseSchema,
} from './openwa.types';

describe('openWANumberConfigSchema', () => {
  const valid = {
    number: '+1234567890',
    dailyCount: 10,
    hourlyCount: 2,
    lastSentAt: new Date().toISOString(),
    warmupSent: 3,
    cooldownUntil: null,
  };

  it('accepts a valid number config', () => {
    expect(openWANumberConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null timestamps', () => {
    expect(
      openWANumberConfigSchema.safeParse({ ...valid, lastSentAt: null }).success,
    ).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(
      openWANumberConfigSchema.safeParse({ ...valid, dailyCount: -1 }).success,
    ).toBe(false);
  });

  it('rejects invalid iso timestamps', () => {
    expect(
      openWANumberConfigSchema.safeParse({ ...valid, lastSentAt: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('antiBanConfigSchema', () => {
  const valid = {
    rateLimitPerHour: 20,
    rateLimitPerDay: 100,
    jitterMinMs: 1000,
    jitterMaxMs: 5000,
    warmupMax: 10,
    cooldownMinutes: 60,
    enabled: true,
  };

  it('accepts a valid anti-ban config', () => {
    expect(antiBanConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects zero rate limits', () => {
    expect(
      antiBanConfigSchema.safeParse({ ...valid, rateLimitPerHour: 0 }).success,
    ).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(antiBanConfigSchema.safeParse({ enabled: true }).success).toBe(false);
  });
});

describe('openWACredentialsSchema', () => {
  const valid = {
    baseUrl: 'http://localhost:8080',
    apiKey: 'secret',
    sessionId: 'session-1',
    numbers: ['+1234567890'],
  };

  it('accepts valid credentials without antiBan', () => {
    expect(openWACredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts valid credentials with antiBan', () => {
    expect(
      openWACredentialsSchema.safeParse({
        ...valid,
        antiBan: {
          rateLimitPerHour: 20,
          rateLimitPerDay: 100,
          jitterMinMs: 1000,
          jitterMaxMs: 5000,
          warmupMax: 10,
          cooldownMinutes: 60,
          enabled: true,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid baseUrl', () => {
    expect(
      openWACredentialsSchema.safeParse({ ...valid, baseUrl: 'not-a-url' }).success,
    ).toBe(false);
  });

  it('accepts an empty numbers array per the declared shape', () => {
    expect(
      openWACredentialsSchema.safeParse({ ...valid, numbers: [] }).success,
    ).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(openWACredentialsSchema.safeParse({ apiKey: 'secret' }).success).toBe(false);
  });
});

describe('isOpenWACredentials', () => {
  it('returns true for valid credentials', () => {
    expect(
      isOpenWACredentials({
        baseUrl: 'http://localhost:8080',
        apiKey: 'secret',
        sessionId: 'session-1',
        numbers: ['+1234567890'],
      }),
    ).toBe(true);
  });

  it('returns false for invalid credentials', () => {
    expect(isOpenWACredentials({ baseUrl: 'http://localhost:8080' })).toBe(false);
    expect(isOpenWACredentials(null)).toBe(false);
    expect(isOpenWACredentials('credentials')).toBe(false);
  });
});

describe('openWASendRequestSchema', () => {
  it('accepts a valid send request', () => {
    expect(
      openWASendRequestSchema.safeParse({ chatId: '123@c.us', text: 'Hello' }).success,
    ).toBe(true);
  });

  it('rejects empty chatId or text', () => {
    expect(openWASendRequestSchema.safeParse({ chatId: '', text: 'Hello' }).success).toBe(
      false,
    );
    expect(openWASendRequestSchema.safeParse({ chatId: '123@c.us', text: '' }).success).toBe(
      false,
    );
  });
});

describe('openWASendResponseSchema', () => {
  it('accepts a valid send response', () => {
    expect(
      openWASendResponseSchema.safeParse({ messageId: 'msg-1', timestamp: Date.now() }).success,
    ).toBe(true);
  });

  it('rejects non-integer timestamp', () => {
    expect(
      openWASendResponseSchema.safeParse({ messageId: 'msg-1', timestamp: 1.5 }).success,
    ).toBe(false);
  });
});

describe('openWAHealthResponseSchema', () => {
  it('accepts a valid health response', () => {
    expect(openWAHealthResponseSchema.safeParse({ status: 'OK' }).success).toBe(true);
  });

  it('accepts a health response with optional fields', () => {
    expect(
      openWAHealthResponseSchema.safeParse({ status: 'OK', session: 's1', error: 'none' }).success,
    ).toBe(true);
  });

  it('rejects empty status', () => {
    expect(openWAHealthResponseSchema.safeParse({ status: '' }).success).toBe(false);
  });
});
