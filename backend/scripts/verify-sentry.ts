/**
 * Sentry End-to-End Verification Script
 *
 * Triggers a test exception through the configured Sentry SDK and waits for
 * the event to be flushed to Sentry's ingest endpoint. Confirms that:
 *  1. Sentry initialized correctly with the provided DSN
 *  2. captureException() returns a generated eventId
 *  3. The event is flushed to Sentry within the timeout window
 *
 * Usage:
 *   SENTRY_DSN=https://xxx@sentry.io/yyy npx ts-node scripts/verify-sentry.ts
 *
 * Optional environment:
 *   SENTRY_ENVIRONMENT=production     (default: development)
 *   SENTRY_VERIFY_TIMEOUT_MS=10000    (default: 10000)
 *   SENTRY_VERIFY_TAG=crm-smoke-test  (default: crm-smoke-test)
 *
 * Exit codes:
 *   0 — event was captured and flushed successfully
 *   1 — SENTRY_DSN not set
 *   2 — Sentry init failed
 *   3 — captureException returned no eventId
 *   4 — flush() timed out
 */
import { initSentry, Sentry } from '../src/shared/utils/sentry';
import { logger } from '../src/shared/utils/logger';

const TIMEOUT_MS = parseInt(process.env.SENTRY_VERIFY_TIMEOUT_MS ?? '10000', 10);
const TAG = process.env.SENTRY_VERIFY_TAG ?? 'crm-smoke-test';

function fail(code: number, message: string): never {
  logger.error(`[sentry-verify] ${message}`);
  process.exit(code);
}

async function main(): Promise<void> {
  if (!process.env.SENTRY_DSN) {
    fail(1, 'SENTRY_DSN is not set. Aborting.');
  }

  logger.info('[sentry-verify] Initializing Sentry…', {
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    dsnPrefix: process.env.SENTRY_DSN?.slice(0, 12),
  });

  try {
    initSentry();
  } catch (err) {
    fail(2, `initSentry() threw: ${(err as Error).message}`);
  }

  const testError = new Error(
    `[sentry-verify] smoke test event — ${new Date().toISOString()}`,
  );
  testError.name = 'SentrySmokeTestError';

  Sentry.withScope((scope) => {
    scope.setTag('verify_run', TAG);
    scope.setLevel('info');
    scope.setExtra('triggered_by', 'scripts/verify-sentry.ts');
    scope.setExtra('node_version', process.version);
    const eventId = Sentry.captureException(testError);
    if (!eventId) {
      fail(3, 'captureException() did not return an eventId.');
    }
    logger.info('[sentry-verify] captureException returned eventId', { eventId });
  });

  logger.info(`[sentry-verify] Flushing events (timeout=${TIMEOUT_MS}ms)…`);

  try {
    const flushed = await Sentry.flush(TIMEOUT_MS);
    if (!flushed) {
      fail(4, `Sentry.flush() returned false — events may not have been sent.`);
    }
  } catch (err) {
    fail(4, `Sentry.flush() threw: ${(err as Error).message}`);
  }

  logger.info('[sentry-verify] ✅ Event successfully captured and flushed to Sentry.');
  logger.info('[sentry-verify] Confirm in Sentry dashboard: tag "verify_run" = ' + TAG);
  await Sentry.close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('[sentry-verify] Unexpected error', { error: (err as Error).message });
  process.exit(1);
});
