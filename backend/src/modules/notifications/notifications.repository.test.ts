/**
 * Notifications repository unit tests.
 *
 * Tests the cursor encoding, DTO mapper, and schema construction.
 * Database-integration tests (with a live PostgreSQL instance) are required
 * for the SQL logic; those must be run in an environment with DATABASE_URL set.
 */

import { describe, it, expect } from '@jest/globals';
import { encodeCursor, rowToDto } from './notifications.repository';
import type { NotificationRow } from './notifications.types';

function makeRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'uuid-1',
    recipient_user_id: 'user-1',
    occurrence_key: 'assignment:assign-1',
    type: 'lead_assigned',
    title: 'New lead',
    message: 'A lead was assigned to you',
    metadata: { leadId: 'lead-1' },
    read_at: null,
    dismissed_at: null,
    created_at: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

// ── encodeCursor ───────────────────────────────────────────────────────────

describe('encodeCursor', () => {
  it('produces a base64 string that decodes to { createdAt, id }', () => {
    const row = makeRow();
    const cursor = encodeCursor(row);
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      createdAt: string;
      id: string;
    };
    expect(decoded.createdAt).toBe(row.created_at);
    expect(decoded.id).toBe(row.id);
  });

  it('produces a different cursor for different rows', () => {
    const r1 = makeRow({ id: 'uuid-1', created_at: '2026-10-09T10:00:00.000Z' });
    const r2 = makeRow({ id: 'uuid-2', created_at: '2026-10-09T11:00:00.000Z' });
    expect(encodeCursor(r1)).not.toBe(encodeCursor(r2));
  });
});

// ── rowToDto ───────────────────────────────────────────────────────────────

describe('rowToDto', () => {
  it('maps snake_case row fields to camelCase DTO', () => {
    const now = '2026-10-09T10:00:00.000Z';
    const row = makeRow({ read_at: now, dismissed_at: null });
    const dto = rowToDto(row);

    expect(dto.id).toBe('uuid-1');
    expect(dto.type).toBe('lead_assigned');
    expect(dto.readAt).toBe(now);
    expect(dto.dismissedAt).toBeNull();
    expect(dto.createdAt).toBe('2026-10-09T10:00:00.000Z');
    expect(dto.metadata).toEqual({ leadId: 'lead-1' });
  });

  it('includes metadata keys from the allowlist', () => {
    const row = makeRow({ metadata: { leadId: 'l1', campaignId: 'c1' } });
    const dto = rowToDto(row);
    expect(dto.metadata.leadId).toBe('l1');
    expect(dto.metadata.campaignId).toBe('c1');
  });
});
