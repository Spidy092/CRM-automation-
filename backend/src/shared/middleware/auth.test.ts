import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from './auth';
import { sendError } from '../utils/response';

jest.mock('jsonwebtoken', () => {
  const actual = jest.requireActual('jsonwebtoken');
  return {
    ...actual,
    verify: jest.fn(),
    sign: jest.fn(),
  };
});
jest.mock('../utils/response', () => ({
  sendError: jest.fn(),
  sendSuccess: jest.fn(),
}));

describe('authenticate', () => {
  const OLD_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;

  function buildReq(authHeader?: string): Partial<Request> {
    return {
      headers: { authorization: authHeader },
    } as unknown as Request;
  }

  function buildRes(): Partial<Response> {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnThis();
    res.json = jest.fn().mockReturnThis();
    return res;
  }

  const next = jest.fn() as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_PUBLIC_KEY = 'public-key';
  });

  afterEach(() => {
    process.env.JWT_PUBLIC_KEY = OLD_PUBLIC_KEY;
  });

  it('returns 401 when auth header is missing', () => {
    const req = buildReq(undefined) as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Missing or invalid Authorization header',
      401,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when auth header does not start with Bearer ', () => {
    const req = buildReq('Basic abc') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Missing or invalid Authorization header',
      401,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT_PUBLIC_KEY is not set', () => {
    delete process.env.JWT_PUBLIC_KEY;
    const req = buildReq('Bearer token') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Server misconfiguration: JWT public key not set',
      500,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next for a valid RS256 token', () => {
    const payload = {
      id: 'u1',
      email: 'a@b.com',
      role: 'admin',
      name: 'Admin',
      iat: 1,
      exp: 2,
    };
    (jwt.verify as jest.Mock).mockReturnValue(payload);
    const req = buildReq('Bearer valid-token') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'public-key', {
      algorithms: ['RS256'],
    });
    expect((req as any).user).toEqual({
      id: 'u1',
      email: 'a@b.com',
      role: 'admin',
      name: 'Admin',
    });
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for expired token (TokenExpiredError)', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });
    const req = buildReq('Bearer expired-token') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Token expired', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid signature', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const req = buildReq('Bearer bad-token') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid token', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for malformed token', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('jwt malformed');
    });
    const req = buildReq('Bearer malformed') as Request;
    const res = buildRes() as Response;
    authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid token', 401);
    expect(next).not.toHaveBeenCalled();
  });
});
