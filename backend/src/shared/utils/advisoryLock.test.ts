/**
 * Live-Postgres tests for the advisory-lock file-lifecycle protocol primitive.
 *
 * These need a reachable database (any database — no tables are touched) and
 * skip with a warning when none is configured, so mocked-unit CI stays green.
 * The domain-level race regression test lives in
 * modules/files/fileLifecycle.concurrency.test.ts; this file proves the lock
 * itself serializes across connections, which that test takes as given.
 */
import { advisoryLockKey, checkDbConnection, withAdvisoryLock } from './db';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('withAdvisoryLock (live postgres)', () => {
  let available = false;

  beforeAll(async () => {
    available = await checkDbConnection();
    if (!available) {
      console.warn('skipping live advisory-lock tests: no database connection (set DATABASE_URL)');
    }
  });

  it('builds stable namespaced keys', () => {
    expect(advisoryLockKey('file-lifecycle', 'f1')).toBe('file-lifecycle:f1');
  });

  it('serializes two holders of the same key across connections', async () => {
    if (!available) return;
    const key = advisoryLockKey('test-file-lifecycle', `overlap-${Date.now()}`);
    const events: Array<{ holder: string; at: number }> = [];

    const holderA = withAdvisoryLock(key, async () => {
      events.push({ holder: 'a-enter', at: Date.now() });
      await sleep(400);
      events.push({ holder: 'a-exit', at: Date.now() });
    });
    await sleep(50);
    const holderB = withAdvisoryLock(key, async () => {
      events.push({ holder: 'b-enter', at: Date.now() });
    });

    await Promise.all([holderA, holderB]);
    const at = (name: string): number => events.find((e) => e.holder === name)?.at ?? -1;
    // Generous margins: B must not enter while A still holds the lock.
    expect(at('b-enter')).toBeGreaterThanOrEqual(at('a-exit') - 50);
    expect(at('a-exit') - at('a-enter')).toBeGreaterThanOrEqual(300);
  });

  it('does not block holders of different keys', async () => {
    if (!available) return;
    const stamp = Date.now();
    const started = Date.now();
    await Promise.all([
      withAdvisoryLock(advisoryLockKey('test-file-lifecycle', `a-${stamp}`), () => sleep(300)),
      withAdvisoryLock(advisoryLockKey('test-file-lifecycle', `b-${stamp}`), () => sleep(300)),
    ]);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('releases the lock when the body throws (rollback path)', async () => {
    if (!available) return;
    const key = advisoryLockKey('test-file-lifecycle', `failure-${Date.now()}`);
    await expect(
      withAdvisoryLock(key, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const started = Date.now();
    await withAdvisoryLock(key, async () => undefined);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
