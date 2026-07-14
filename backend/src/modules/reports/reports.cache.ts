import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { AnalyticsCacheKey, CachedReport } from './reports.types';

export const DEFAULT_ANALYTICS_TTL_SECONDS = Number(process.env.ANALYTICS_CACHE_TTL_SECONDS ?? 300);

export async function getOrComputeReport<T>(
  key: AnalyticsCacheKey,
  compute: () => Promise<T>,
  ttlSeconds: number = DEFAULT_ANALYTICS_TTL_SECONDS,
): Promise<CachedReport<T>> {
  try {
    const cached = await redis.get(key);

    if (cached) {
      logger.info('Analytics cache hit', { key });
      return JSON.parse(cached) as CachedReport<T>;
    }
  } catch (error) {
    logger.error('Analytics cache read error, falling back to compute', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Analytics cache miss', { key });

  const data = await compute();
  const report: CachedReport<T> = {
    key,
    generatedAt: new Date().toISOString(),
    ttlSeconds,
    data,
  };

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(report));
  } catch (error) {
    logger.error('Analytics cache write error', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return report;
}

export async function invalidateReportCache(key: AnalyticsCacheKey): Promise<void> {
  try {
    await redis.del(key);
    logger.info('Analytics cache invalidated', { key });
  } catch (error) {
    logger.error('Analytics cache invalidation error', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
