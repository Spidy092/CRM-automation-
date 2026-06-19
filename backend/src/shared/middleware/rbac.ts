import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { sendError } from '../utils/response';

/**
 * SECURITY-CRITICAL: Requires security review before any changes.
 * Enforces role-based access control on every protected route.
 */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Unauthorized', 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendError(res, 'Forbidden: insufficient permissions', 403);
      return;
    }

    next();
  };
}

/** Convenience: admin only */
export const adminOnly = authorize('admin');

/** Convenience: admin or manager */
export const managerAndAbove = authorize('admin', 'manager');

/** Convenience: all authenticated roles */
export const allRoles = authorize('admin', 'manager', 'sales', 'marketing', 'viewer');
