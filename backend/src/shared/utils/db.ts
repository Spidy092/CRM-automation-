import { Pool, PoolClient } from 'pg';
import { logger } from './logger';
import { registerTestCleanup } from './testResources';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN ?? '2', 10),
  max: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

registerTestCleanup(async () => {
  await pool.end();
});

export { pool };

export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Stable advisory-lock namespace for a domain key (hashed to a bigint by Postgres). */
export function advisoryLockKey(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}

/**
 * Run `fn` while holding a Postgres transaction-scoped advisory lock.
 *
 * This serializes critical sections across every app instance sharing the
 * database (API, workers, PM2 replicas) — an in-process mutex cannot do that.
 * The lock is held by the transaction, so the protected work itself may run
 * on pooled connections: mutual exclusion comes from the lock, and each
 * statement observes the latest committed state, which is exactly what a
 * check-then-act protocol needs. The lock releases on COMMIT/ROLLBACK.
 */
export async function withAdvisoryLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLocks([lockKey], fn);
}

/**
 * Run `fn` while holding several Postgres transaction-scoped advisory locks.
 *
 * Callers MUST pass keys in a globally consistent (sorted) order: combined
 * with single-key holders, sorted multi-key acquisition is what keeps the
 * file-lifecycle protocol deadlock-free. An empty key list runs `fn`
 * directly with no transaction.
 */
export async function withAdvisoryLocks<T>(lockKeys: string[], fn: () => Promise<T>): Promise<T> {
  if (lockKeys.length === 0) return fn();
  return withTransaction(async (client) => {
    for (const lockKey of lockKeys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    }
    return fn();
  });
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
