import { buildPlanIdempotencyKey, stableJson } from '../idempotency';

describe('idempotency', () => {
  it('stableJson sorts object keys', () => {
    const a = stableJson({ b: 1, a: 2 });
    const b = stableJson({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('stableJson handles nested objects', () => {
    const a = stableJson({ x: { b: 1, a: 2 }, y: [3, 2, 1] });
    const b = stableJson({ y: [3, 2, 1], x: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  it('buildPlanIdempotencyKey is deterministic for same inputs', () => {
    const k1 = buildPlanIdempotencyKey({
      source: 'chat',
      actorId: 'user-1',
      goal: 'find leads',
      sourceMessage: 'hello',
    });
    const k2 = buildPlanIdempotencyKey({
      source: 'chat',
      actorId: 'user-1',
      goal: 'find leads',
      sourceMessage: 'hello',
    });
    expect(k1).toBe(k2);
  });

  it('buildPlanIdempotencyKey changes when any input changes', () => {
    const base = { source: 'chat' as const, actorId: 'user-1', goal: 'find leads', sourceMessage: 'hello' };
    const k1 = buildPlanIdempotencyKey(base);
    const k2 = buildPlanIdempotencyKey({ ...base, goal: 'find contacts' });
    expect(k1).not.toBe(k2);
  });

  it('buildPlanIdempotencyKey starts with "plan:" prefix', () => {
    const k = buildPlanIdempotencyKey({ source: 'chat', actorId: null, goal: 'x', sourceMessage: null });
    expect(k.startsWith('plan:')).toBe(true);
  });
});
