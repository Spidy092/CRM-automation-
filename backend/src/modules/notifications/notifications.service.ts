/**
 * Notifications service.
 *
 * This is the authoritative inter-module interface for creating notifications.
 * Other modules MUST call this service; they must never query the notifications
 * table directly.
 *
 * Delivery contract:
 *   1. The notification is persisted in PostgreSQL (source of truth).
 *   2. After successful persistence, a Redis signal is published so connected
 *      SSE clients receive the notification live.
 *   3. Redis publish failure does NOT remove the persisted row.  The client's
 *      HTTP reconciliation path recovers it on next focus/reconnect.
 *
 * For notifications that must be atomic with a business transaction (e.g.
 * lead_assigned), callers should pass the active PoolClient so that the
 * INSERT commits only if the outer transaction commits.
 */

import type { PoolClient } from 'pg';
import { logger } from '../../shared/utils/logger';
import { ok, err, type Result } from '../../shared/utils/result';
import { AppError } from '../../shared/middleware/errorHandler';
import { pushToUser } from './notifications.emitter';
import {
  createNotification as repoCreate,
  listNotifications as repoList,
  countUnread as repoCountUnread,
  markNotificationRead as repoMarkRead,
  markAllNotificationsRead as repoMarkAllRead,
  dismissNotification as repoDismiss,
  rowToDto,
} from './notifications.repository';
import { createNotificationInputSchema } from './notifications.schema';
import type {
  CreateNotificationInput,
  ListNotificationsOptions,
  NotificationPage,
  NotificationDto,
  NotificationRow,
} from './notifications.types';

// ── Create ────────────────────────────────────────────────────────────────

/**
 * Idempotently creates a notification.
 *
 * @param input     Validated input (occurrenceKey must be unique per
 *                  event occurrence × recipient).
 * @param executor  Optional PoolClient to commit atomically with a
 *                  business transaction.  Pass undefined to use the pool.
 *
 * The function:
 *   1. Validates input with Zod.
 *   2. Inserts into PostgreSQL (ON CONFLICT DO NOTHING).
 *   3. Publishes a live Redis signal (best-effort; errors are logged, not thrown).
 *
 * Returns the persisted notification DTO.  `created = false` when a row with
 * the same occurrence key already existed (idempotent skip).
 */
export async function createNotification(
  input: unknown,
  executor?: PoolClient,
): Promise<
  Result<
    { dto: NotificationDto; created: boolean; publishLiveSignal?: () => Promise<void> },
    AppError
  >
> {
  const parsed = createNotificationInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new AppError(
        `Invalid notification input: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        422,
      ),
    );
  }

  const validated: CreateNotificationInput = parsed.data as CreateNotificationInput;

  try {
    const { row, created } = await repoCreate(validated, executor);
    const dto = rowToDto(row);

    const publish = async () => {
      await publishLiveSignal(row);
    };

    // When running inside an external transaction executor, defer live signal
    // publication to avoid publishing before COMMIT. The caller invokes
    // publishLiveSignal() explicitly after transaction commit.
    // When running standalone (no executor), publish immediately.
    if (created && !executor) {
      void publish();
    }

    return ok({ dto, created, publishLiveSignal: publish });
  } catch (error) {
    logger.error('Failed to persist notification', {
      recipientUserId: validated.recipientUserId,
      occurrenceKey: validated.occurrenceKey,
      type: validated.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to persist notification', 500));
  }
}

export async function publishLiveSignal(row: NotificationRow): Promise<void> {
  try {
    await pushToUser(row.recipient_user_id, {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      data: row.metadata as Record<string, unknown>,
      timestamp: row.created_at,
    });
  } catch (error) {
    // Redis publish failure is non-fatal: the client's reconciliation path
    // will recover the notification on next focus or reconnect.
    logger.warn('Failed to publish live notification signal', {
      notificationId: row.id,
      recipientUserId: row.recipient_user_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── List ──────────────────────────────────────────────────────────────────

export async function listNotifications(
  opts: ListNotificationsOptions,
): Promise<Result<NotificationPage, AppError>> {
  try {
    const page = await repoList(opts);
    return ok(page);
  } catch (error) {
    logger.error('Failed to list notifications', {
      recipientUserId: opts.recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to list notifications', 500));
  }
}

// ── Unread count ──────────────────────────────────────────────────────────

export async function getUnreadCount(recipientUserId: string): Promise<Result<number, AppError>> {
  try {
    const count = await repoCountUnread(recipientUserId);
    return ok(count);
  } catch (error) {
    logger.error('Failed to get unread count', {
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to get unread count', 500));
  }
}

// ── Mark read ─────────────────────────────────────────────────────────────

export async function markRead(
  id: string,
  recipientUserId: string,
): Promise<Result<NotificationDto, AppError>> {
  try {
    const row = await repoMarkRead(id, recipientUserId);
    if (!row) {
      return err(new AppError('Notification not found', 404));
    }
    return ok(rowToDto(row));
  } catch (error) {
    logger.error('Failed to mark notification read', {
      id,
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to mark notification read', 500));
  }
}

// ── Mark all read ─────────────────────────────────────────────────────────

export async function markAllRead(
  recipientUserId: string,
  cutoffAt: string,
): Promise<Result<{ updated: number }, AppError>> {
  try {
    const updated = await repoMarkAllRead(recipientUserId, cutoffAt);
    return ok({ updated });
  } catch (error) {
    logger.error('Failed to mark all notifications read', {
      recipientUserId,
      cutoffAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to mark all notifications read', 500));
  }
}

// ── Dismiss ───────────────────────────────────────────────────────────────

export async function dismissNotification(
  id: string,
  recipientUserId: string,
): Promise<Result<NotificationDto, AppError>> {
  try {
    const row = await repoDismiss(id, recipientUserId);
    if (!row) {
      return err(new AppError('Notification not found', 404));
    }
    return ok(rowToDto(row));
  } catch (error) {
    logger.error('Failed to dismiss notification', {
      id,
      recipientUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to dismiss notification', 500));
  }
}

// ── Stream Revocation ─────────────────────────────────────────────────────

export { revokeUserSseStreams, getActiveUserStreamCount } from './notifications.controller';
