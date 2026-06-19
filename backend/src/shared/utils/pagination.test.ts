import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './pagination';

describe('cursor encode/decode', () => {
  it('round-trips a payload', () => {
    const payload = { ts: '2026-06-19T00:00:00.000Z', id: 'abc-123' };
    const encoded = encodeCursor(payload);
    expect(decodeCursor(encoded)).toEqual(payload);
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeCursor('not-valid-base64-json!!!')).toBeNull();
  });

  it('returns null for valid base64 of wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe('clampLimit', () => {
  it('defaults when undefined', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('defaults when zero', () => {
    expect(clampLimit(0)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('defaults when negative', () => {
    expect(clampLimit(-5)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('defaults when non-numeric string', () => {
    expect(clampLimit('abc')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('clamps to max', () => {
    expect(clampLimit(200)).toBe(MAX_PAGE_LIMIT);
  });

  it('accepts a numeric string', () => {
    expect(clampLimit('50')).toBe(50);
  });

  it('accepts a number in range', () => {
    expect(clampLimit(50)).toBe(50);
  });
});
