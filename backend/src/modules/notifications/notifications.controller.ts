/**
 * Notifications controller.
 *
 * SSE transport (existing, preserved):
 *   - mintSseTicketHandler — mints a single-use 30s Redis ticket.
 *   - consumeSseTicket     — atomic GETDEL (Redis 6.2+).
 *   - sseHandler           — streams live notifications to the client.
 *
 * New HTTP endpoints (durable notification history):
 *   - listNotificationsHandler     GET  /api/v1/notifications
 *   - getUnreadCountHandler        GET  /api/v1/notifications/unread-count
 *   - markReadHandler              PATCH /api/v1/notifications/:id/read
 *   - markAllReadHandler           POST  /api/v1/notifications/read-all
 *   - dismissHandler               PATCH /api/v1/notifications/:id/dismiss
 *
 * Security:
 *   - All recipient IDs are taken from req.user.id (JWT context), never from
 *     the request body or query string.
 *   - Notification content is rendered as text; deep links are not followed
 *     by the server — the client validates them independently.
 */

import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { subscribeUser, pushToUser } from './notifications.emitter';
import { logger } from '../../shared/utils/logger';
import { redis } from '../../shared/utils/redis';
import { sendSuccess, sendError } from '../../shared/utils/response';
import {
  listNotificationsQuerySchema,
  markReadParamsSchema,
  dismissParamsSchema,
  markAllReadBodySchema,
} from './notifications.schema';
import { rowToDto } from './notifications.repository';
import {
  listNotifications as svcList,
  getUnreadCount as svcUnreadCount,
  markRead as svcMarkRead,
  markAllRead as svcMarkAllRead,
  dismissNotification as svcDismiss,
} from './notifications.service';

// ── SSE transport (preserved) ─────────────────────────────────────────────

const TICKET_PREFIX = 'sse:ticket:';
const TICKET_TTL_SECONDS = 30;

/**
 * Mints a single-use, short-lived ticket that stands in for the caller's
 * Bearer token on the SSE connection. EventSource can't send custom headers,
 * so the long-lived access token would otherwise have to ride in the URL
 * query string — visible in access logs, browser history, and referrers.
 */
export async function mintSseTicketHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const isRevoked = await redis.get(`sse:revoked:${user.id}`);
  if (isRevoked) {
    res.status(401).json({ success: false, error: 'User session has been revoked' });
    return;
  }

  const ticket = randomUUID();
  await redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(user), 'EX', TICKET_TTL_SECONDS);

  // no-store prevents the ticket from appearing in browser disk cache.
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { ticket, expiresInSeconds: TICKET_TTL_SECONDS } });
}

export async function consumeSseTicket(ticket: string): Promise<Request['user'] | null> {
  // GETDEL is atomic (Redis 6.2+) so a ticket can never be replayed even
  // under concurrent requests.
  const raw = await redis.getdel(`${TICKET_PREFIX}${ticket}`);
  if (!raw) return null;
  const user = JSON.parse(raw) as Request['user'];
  if (user?.id) {
    const isRevoked = await redis.get(`sse:revoked:${user.id}`);
    if (isRevoked) return null;
  }
  return user;
}

/** Default maximum stream duration before graceful reconnect is required (30 minutes). */
export const SSE_STREAM_MAX_DURATION_MS =
  Number(process.env.SSE_STREAM_MAX_DURATION_MS) || 30 * 60 * 1000;

type StreamCloser = (reason: string) => void;
const activeUserStreams = new Map<string, Set<StreamCloser>>();

export function getActiveUserStreamCount(userId: string): number {
  return activeUserStreams.get(userId)?.size ?? 0;
}

/**
 * Revokes all active SSE streams for a given user across this instance and cluster nodes.
 */
export async function revokeUserSseStreams(
  userId: string,
  reason = 'session_revoked',
): Promise<number> {
  // Store short-lived revocation flag in Redis to reject subsequent ticket minting/consumption
  await redis.set(`sse:revoked:${userId}`, reason, 'EX', 300);

  // Close in-memory streams for this user on this instance
  const closers = activeUserStreams.get(userId);
  let closedCount = 0;
  if (closers) {
    closedCount = closers.size;
    for (const close of Array.from(closers)) {
      close(reason);
    }
    activeUserStreams.delete(userId);
  }

  // Broadcast cross-process revocation to any other cluster instances via Redis pubsub
  await pushToUser(userId, {
    id: randomUUID(),
    type: 'stream_revoked',
    title: 'Session revoked',
    message: reason,
    timestamp: new Date().toISOString(),
  });

  logger.info('Revoked SSE streams for user', { userId, reason, closedCount });
  return closedCount;
}

