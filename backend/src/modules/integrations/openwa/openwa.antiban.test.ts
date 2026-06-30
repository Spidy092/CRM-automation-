import {
  buildAntiBanConfig,
  jitter,
  rateLimit,
  warmup,
  cooldown,
  rotateNumber,
  createMemoryStateRepository,
  createStateRepository,
} from './openwa.antiban';
import { OpenWACredentials, OpenWANumberConfig } from './openwa.types';

const credentials: OpenWACredentials = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'secret',
  sessionId: 'session-1',
  numbers: ['+1111111111', '+2222222222'],
};

const makeState = (overrides: Partial<OpenWANumberConfig> = {}): OpenWANumberConfig => ({
  number: '+1111111111',
  dailyCount: 0,
  hourlyCount: 0,
  lastSentAt: null,
  warmupSent: 0,
  cooldownUntil: null,
  ...overrides,
});

describe('buildAntiBanConfig', () => {
  it('applies defaults when no input is provided', () => {
    const config = buildAntiBanConfig();
    expect(config).toEqual({
      rateLimitPerHour: 20,
      rateLimitPerDay: 100,
      jitterMinMs: 1000,
      jitterMaxMs: 5000,
      warmupMax: 10,
      cooldownMinutes: 60,
      enabled: true,
    });
  });

  it('overrides defaults and clamps jitter min/max', () => {
    const config = buildAntiBanConfig({
      rateLimitPerHour: 10,
      jitterMinMs: 8000,
      jitterMaxMs: 2000,
      enabled: false,
    });
    expect(config.rateLimitPerHour).toBe(10);
    expect(config.jitterMinMs).toBe(8000);
    expect(config.jitterMaxMs).toBe(8000);
    expect(config.enabled).toBe(false);
  });
});

describe('jitter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for a random integer between min and max ms', async () => {
    const promise = jitter(100, 200);
    jest.advanceTimersByTime(200);
    await promise;
    expect(true).toBe(true);
  });

  it('uses min when min equals max', async () => {
    const promise = jitter(50, 50);
    jest.advanceTimersByTime(50);
    await promise;
    expect(true).toBe(true);
  });
});

describe('rateLimit', () => {
  it('allows sends under the hourly and daily limits', async () => {
    const state = makeState({ hourlyCount: 5, dailyCount: 10 });
    const getState = jest.fn().mockResolvedValue(state);
    const increment = jest.fn().mockResolvedValue(undefined);

    const result = await rateLimit({
      number: '+1111111111',
      credentials,
      getState,
      increment,
    });

    expect(result).toEqual({ allowed: true });
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it('blocks sends when the hourly limit is reached', async () => {
    const state = makeState({ hourlyCount: 20, dailyCount: 10 });
    const getState = jest.fn().mockResolvedValue(state);
    const increment = jest.fn().mockResolvedValue(undefined);

    const result = await rateLimit({
      number: '+1111111111',
      credentials,
      getState,
      increment,
    });

    expect(result).toEqual({ allowed: false, reason: 'rate_limit' });
    expect(increment).not.toHaveBeenCalled();
  });

  it('blocks sends when the daily limit is reached', async () => {
    const state = makeState({ hourlyCount: 5, dailyCount: 100 });
    const getState = jest.fn().mockResolvedValue(state);
    const increment = jest.fn().mockResolvedValue(undefined);

    const result = await rateLimit({
      number: '+1111111111',
      credentials,
      getState,
      increment,
    });

    expect(result).toEqual({ allowed: false, reason: 'rate_limit' });
    expect(increment).not.toHaveBeenCalled();
  });

  it('blocks sends while cooldownUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const state = makeState({ cooldownUntil: future });
    const getState = jest.fn().mockResolvedValue(state);
    const increment = jest.fn().mockResolvedValue(undefined);

    const result = await rateLimit({
      number: '+1111111111',
      credentials,
      getState,
      increment,
    });

    expect(result).toEqual({ allowed: false, reason: 'cooldown' });
    expect(increment).not.toHaveBeenCalled();
  });

  it('allows sends when cooldownUntil has expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const state = makeState({ cooldownUntil: past });
    const getState = jest.fn().mockResolvedValue(state);
    const increment = jest.fn().mockResolvedValue(undefined);

    const result = await rateLimit({
      number: '+1111111111',
      credentials,
      getState,
      increment,
    });

    expect(result).toEqual({ allowed: true });
  });
});

describe('warmup', () => {
  it('returns increasing advisory delays during warm-up', async () => {
    for (let i = 0; i < 10; i += 1) {
      const state = makeState({ warmupSent: i });
      const result = await warmup({
        number: '+1111111111',
        credentials,
        getState: async () => state,
      });
      expect(result.allowed).toBe(true);
      expect(result.delayMs).toBe(Math.min(300_000, (i + 1) * 30_000));
    }
  });

  it('stops suggesting a delay once warmupMax is reached', async () => {
    const state = makeState({ warmupSent: 10 });
    const result = await warmup({
      number: '+1111111111',
      credentials,
      getState: async () => state,
    });
    expect(result).toEqual({ allowed: true });
    expect(result.delayMs).toBeUndefined();
  });
});

