import Redis from 'ioredis';
import { AntiBanConfig, OpenWACredentials, OpenWANumberConfig } from './openwa.types';

const DEFAULT_CONFIG: Required<AntiBanConfig> = {
  rateLimitPerHour: 20,
  rateLimitPerDay: 100,
  jitterMinMs: 1000,
  jitterMaxMs: 5000,
  warmupMax: 10,
  cooldownMinutes: 60,
  enabled: true,
};

const DEFAULT_NUMBER_STATE: OpenWANumberConfig = {
  number: '',
  dailyCount: 0,
  hourlyCount: 0,
  lastSentAt: null,
  warmupSent: 0,
  cooldownUntil: null,
};

/**
 * Build a complete anti-ban config from partial input, applying safe defaults.
 *
 * @param input - Partial anti-ban configuration overrides.
 * @returns A fully populated AntiBanConfig.
 */
export function buildAntiBanConfig(input?: Partial<AntiBanConfig>): AntiBanConfig {
  const config: AntiBanConfig = {
    rateLimitPerHour: input?.rateLimitPerHour ?? DEFAULT_CONFIG.rateLimitPerHour,
    rateLimitPerDay: input?.rateLimitPerDay ?? DEFAULT_CONFIG.rateLimitPerDay,
    jitterMinMs: input?.jitterMinMs ?? DEFAULT_CONFIG.jitterMinMs,
    jitterMaxMs: input?.jitterMaxMs ?? DEFAULT_CONFIG.jitterMaxMs,
    warmupMax: input?.warmupMax ?? DEFAULT_CONFIG.warmupMax,
    cooldownMinutes: input?.cooldownMinutes ?? DEFAULT_CONFIG.cooldownMinutes,
    enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
  };

  if (config.jitterMinMs > config.jitterMaxMs) {
    config.jitterMaxMs = config.jitterMinMs;
  }

  return config;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Wait for a random duration between minMs and maxMs (inclusive).
 *
 * @param minMs - Minimum delay in milliseconds.
 * @param maxMs - Maximum delay in milliseconds.
 * @returns A promise that resolves after the random delay.
 */
export async function jitter(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs >= maxMs ? minMs : randomInt(minMs, maxMs);
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/**
 * Check whether the given number is allowed to send a message under rate limits
 * and active cooldown. If allowed, the caller must invoke the increment callback.
 *
 * @param args - Rate limit check arguments.
 * @returns Whether the send is allowed and the reason if blocked.
 */
export async function rateLimit(args: {
  number: string;
  credentials: OpenWACredentials;
  getState: () => Promise<OpenWANumberConfig>;
  increment: () => Promise<void>;
  now?: Date;
}): Promise<{ allowed: boolean; reason?: string }> {
  const { credentials, getState, increment, now = new Date() } = args;
  const config = buildAntiBanConfig(credentials.antiBan);
  const state = await getState();

  if (state.cooldownUntil && new Date(state.cooldownUntil) > now) {
    return { allowed: false, reason: 'cooldown' };
  }

  if (state.hourlyCount >= config.rateLimitPerHour) {
    return { allowed: false, reason: 'rate_limit' };
  }

  if (state.dailyCount >= config.rateLimitPerDay) {
    return { allowed: false, reason: 'rate_limit' };
  }

  await increment();
  return { allowed: true };
}

function warmupDelay(sent: number): number {
  return Math.min(300_000, (sent + 1) * 30_000);
}

/**
 * Determine whether a number has completed its warm-up phase and suggest a
 * progressive delay between warm-up messages.
 *
 * @param args - Warm-up check arguments.
 * @returns Whether the send is allowed and an optional advisory delay.
 */
export async function warmup(args: {
  number: string;
  credentials: OpenWACredentials;
  getState: () => Promise<OpenWANumberConfig>;
  now?: Date;
}): Promise<{ allowed: boolean; reason?: string; delayMs?: number }> {
  const { credentials, getState } = args;
  const config = buildAntiBanConfig(credentials.antiBan);
  const state = await getState();

  if (state.warmupSent >= config.warmupMax) {
    return { allowed: true };
  }

  return { allowed: true, delayMs: warmupDelay(state.warmupSent) };
}

/**
 * Place the number into cooldown until the configured number of minutes from now.
 *
 * @param args - Cooldown arguments.
 * @returns A promise that resolves once cooldownUntil is persisted.
 */
export async function cooldown(args: {
  number: string;
  credentials: OpenWACredentials;
  persist: (state: Partial<OpenWANumberConfig>) => Promise<void>;
  minutes?: number;
  now?: Date;
}): Promise<void> {
  const { credentials, persist, minutes, now = new Date() } = args;
  const config = buildAntiBanConfig(credentials.antiBan);
  const cooldownMinutes = minutes ?? config.cooldownMinutes;
  const cooldownUntil = new Date(now.getTime() + cooldownMinutes * 60_000).toISOString();

  await persist({ cooldownUntil });
}

/**
 * Rotate sender numbers using least-recently-used selection.
 *
 * @param args - Rotation arguments.
 * @returns The selected number, or null when all numbers are excluded.
 */
export function rotateNumber(args: {
  numbers: string[];
  lastUsedAt: Map<string, Date>;
  excludeCooldown?: Set<string>;
  now?: Date;
}): { number: string | null } {
  const { numbers, lastUsedAt, excludeCooldown = new Set() } = args;

  const candidates = numbers.filter((n) => !excludeCooldown.has(n));
  if (candidates.length === 0) {
    return { number: null };
  }

  candidates.sort((a, b) => {
    const timeA = lastUsedAt.get(a)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const timeB = lastUsedAt.get(b)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return timeA - timeB;
  });

  return { number: candidates[0] ?? null };
}

/**
 * Per-number state repository used for tests and production persistence.
 */
export interface NumberStateRepository {
  get(integrationId: string, number: string): Promise<OpenWANumberConfig>;
  set(integrationId: string, number: string, state: Partial<OpenWANumberConfig>): Promise<void>;
}

function buildMemoryKey(integrationId: string, number: string): string {
  return `${integrationId}:${number}`;
}

/**
 * Create an in-memory state repository for testing or fallback usage.
 *
 * @returns A NumberStateRepository backed by an in-memory Map.
 */
export function createMemoryStateRepository(): NumberStateRepository {
  const store = new Map<string, OpenWANumberConfig>();

  return {
    get(integrationId: string, number: string): Promise<OpenWANumberConfig> {
      const key = buildMemoryKey(integrationId, number);
      const existing = store.get(key);
      if (existing) {
        return Promise.resolve(existing);
      }
      const fresh: OpenWANumberConfig = { ...DEFAULT_NUMBER_STATE, number };
      store.set(key, fresh);
      return Promise.resolve(fresh);
    },

    set(integrationId: string, number: string, state: Partial<OpenWANumberConfig>): Promise<void> {
      const key = buildMemoryKey(integrationId, number);
      const existing = store.get(key) ?? { ...DEFAULT_NUMBER_STATE, number };
      store.set(key, { ...existing, ...state });
      return Promise.resolve();
    },
  };
}

function buildRedisKey(integrationId: string, number: string): string {
  return `openwa:${integrationId}:${number}`;
}

function createRedisStateRepository(client: Redis): NumberStateRepository {
  return {
    async get(integrationId: string, number: string): Promise<OpenWANumberConfig> {
      const key = buildRedisKey(integrationId, number);
      const raw = await client.get(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OpenWANumberConfig>;
        return { ...DEFAULT_NUMBER_STATE, ...parsed, number };
      }
      return { ...DEFAULT_NUMBER_STATE, number };
    },

    async set(
      integrationId: string,
      number: string,
      state: Partial<OpenWANumberConfig>,
    ): Promise<void> {
      const key = buildRedisKey(integrationId, number);
      const existing = await this.get(integrationId, number);
      const merged: OpenWANumberConfig = { ...existing, ...state };
      await client.set(key, JSON.stringify(merged));
    },
  };
}

/**
 * Create a state repository. Uses Redis when REDIS_URL is configured; otherwise
 * falls back to an in-memory Map so tests can run without Redis.
 *
 * @returns A NumberStateRepository.
 */
export function createStateRepository(): NumberStateRepository {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const client = new Redis(redisUrl);
    return createRedisStateRepository(client);
  }
  return createMemoryStateRepository();
}
