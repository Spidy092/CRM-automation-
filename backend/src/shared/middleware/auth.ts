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

import { validateApiKey } from '../../modules/auth/auth.service';

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.apiKey && typeof req.query.apiKey === 'string') {
    // Allow API key via query string for simpler MCP SSE client integrations (like Claude Web)
    token = req.query.apiKey;
  }

  if (!token) {
    sendError(res, 'Missing or invalid Authorization header or apiKey query parameter', 401);
    return;
  }

  if (token.startsWith('crm_')) {
    try {
      const user = await validateApiKey(token);
      req.user = user;
      next();
    } catch (err: any) {
      sendError(res, err.message || 'Invalid or expired API key', 401);
    }
    return;
  }

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
