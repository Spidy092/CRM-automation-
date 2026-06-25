import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * Initialize Sentry error tracking.
 *
 * Must be called very early in the application lifecycle (before Express
 * middleware setup) so Sentry can patch global error handlers.
 *
 * Reads `SENTRY_DSN` from environment. When not set, Sentry is silently
 * disabled — no change in behaviour for local development.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info('SENTRY_DSN not set — Sentry error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Capture <10% of traces in dev, configurable via env
    enabled: process.env.NODE_ENV !== 'test',
  });

  logger.info('Sentry initialized', {
    environment: process.env.NODE_ENV ?? 'development',
  });
}

export { Sentry };