/** Maximum simultaneous SSE connections per user (defence-in-depth). */
const MAX_SSE_CONNECTIONS_PER_USER = 10;
const activeConnections = new Map<string, number>();

export function sseHandler(req: Request, res: Response): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // Bound connections per user.
  const current = activeConnections.get(user.id) ?? 0;
  if (current >= MAX_SSE_CONNECTIONS_PER_USER) {
    res.status(429).json({ success: false, error: 'Too many SSE connections' });
    return;
  }
  activeConnections.set(user.id, current + 1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(':connected\n\n');

  let isClosed = false;
  const closeStream = (reason: string): void => {
    if (isClosed) return;
    isClosed = true;
    try {
      res.write(`event: stream_revoked\ndata: ${JSON.stringify({ reason })}\n\n`);
      res.end();
    } catch {
      // socket may already be closed
    }
  };

  let userClosers = activeUserStreams.get(user.id);
  if (!userClosers) {
    userClosers = new Set();
    activeUserStreams.set(user.id, userClosers);
  }
  userClosers.add(closeStream);

  // Enforce maximum stream duration / expiry
  const expiryTimer = setTimeout(() => {
    if (isClosed) return;
    isClosed = true;
    logger.info('SSE stream expired (max duration reached)', { userId: user.id });
    try {
      res.write(
        'event: stream_expired\ndata: {"message":"Stream expired, re-authentication required"}\n\n',
      );
      res.end();
    } catch {
      // socket already closed
    }
  }, SSE_STREAM_MAX_DURATION_MS);

  const heartbeat = setInterval(() => {
    if (!isClosed) {
      res.write(':heartbeat\n\n');
    }
  }, 25_000);

  const unsubscribe = subscribeUser(user.id, (notification) => {
    if (notification.type === 'stream_revoked') {
      closeStream(notification.message || 'Stream revoked');
      return;
    }
    // Include SSE id: field for stable event identity.
    res.write(`id: ${notification.id}\ndata: ${JSON.stringify(notification)}\n\n`);
  });

  logger.info('SSE client connected', { userId: user.id, activeConnections: current + 1 });

  req.on('close', () => {
    isClosed = true;
    clearTimeout(expiryTimer);
    clearInterval(heartbeat);
    unsubscribe();

    const closersSet = activeUserStreams.get(user.id);
    if (closersSet) {
      closersSet.delete(closeStream);
      if (closersSet.size === 0) {
        activeUserStreams.delete(user.id);
      }
    }

    const remaining = (activeConnections.get(user.id) ?? 1) - 1;
    if (remaining <= 0) {
      activeConnections.delete(user.id);
    } else {
      activeConnections.set(user.id, remaining);
    }
    logger.info('SSE client disconnected', { userId: user.id, activeConnections: remaining });
  });
}

// ── HTTP handlers ─────────────────────────────────────────────────────────

export async function listNotificationsHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  const parsed = listNotificationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? 'Invalid query', 400);
    return;
  }

  const { limit, cursor, excludeDismissed } = parsed.data;

  const result = await svcList({
    recipientUserId: user.id,
    limit,
    cursorCreatedAt: cursor?.createdAt,
    cursorId: cursor?.id,
    excludeDismissed,
  });

  if (!result.ok) {
    sendError(res, result.error.message, result.error.statusCode ?? 500);
    return;
  }

  const { items, nextCursor } = result.value;
  sendSuccess(res, items.map(rowToDto), 200, {
    limit,
    hasMore: nextCursor !== null,
    nextCursor: nextCursor ?? undefined,
  });
}

export async function getUnreadCountHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  const result = await svcUnreadCount(user.id);
  if (!result.ok) {
    sendError(res, result.error.message, result.error.statusCode ?? 500);
    return;
  }

  sendSuccess(res, { count: result.value });
}

export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  const parsed = markReadParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, 'Invalid notification id', 400);
    return;
  }

  const result = await svcMarkRead(parsed.data.id, user.id);
  if (!result.ok) {
    const code = result.error.statusCode ?? 500;
    sendError(res, result.error.message, code);
    return;
  }

  sendSuccess(res, result.value);
}

export async function markAllReadHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  const parsed = markAllReadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? 'Invalid body', 400);
    return;
  }

  const result = await svcMarkAllRead(user.id, parsed.data.cutoffAt);
  if (!result.ok) {
    sendError(res, result.error.message, result.error.statusCode ?? 500);
    return;
  }

  sendSuccess(res, result.value);
}

export async function dismissHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  const parsed = dismissParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, 'Invalid notification id', 400);
    return;
  }

  const result = await svcDismiss(parsed.data.id, user.id);
  if (!result.ok) {
    const code = result.error.statusCode ?? 500;
    sendError(res, result.error.message, code);
    return;
  }

  sendSuccess(res, result.value);
}
