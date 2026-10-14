/**
 * Notifications routes.
 *
 * Mounted at /api/v1/events (existing) for SSE compatibility, and also at
 * /api/v1/notifications for the new durable history API.
 *
 * SECURITY-SENSITIVE: authentication and RBAC are applied here; any changes
 * require a security review.
 *
 * SSE endpoints:
 *   POST /api/v1/events/ticket  — mint single-use 30s ticket (auth required)
 *   GET  /api/v1/events         — open SSE stream (ticket or Bearer auth)
 *
 * Durable history endpoints (all require JWT authentication + allRoles RBAC):
 *   GET   /api/v1/notifications                  — paginated inbox
 *   GET   /api/v1/notifications/unread-count      — authoritative unread count
 *   PATCH /api/v1/notifications/:id/read          — mark a single item read
 *   POST  /api/v1/notifications/read-all          — mark all read up to cutoff
 *   PATCH /api/v1/notifications/:id/dismiss       — dismiss a single item
 *
 * Note: Nginx must serve /api/v1/events with proxy_buffering off.  The
 * dedicated streaming location in nginx.prod.conf (/api/v1/notifications/stream)
 * does NOT match this path; the generic /api/ location handles it, relying on
 * the X-Accel-Buffering: no header set by sseHandler.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from '../../shared/types';
import { authenticate } from '../../shared/middleware/auth';
import { allRoles } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { wrap } from '../../shared/utils/asyncHandler';
import { redis } from '../../shared/utils/redis';
import {
  sseHandler,
  mintSseTicketHandler,
  consumeSseTicket,
  listNotificationsHandler,
  getUnreadCountHandler,
  markReadHandler,
  markAllReadHandler,
  dismissHandler,
} from './notifications.controller';

// ── SSE auth middleware ───────────────────────────────────────────────────

/**
 * SSE endpoints cannot send custom headers (EventSource API limitation).
 * Preferred path: a single-use, 30s ticket minted via POST /ticket (never
 * logged/reused). Bearer header still works for non-browser clients. A raw
 * `?token=` JWT is intentionally NOT accepted here — it would sit in access
 * logs/browser history for the life of the token instead of 30 seconds.
 */
async function authenticateSSE(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const ticket = req.query.ticket as string | undefined;

  if (ticket) {
    try {
      const user = await consumeSseTicket(ticket);
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid or expired ticket' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(500).json({ success: false, error: 'Server misconfiguration' });
    }
    return;
  }

  if (!bearerToken) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const publicKey = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!publicKey) {
    res.status(500).json({ success: false, error: 'Server misconfiguration' });
    return;
  }

  let payload: AuthenticatedUser & {
    iat: number;
    exp: number;
  };
  try {
    payload = jwt.verify(bearerToken, publicKey, {
      algorithms: ['RS256'],
    }) as AuthenticatedUser & {
      iat: number;
      exp: number;
    };
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  try {
    const isRevoked = await redis.get(`sse:revoked:${payload.id}`);
    if (isRevoked) {
      res.status(401).json({ success: false, error: 'User session has been revoked' });
      return;
    }
    req.user = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Server misconfiguration' });
  }
}

// ── SSE router (mounted at /api/v1/events) ────────────────────────────────

const sseRouter = Router();

sseRouter.post('/ticket', wrap(authenticate), authenticatedLimiter, wrap(mintSseTicketHandler));
sseRouter.get('/', wrap(authenticateSSE), sseHandler);

// ── Notifications history router (mounted at /api/v1/notifications) ───────

const notificationsRouter = Router();

notificationsRouter.use(wrap(authenticate));
notificationsRouter.use(allRoles);
notificationsRouter.use(authenticatedLimiter);

notificationsRouter.get('/', wrap(listNotificationsHandler));
notificationsRouter.get('/unread-count', wrap(getUnreadCountHandler));
notificationsRouter.patch('/:id/read', wrap(markReadHandler));
notificationsRouter.post('/read-all', wrap(markAllReadHandler));
notificationsRouter.patch('/:id/dismiss', wrap(dismissHandler));

export { sseRouter as notificationsRoutes, notificationsRouter };
