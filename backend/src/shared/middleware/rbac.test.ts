import type { NextFunction, Request, Response } from 'express';
import { authorize, adminOnly, managerAndAbove, allRoles } from './rbac';
import { UserRole } from '../types';

function buildMocks(user?: { id: string; role: UserRole }) {
  const req = { user } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('authorize', () => {
  it('returns 401 when no user is present', () => {
    const { req, res, next } = buildMocks();
    authorize('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Unauthorized' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user role is not allowed', () => {
    const { req, res, next } = buildMocks({ id: 'u1', role: 'viewer' });
    authorize('admin', 'manager')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Forbidden: insufficient permissions' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user role is allowed', () => {
    const { req, res, next } = buildMocks({ id: 'u1', role: 'manager' });
    authorize('admin', 'manager')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('works with a single allowed role', () => {
    const allowed = buildMocks({ id: 'u1', role: 'admin' });
    authorize('admin')(allowed.req, allowed.res, allowed.next);
    expect(allowed.next).toHaveBeenCalled();

    const denied = buildMocks({ id: 'u2', role: 'sales' });
    authorize('admin')(denied.req, denied.res, denied.next);
    expect(denied.res.status).toHaveBeenCalledWith(403);
    expect(denied.next).not.toHaveBeenCalled();
  });

  it('works with all roles allowed', () => {
    const roles: UserRole[] = ['admin', 'manager', 'sales', 'marketing', 'viewer'];
    for (const role of roles) {
      const { req, res, next } = buildMocks({ id: 'u1', role });
      authorize(...roles)(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });
});

describe('adminOnly', () => {
  it('allows admin', () => {
    const { req, res, next } = buildMocks({ id: 'u1', role: 'admin' });
    adminOnly(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies non-admin roles', () => {
    const roles: UserRole[] = ['manager', 'sales', 'marketing', 'viewer'];
    for (const role of roles) {
      const { req, res, next } = buildMocks({ id: 'u1', role });
      adminOnly(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
});

describe('managerAndAbove', () => {
  it('allows admin and manager', () => {
    for (const role of ['admin', 'manager'] as UserRole[]) {
      const { req, res, next } = buildMocks({ id: 'u1', role });
      managerAndAbove(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('denies sales, marketing, viewer', () => {
    for (const role of ['sales', 'marketing', 'viewer'] as UserRole[]) {
      const { req, res, next } = buildMocks({ id: 'u1', role });
      managerAndAbove(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });
});

describe('allRoles', () => {
  it('allows all five roles', () => {
    const roles: UserRole[] = ['admin', 'manager', 'sales', 'marketing', 'viewer'];
    for (const role of roles) {
      const { req, res, next } = buildMocks({ id: 'u1', role });
      allRoles(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('returns 401 when no user', () => {
    const { req, res, next } = buildMocks();
    allRoles(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