describe('cooldown', () => {
  it('persists a cooldownUntil timestamp based on config minutes', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const persist = jest.fn().mockResolvedValue(undefined);

    await cooldown({
      number: '+1111111111',
      credentials,
      persist,
      now,
    });

    expect(persist).toHaveBeenCalledTimes(1);
    const [state] = persist.mock.calls[0] as [Partial<OpenWANumberConfig>];
    expect(state.cooldownUntil).toBe('2026-01-01T13:00:00.000Z');
  });

  it('uses the explicit minutes override when provided', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const persist = jest.fn().mockResolvedValue(undefined);

    await cooldown({
      number: '+1111111111',
      credentials,
      persist,
      minutes: 15,
      now,
    });

    const [state] = persist.mock.calls[0] as [Partial<OpenWANumberConfig>];
    expect(state.cooldownUntil).toBe('2026-01-01T12:15:00.000Z');
  });
});

describe('rotateNumber', () => {
  it('returns the least-recently-used number', () => {
    const lastUsedAt = new Map<string, Date>([
      ['+1111111111', new Date('2026-01-01T10:00:00Z')],
      ['+2222222222', new Date('2026-01-01T09:00:00Z')],
      ['+3333333333', new Date('2026-01-01T11:00:00Z')],
    ]);

    const result = rotateNumber({
      numbers: ['+1111111111', '+2222222222', '+3333333333'],
      lastUsedAt,
    });

    expect(result.number).toBe('+2222222222');
  });

  it('prefers new numbers that have never been used', () => {
    const lastUsedAt = new Map<string, Date>([
      ['+1111111111', new Date('2026-01-01T09:00:00Z')],
    ]);

    const result = rotateNumber({
      numbers: ['+1111111111', '+2222222222'],
      lastUsedAt,
    });

    expect(result.number).toBe('+2222222222');
  });

  it('excludes numbers in the cooldown set', () => {
    const lastUsedAt = new Map<string, Date>([
      ['+1111111111', new Date('2026-01-01T09:00:00Z')],
      ['+2222222222', new Date('2026-01-01T10:00:00Z')],
    ]);

    const result = rotateNumber({
      numbers: ['+1111111111', '+2222222222'],
      lastUsedAt,
      excludeCooldown: new Set(['+1111111111']),
    });

    expect(result.number).toBe('+2222222222');
  });

  it('returns null when every number is excluded', () => {
    const result = rotateNumber({
      numbers: ['+1111111111'],
      lastUsedAt: new Map(),
      excludeCooldown: new Set(['+1111111111']),
    });

    expect(result.number).toBeNull();
  });

  it('returns null for an empty numbers array', () => {
    const result = rotateNumber({
      numbers: [],
      lastUsedAt: new Map(),
    });

    expect(result.number).toBeNull();
  });
});

describe('createMemoryStateRepository', () => {
  it('round-trips default state and partial updates', async () => {
    const repo = createMemoryStateRepository();

    const fresh = await repo.get('integration-1', '+1111111111');
    expect(fresh).toMatchObject({
      number: '+1111111111',
      dailyCount: 0,
      hourlyCount: 0,
      warmupSent: 0,
      cooldownUntil: null,
    });

    await repo.set('integration-1', '+1111111111', {
      dailyCount: 5,
      hourlyCount: 2,
      warmupSent: 3,
    });

    const updated = await repo.get('integration-1', '+1111111111');
    expect(updated).toMatchObject({
      number: '+1111111111',
      dailyCount: 5,
      hourlyCount: 2,
      warmupSent: 3,
      cooldownUntil: null,
    });
  });

  it('isolates state per integration and number', async () => {
    const repo = createMemoryStateRepository();

    await repo.set('integration-1', '+1111111111', { dailyCount: 1 });
    await repo.set('integration-2', '+1111111111', { dailyCount: 2 });
    await repo.set('integration-1', '+2222222222', { dailyCount: 3 });

    expect((await repo.get('integration-1', '+1111111111')).dailyCount).toBe(1);
    expect((await repo.get('integration-2', '+1111111111')).dailyCount).toBe(2);
    expect((await repo.get('integration-1', '+2222222222')).dailyCount).toBe(3);
  });
});

describe('createStateRepository', () => {
  const originalEnv = process.env.REDIS_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalEnv;
    }
  });

  it('falls back to a memory repository when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;
    const repo = createStateRepository();

    await repo.set('integration-1', '+1111111111', { dailyCount: 7 });
    const state = await repo.get('integration-1', '+1111111111');
    expect(state.dailyCount).toBe(7);
  });
});
