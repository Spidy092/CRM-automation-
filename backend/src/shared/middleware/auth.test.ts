import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from './auth';
import { sendError } from '../utils/response';
import { validateApiKey } from '../../modules/auth/auth.service';

jest.mock('jsonwebtoken', () => {
  class TokenExpiredError extends Error {
    expiredAt: Date;
    constructor(message: string, expiredAt: Date) {
      super(message);
      this.name = 'TokenExpiredError';
      this.expiredAt = expiredAt;
    }
  }

  return {
    verify: jest.fn(),
    sign: jest.fn(),
    TokenExpiredError,
  };
});
jest.mock('../utils/response', () => ({
  sendError: jest.fn(),
  sendSuccess: jest.fn(),
}));
jest.mock('../../modules/auth/auth.service', () => ({
  validateApiKey: jest.fn(),
}));

describe('authenticate', () => {
  const OLD_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;

  function buildReq(authHeader?: string, query: Record<string, unknown> = {}): Partial<Request> {
    return {
      headers: { authorization: authHeader },
      query,
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

  it('returns 401 when auth header and apiKey query param are both missing', async () => {
    const req = buildReq(undefined) as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Missing or invalid Authorization header or apiKey query parameter',
      401,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when auth header does not start with Bearer ', async () => {
    const req = buildReq('Basic abc') as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Missing or invalid Authorization header or apiKey query parameter',
      401,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT_PUBLIC_KEY is not set', async () => {
    delete process.env.JWT_PUBLIC_KEY;
    const req = buildReq('Bearer token') as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Server misconfiguration: JWT public key not set',
      500,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next for a valid RS256 token', async () => {
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
    await authenticate(req, res, next);
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

  it('returns 401 for expired token (TokenExpiredError)', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new jwt.TokenExpiredError('jwt expired', new Date());
    });
    const req = buildReq('Bearer expired-token') as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Token expired', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid signature', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const req = buildReq('Bearer bad-token') as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid token', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for malformed token', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('jwt malformed');
    });
    const req = buildReq('Bearer malformed') as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid token', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next for a valid crm_ API key', async () => {
    const identity = { id: 'u1', email: 'a@b.com', role: 'admin', name: 'Admin' };
    (validateApiKey as jest.Mock).mockResolvedValue(identity);
    const req = buildReq(undefined, { apiKey: 'crm_validkey' }) as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(validateApiKey).toHaveBeenCalledWith('crm_validkey');
    expect((req as any).user).toEqual(identity);
    expect(next).toHaveBeenCalled();
  });

  it('prefers the Bearer header over the apiKey query param when both are present', async () => {
    const payload = { id: 'u2', email: 'c@d.com', role: 'sales', name: 'Sales Rep', iat: 1, exp: 2 };
    (jwt.verify as jest.Mock).mockReturnValue(payload);
    const req = buildReq('Bearer valid-token', { apiKey: 'crm_ignored' }) as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(jwt.verify).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 with the error message when the API key is invalid', async () => {
    (validateApiKey as jest.Mock).mockRejectedValue(new Error('Invalid API key'));
    const req = buildReq(undefined, { apiKey: 'crm_badkey' }) as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid API key', 401);
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the API key error has no message', async () => {
    (validateApiKey as jest.Mock).mockRejectedValue({});
    const req = buildReq(undefined, { apiKey: 'crm_badkey' }) as Request;
    const res = buildRes() as Response;
    await authenticate(req, res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Invalid or expired API key', 401);
    expect(next).not.toHaveBeenCalled();
  });
});
