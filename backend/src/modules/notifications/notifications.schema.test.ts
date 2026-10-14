/**
 * Notifications schema unit tests.
 * Validates Zod schemas: metadata allowlist, cursor decode, deep-link check.
 */

import { describe, it, expect } from '@jest/globals';
import {
  listNotificationsQuerySchema,
  markAllReadBodySchema,
  metadataSchema,
  isAllowedDeepLink,
} from './notifications.schema';

// ── metadataSchema ─────────────────────────────────────────────────────────

describe('metadataSchema', () => {
  it('passes allowed keys through', () => {
    const result = metadataSchema.parse({ leadId: 'l1', campaignId: 'c1', score: 85 });
    expect(result).toEqual({ leadId: 'l1', campaignId: 'c1', score: 85 });
  });

  it('strips unknown keys', () => {
    const result = metadataSchema.parse({ leadId: 'l1', unknownField: 'bad' });
    expect(result).not.toHaveProperty('unknownField');
    expect(result.leadId).toBe('l1');
  });

  it('returns empty object when undefined', () => {
    const result = metadataSchema.parse(undefined);
    expect(result).toEqual({});
  });

  it('rejects non-string / non-number values', () => {
    expect(() => metadataSchema.parse({ leadId: { nested: true } })).toThrow();
  });
});

// ── listNotificationsQuerySchema ───────────────────────────────────────────

describe('listNotificationsQuerySchema', () => {
  it('defaults limit to 50 when absent', () => {
    const result = listNotificationsQuerySchema.parse({});
    expect(result.limit).toBe(50);
  });

  it('caps limit at 100', () => {
    const result = listNotificationsQuerySchema.parse({ limit: '200' });
    expect(result.limit).toBe(100);
  });

  it('decodes a valid base64 cursor', () => {
    const payload = {
      createdAt: '2026-10-09T10:00:00.000Z',
      id: 'a0000000-0000-0000-0000-000000000001',
    };
    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    const result = listNotificationsQuerySchema.parse({ cursor });
    expect(result.cursor).toEqual(payload);
  });

  it('rejects cursor with invalid date', () => {
    const payload = {
      createdAt: 'not-a-date',
      id: 'a0000000-0000-0000-0000-000000000001',
    };
    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    const result = listNotificationsQuerySchema.parse({ cursor });
    expect(result.cursor).toBeUndefined();
  });

  it('rejects cursor with non-UUID id', () => {
    const payload = {
      createdAt: '2026-10-09T10:00:00.000Z',
      id: 'not-a-uuid',
    };
    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    const result = listNotificationsQuerySchema.parse({ cursor });
    expect(result.cursor).toBeUndefined();
  });

  it('treats a malformed cursor as absent (undefined)', () => {
    const result = listNotificationsQuerySchema.parse({ cursor: 'not-base64-json!' });
    expect(result.cursor).toBeUndefined();
  });

  it('defaults excludeDismissed to false', () => {
    const result = listNotificationsQuerySchema.parse({});
    expect(result.excludeDismissed).toBe(false);
  });

  it('sets excludeDismissed true when string "true"', () => {
    const result = listNotificationsQuerySchema.parse({ excludeDismissed: 'true' });
    expect(result.excludeDismissed).toBe(true);
  });
});

// ── markAllReadBodySchema ──────────────────────────────────────────────────

describe('markAllReadBodySchema', () => {
  it('accepts valid ISO timestamp', () => {
    const result = markAllReadBodySchema.safeParse({ cutoffAt: '2026-10-09T10:00:00Z' });
    expect(result.success).toBe(true);
  });

  it('rejects non-ISO string', () => {
    const result = markAllReadBodySchema.safeParse({ cutoffAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects missing cutoffAt', () => {
    const result = markAllReadBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── isAllowedDeepLink ──────────────────────────────────────────────────────

describe('isAllowedDeepLink', () => {
  it('allows relative path starting with /', () => {
    expect(isAllowedDeepLink('/leads/uuid-1')).toBe(true);
  });

  it('rejects absolute URLs', () => {
    expect(isAllowedDeepLink('https://evil.com')).toBe(false);
    expect(isAllowedDeepLink('http://evil.com')).toBe(false);
  });

  it('rejects javascript: scheme', () => {
    expect(isAllowedDeepLink('javascript:alert(1)')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isAllowedDeepLink('//evil.com')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isAllowedDeepLink(null)).toBe(false);
    expect(isAllowedDeepLink(42)).toBe(false);
  });

  it('rejects strings longer than 500 chars', () => {
    expect(isAllowedDeepLink('/' + 'a'.repeat(501))).toBe(false);
  });
});
