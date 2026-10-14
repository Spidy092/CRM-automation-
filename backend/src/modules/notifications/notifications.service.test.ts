/**
 * Notifications service unit tests.
 *
 * Tests the service layer in isolation with repository and emitter mocked.
 * Covers: ownership enforcement, pagination, read/dismiss, snapshot cutoff,
 * deduplication, separate reassignment occurrences, Redis failure resilience.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── Module mocks ──────────────────────────────────────────────────────────

jest.mock('./notifications.repository', () => ({
  createNotification: jest.fn(),
  listNotifications: jest.fn(),
  countUnread: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  dismissNotification: jest.fn(),
  rowToDto: jest.fn((row: any) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata: row.metadata,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
  })),
  encodeCursor: jest.fn(),
}));

jest.mock('./notifications.emitter', () => ({
  pushToUser: jest.fn(),
}));

jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Imports after mocks ────────────────────────────────────────────────────

import * as repo from './notifications.repository';
import * as emitter from './notifications.emitter';
import {
  createNotification,
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  dismissNotification,
} from './notifications.service';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedEmitter = emitter as jest.Mocked<typeof emitter>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<Parameters<typeof createNotification>[0]> = {}) {
  return {
    id: 'b0000000-0000-0000-0000-000000000001',
    recipient_user_id: 'a0000000-0000-0000-0000-000000000001',
    occurrence_key: 'assignment:assign-uuid-1',
    type: 'lead_assigned' as const,
    title: 'New lead',
    message: 'A lead was assigned',
    metadata: { leadId: 'lead-1' },
    read_at: null,
    dismissed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const VALID_INPUT = {
  recipientUserId: 'a0000000-0000-0000-0000-000000000001',
  occurrenceKey: 'assignment:assign-uuid-1',
  type: 'lead_assigned' as const,
  title: 'New lead',
  message: 'A lead was assigned',
  metadata: { leadId: 'lead-1' },
};

// ── createNotification ─────────────────────────────────────────────────────

describe('createNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepo.rowToDto.mockImplementation((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      metadata: row.metadata,
      readAt: row.read_at,
      dismissedAt: row.dismissed_at,
      createdAt: row.created_at,
    }));
  });

  it('persists the notification and returns ok when repo succeeds', async () => {
    const row = makeRow();
    mockedRepo.createNotification.mockResolvedValue({ row, created: true });
    mockedEmitter.pushToUser.mockResolvedValue();

    const result = await createNotification(VALID_INPUT);

    expect(result.ok).toBe(true);
    expect(mockedRepo.createNotification).toHaveBeenCalledTimes(1);
  });

  it('publishes live signal only when row was newly created', async () => {
    const row = makeRow();
    mockedRepo.createNotification.mockResolvedValue({ row, created: false });

    const result = await createNotification(VALID_INPUT);

    // Give the void promise a tick to settle
    await Promise.resolve();

    expect(result.ok).toBe(true);
    expect(mockedEmitter.pushToUser).not.toHaveBeenCalled();
  });

  it('does not publish live signal immediately when transaction executor is supplied', async () => {
    const row = makeRow();
    mockedRepo.createNotification.mockResolvedValue({ row, created: true });
    mockedEmitter.pushToUser.mockResolvedValue();

    const fakeExecutor = {} as any;
    const result = await createNotification(VALID_INPUT, fakeExecutor);

    await Promise.resolve();

    expect(result.ok).toBe(true);
    // Not published automatically
    expect(mockedEmitter.pushToUser).not.toHaveBeenCalled();

    if (result.ok && result.value.publishLiveSignal) {
      await result.value.publishLiveSignal();
      expect(mockedEmitter.pushToUser).toHaveBeenCalledTimes(1);
    }
  });

  it('returns err when input is invalid', async () => {
    const result = await createNotification({ ...VALID_INPUT, recipientUserId: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    expect(mockedRepo.createNotification).not.toHaveBeenCalled();
  });

  it('returns err when repo throws', async () => {
    mockedRepo.createNotification.mockRejectedValue(new Error('DB down'));
    const result = await createNotification(VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.statusCode).toBe(500);
    }
  });

  it('does not fail when pushToUser throws after persistence', async () => {
    const row = makeRow();
    mockedRepo.createNotification.mockResolvedValue({ row, created: true });
    mockedEmitter.pushToUser.mockRejectedValue(new Error('Redis down'));

    const result = await createNotification(VALID_INPUT);
    // Give the void catch a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(result.ok).toBe(true);
  });

  it('deduplicates: calling twice with same occurrenceKey returns ok both times', async () => {
    const row = makeRow();
    mockedRepo.createNotification
      .mockResolvedValueOnce({ row, created: true })
      .mockResolvedValueOnce({ row, created: false });
    mockedEmitter.pushToUser.mockResolvedValue();

    const r1 = await createNotification(VALID_INPUT);
    const r2 = await createNotification(VALID_INPUT);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Live signal published only on first creation
    await Promise.resolve();
    expect(mockedEmitter.pushToUser).toHaveBeenCalledTimes(1);
  });

  it('separate occurrenceKeys for same lead produce separate notifications', async () => {
    const row1 = makeRow({ occurrence_key: 'assignment:uuid-1' });
    const row2 = makeRow({ occurrence_key: 'assignment:uuid-2', id: 'notif-uuid-2' });
    mockedRepo.createNotification
      .mockResolvedValueOnce({ row: row1, created: true })
      .mockResolvedValueOnce({ row: row2, created: true });
    mockedEmitter.pushToUser.mockResolvedValue();

    const r1 = await createNotification({ ...VALID_INPUT, occurrenceKey: 'assignment:uuid-1' });
    const r2 = await createNotification({ ...VALID_INPUT, occurrenceKey: 'assignment:uuid-2' });

    expect(r1.ok && r2.ok).toBe(true);
    await Promise.resolve();
    expect(mockedEmitter.pushToUser).toHaveBeenCalledTimes(2);
  });
});

// ── listNotifications ──────────────────────────────────────────────────────

describe('listNotifications', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns paginated items', async () => {
    const items = [makeRow(), makeRow()];
    mockedRepo.listNotifications.mockResolvedValue({ items, nextCursor: null });

    const result = await listNotifications({ recipientUserId: 'user-1', limit: 20 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
    }
  });

  it('returns err when repo throws', async () => {
    mockedRepo.listNotifications.mockRejectedValue(new Error('DB error'));
    const result = await listNotifications({ recipientUserId: 'user-1', limit: 20 });
    expect(result.ok).toBe(false);
  });
});

// ── getUnreadCount ─────────────────────────────────────────────────────────

describe('getUnreadCount', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns the authoritative unread count', async () => {
    mockedRepo.countUnread.mockResolvedValue(7);
    const result = await getUnreadCount('user-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(7);
  });

  it('returns err on DB failure', async () => {
    mockedRepo.countUnread.mockRejectedValue(new Error('timeout'));
    const result = await getUnreadCount('user-1');
    expect(result.ok).toBe(false);
  });
});

// ── markRead ───────────────────────────────────────────────────────────────

describe('markRead', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('marks owned notification read', async () => {
    const row = makeRow({ read_at: new Date().toISOString() });
    mockedRepo.markNotificationRead.mockResolvedValue(row);
    const result = await markRead('notif-uuid-1', 'user-1');
    expect(result.ok).toBe(true);
  });

  it('returns 404 when notification not found or not owned', async () => {
    mockedRepo.markNotificationRead.mockResolvedValue(null);
    const result = await markRead('notif-uuid-1', 'other-user');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(404);
  });

  it('is idempotent: marking already-read notification returns ok', async () => {
    const row = makeRow({ read_at: new Date().toISOString() });
    // When already read the repo also returns the row
    mockedRepo.markNotificationRead.mockResolvedValue(row);
    const result = await markRead('notif-uuid-1', 'user-1');
    expect(result.ok).toBe(true);
  });
});

// ── markAllRead ────────────────────────────────────────────────────────────

describe('markAllRead', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('applies snapshot cutoff and returns count', async () => {
    mockedRepo.markAllNotificationsRead.mockResolvedValue(5);
    const cutoff = new Date().toISOString();
    const result = await markAllRead('user-1', cutoff);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.updated).toBe(5);
    expect(mockedRepo.markAllNotificationsRead).toHaveBeenCalledWith('user-1', cutoff);
  });

  it('newer arrivals after cutoff are not marked read', async () => {
    // The repo already enforces the cutoff; we verify the service passes it through
    mockedRepo.markAllNotificationsRead.mockResolvedValue(3);
    const cutoff = '2026-10-09T10:00:00Z';
    await markAllRead('user-1', cutoff);
    const [recipientArg, cutoffArg] = mockedRepo.markAllNotificationsRead.mock.calls[0] ?? [];
    expect(recipientArg).toBe('user-1');
    expect(cutoffArg).toBe(cutoff);
  });
});

// ── dismissNotification ────────────────────────────────────────────────────

describe('dismissNotification', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('dismisses an owned notification', async () => {
    const row = makeRow({ dismissed_at: new Date().toISOString() });
    mockedRepo.dismissNotification.mockResolvedValue(row);
    const result = await dismissNotification('notif-uuid-1', 'user-1');
    expect(result.ok).toBe(true);
  });

  it('returns 404 when not found or not owned', async () => {
    mockedRepo.dismissNotification.mockResolvedValue(null);
    const result = await dismissNotification('notif-uuid-1', 'other-user');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(404);
  });
});
