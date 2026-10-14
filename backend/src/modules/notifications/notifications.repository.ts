/**
 * Notifications repository.
 *
 * All queries are scoped to the authenticated recipient; the caller must
 * pass `recipientUserId` from the verified JWT context, never from the
 * request body.
 *
 * Architecture notes:
 * - `createNotification` uses ON CONFLICT DO NOTHING to stay idempotent so
 *   that worker retries cannot produce duplicate rows.
 * - `markAllRead` applies a snapshot cutoff (≤ cutoffAt) so notifications
 *   that arrive after the user clicks "Mark all read" stay unread.
 * - Cursor pagination uses (created_at, id) for deterministic ordering even
 *   when multiple notifications share the same timestamp.
 */

import { pool } from '../../shared/utils/db';
import type { PoolClient } from 'pg';
import type {
  NotificationRow,
  CreateNotificationInput,
  ListNotificationsOptions,
  NotificationPage,
  NotificationDto,
} from './notifications.types';

type Executor = typeof pool | PoolClient;

// ── Columns ────────────────────────────────────────────────────────────────

const COLUMNS = `
  id, recipient_user_id, occurrence_key, type, title, message,
  metadata, read_at, dismissed_at, created_at`;

// ── Cursor helpers ─────────────────────────────────────────────────────────

export function encodeCursor(row: Pick<NotificationRow, 'created_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64');
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Idempotently inserts a notification row.  Returns the persisted row (either
 * newly created or the existing row for the same occurrence_key + recipient).
 */
export async function createNotification(
  input: CreateNotificationInput,
  executor: Executor = pool,
): Promise<{ row: NotificationRow; created: boolean }> {
  const { recipientUserId, occurrenceKey, type, title, message, metadata } = input;

  // Attempt insert
  const inserted = await executor.query<NotificationRow & { created: boolean }>(
    `INSERT INTO notifications
       (recipient_user_id, occurrence_key, type, title, message, metadata)
     VALUES ($1, $2, $3::notification_type, $4, $5, $6::jsonb)
     ON CONFLICT (occurrence_key, recipient_user_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [recipientUserId, occurrenceKey, type, title, message, JSON.stringify(metadata ?? {})],
  );

  if (inserted.rows[0]) {
    return { row: inserted.rows[0], created: true };
  }

  // Row already existed — fetch it for the caller.
  const existing = await executor.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM notifications
     WHERE occurrence_key = $1 AND recipient_user_id = $2`,
    [occurrenceKey, recipientUserId],
  );
  return { row: existing.rows[0], created: false };
}

/**
 * Cursor-paginated list of a user's notifications, ordered newest-first.
 * Does NOT automatically filter out dismissed items; the caller controls
 * `excludeDismissed`.
 */
export async function listNotifications(opts: ListNotificationsOptions): Promise<NotificationPage> {
  const { recipientUserId, limit, cursorCreatedAt, cursorId, excludeDismissed } = opts;

  const params: unknown[] = [recipientUserId, limit + 1];
  const conditions: string[] = ['n.recipient_user_id = $1'];

  if (excludeDismissed) {
    conditions.push('n.dismissed_at IS NULL');
  }

  // Cursor: (created_at, id) deterministic pagination.
  if (cursorCreatedAt && cursorId) {
    const idx = params.push(cursorCreatedAt, cursorId);
    conditions.push(`(n.created_at, n.id) < ($${idx - 1}::timestamptz, $${idx}::uuid)`);
  }

  const where = conditions.join(' AND ');
  const sql = `
    SELECT ${COLUMNS}
    FROM   notifications n
    WHERE  ${where}
    ORDER  BY n.created_at DESC, n.id DESC
    LIMIT  $2`;

  const result = await pool.query<NotificationRow>(sql, params);
  const rows = result.rows;

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop(); // remove the extra "probe" row
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor(last);
  }

  return { items: rows, nextCursor };
}

/**
 * Authoritative unread count for a user.  Excludes dismissed items.
 */
export async function countUnread(recipientUserId: string): Promise<number> {
  const result = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
     FROM   notifications
     WHERE  recipient_user_id = $1
       AND  read_at IS NULL
       AND  dismissed_at IS NULL`,
    [recipientUserId],
  );
  return parseInt(result.rows[0]?.cnt ?? '0', 10);
}

/**
 * Idempotently marks a single notification read.  Only updates if the
 * notification belongs to the recipient and has not yet been read.
 * Returns the updated row, or null if not found / not owned.
 */
export async function markNotificationRead(
  id: string,
  recipientUserId: string,
): Promise<NotificationRow | null> {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET    read_at = NOW()
     WHERE  id = $1
       AND  recipient_user_id = $2
       AND  read_at IS NULL
     RETURNING ${COLUMNS}`,
    [id, recipientUserId],
  );
  if (result.rows[0]) return result.rows[0];

  // Return the existing row if already read (idempotent success).
  const existing = await pool.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM notifications
     WHERE id = $1 AND recipient_user_id = $2`,
    [id, recipientUserId],
  );
  return existing.rows[0] ?? null;
}

/**
 * Marks all unread notifications up to and including `cutoffAt` as read.
 * Notifications created after the cutoff are untouched.
 * Returns the number of rows updated.
 */
export async function markAllNotificationsRead(
  recipientUserId: string,
  cutoffAt: string,
): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `UPDATE notifications
     SET    read_at = NOW()
     WHERE  recipient_user_id = $1
       AND  read_at IS NULL
       AND  dismissed_at IS NULL
       AND  created_at <= $2::timestamptz
     RETURNING id`,
    [recipientUserId, cutoffAt],
  );
  return result.rowCount ?? 0;
}

/**
 * Idempotently dismisses a single notification.  Only dismisses if it
 * belongs to the recipient and has not yet been dismissed.
 * Returns the updated row, or null if not found / not owned.
 */
export async function dismissNotification(
  id: string,
  recipientUserId: string,
): Promise<NotificationRow | null> {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET    dismissed_at = NOW()
     WHERE  id = $1
       AND  recipient_user_id = $2
       AND  dismissed_at IS NULL
     RETURNING ${COLUMNS}`,
    [id, recipientUserId],
  );
  if (result.rows[0]) return result.rows[0];

  // Return the existing row if already dismissed (idempotent success).
  const existing = await pool.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM notifications
     WHERE id = $1 AND recipient_user_id = $2`,
    [id, recipientUserId],
  );
  return existing.rows[0] ?? null;
}

// ── Row-to-DTO mapper ──────────────────────────────────────────────────────

export function rowToDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata: row.metadata,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
  };
}
