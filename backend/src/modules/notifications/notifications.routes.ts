import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from '../../shared/types';
import { authenticate } from '../../shared/middleware/auth';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { wrap } from '../../shared/utils/asyncHandler';
import { sseHandler, mintSseTicketHandler, consumeSseTicket } from './notifications.controller';

const router = Router();

/**
 * SSE endpoints cannot send custom headers (EventSource API limitation).
 * Preferred path: a single-use, 30s ticket minted via POST /ticket (never
 * logged/reused). Bearer header still works for non-browser clients. A raw
 * `?token=` JWT is intentionally NOT accepted here — it would sit in access
 * logs/browser history for the life of the token instead of 30 seconds.
 */
function authenticateSSE(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const ticket = req.query.ticket as string | undefined;

  if (ticket) {
    consumeSseTicket(ticket)
      .then((user) => {
        if (!user) {
          res.status(401).json({ success: false, error: 'Invalid or expired ticket' });
          return;
        }
        req.user = user;
        next();
      })
      .catch(() => {
        res.status(500).json({ success: false, error: 'Server misconfiguration' });
      });
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

  try {
    const payload = jwt.verify(bearerToken, publicKey, {
      algorithms: ['RS256'],
    }) as AuthenticatedUser & {
      iat: number;
      exp: number;
    };
    req.user = { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

router.post('/ticket', authenticate, authenticatedLimiter, wrap(mintSseTicketHandler));
router.get('/', authenticateSSE, sseHandler);

export { router as notificationsRoutes };
