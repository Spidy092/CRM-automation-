import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedUser } from '../types';
import { sendError } from '../utils/response';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 'Missing or invalid Authorization header', 401);
    return;
  }

  const token = authHeader.slice(7);
  const publicKey = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');

  if (!publicKey) {
    sendError(res, 'Server misconfiguration: JWT public key not set', 500);
    return;
  }

  try {
    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as AuthenticatedUser & {
      iat: number;
      exp: number;
    };
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendError(res, 'Token expired', 401);
    } else {
      sendError(res, 'Invalid token', 401);
    }
  }
}
