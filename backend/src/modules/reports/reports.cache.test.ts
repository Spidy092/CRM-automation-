import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import {
  DEFAULT_ANALYTICS_TTL_SECONDS,
  getOrComputeReport,
  invalidateReportCache,
} from './reports.cache';
import { AnalyticsCacheKey } from './reports.types';

jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('reports.cache', () => {
  const key: AnalyticsCacheKey = 'campaigns:tenant-1:2024-01-01:2024-01-31';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes, stores with SETEX, and returns cached metadata on cache miss', async () => {
    const data = [{ leads: 1 }];
    const compute = jest.fn().mockResolvedValue(data);

    (redis.get as jest.Mock).mockResolvedValue(null);
    (redis.setex as jest.Mock).mockResolvedValue('OK');

    const result = await getOrComputeReport(key, compute);

    expect(redis.get).toHaveBeenCalledWith(key);
    expect(compute).toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      key,
      DEFAULT_ANALYTICS_TTL_SECONDS,
      expect.any(String),
    );
    expect(result.key).toBe(key);
    expect(result.data).toEqual(data);
    expect(result.ttlSeconds).toBe(DEFAULT_ANALYTICS_TTL_SECONDS);
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    expect(logger.info).toHaveBeenCalledWith('Analytics cache miss', { key });
  });

  it('returns parsed data without calling compute on cache hit', async () => {
    const cachedReport = {
      key,
      generatedAt: '2024-01-15T00:00:00.000Z',
      ttlSeconds: DEFAULT_ANALYTICS_TTL_SECONDS,
      data: [{ leads: 2 }],
    };

    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(cachedReport));

    const compute = jest.fn();
    const result = await getOrComputeReport(key, compute);

    expect(redis.get).toHaveBeenCalledWith(key);
    expect(compute).not.toHaveBeenCalled();
    expect(result).toEqual(cachedReport);
    expect(redis.setex).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Analytics cache hit', { key });
  });

  it('falls back to compute and does not throw on Redis read error', async () => {
    const data = [{ leads: 3 }];
    const compute = jest.fn().mockResolvedValue(data);

    (redis.get as jest.Mock).mockRejectedValue(new Error('Redis unavailable'));

    const result = await getOrComputeReport(key, compute);

    expect(result.data).toEqual(data);
    expect(compute).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Analytics cache read error, falling back to compute',
      expect.any(Object),
    );
  });

  it('uses a custom TTL when provided', async () => {
    const data = [{ leads: 4 }];
    const compute = jest.fn().mockResolvedValue(data);
    const customTtl = 120;

    (redis.get as jest.Mock).mockResolvedValue(null);

    const result = await getOrComputeReport(key, compute, customTtl);

    expect(redis.setex).toHaveBeenCalledWith(key, customTtl, expect.any(String));
    expect(result.ttlSeconds).toBe(customTtl);
  });

  it('deletes the key on invalidate', async () => {
    (redis.del as jest.Mock).mockResolvedValue(1);

    await invalidateReportCache(key);

    expect(redis.del).toHaveBeenCalledWith(key);
    expect(logger.info).toHaveBeenCalledWith('Analytics cache invalidated', { key });
  });

  it('logs but does not throw on invalidate Redis error', async () => {
    (redis.del as jest.Mock).mockRejectedValue(new Error('Redis unavailable'));

    await expect(invalidateReportCache(key)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'Analytics cache invalidation error',
      expect.any(Object),
    );
  });

  it('logs but does not throw on cache write error', async () => {
    const data = [{ leads: 5 }];
    const compute = jest.fn().mockResolvedValue(data);

    (redis.get as jest.Mock).mockResolvedValue(null);
    (redis.setex as jest.Mock).mockRejectedValue(new Error('Redis unavailable'));

    const result = await getOrComputeReport(key, compute);

    expect(result.data).toEqual(data);
    expect(logger.error).toHaveBeenCalledWith('Analytics cache write error', expect.any(Object));
  });
});
