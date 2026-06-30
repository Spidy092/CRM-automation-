import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from '../../shared/types';
import { sseHandler } from './notifications.controller';

const router = Router();

/**
 * SSE endpoints cannot send custom headers (EventSource API limitation), so
 * we accept the JWT either as a Bearer Authorization header or as a `?token=`
 * query-string parameter. Both paths use the same RS256 verification logic.
 */
function authenticateSSE(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token as string | undefined);

  if (!rawToken) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const publicKey = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!publicKey) {
    res.status(500).json({ success: false, error: 'Server misconfiguration' });
    return;
  }

  try {
    const payload = jwt.verify(rawToken, publicKey, {
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

router.get('/', authenticateSSE, sseHandler);

export { router as notificationsRoutes };
