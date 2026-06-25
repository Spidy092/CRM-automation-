import { Request, Response, NextFunction } from 'express';
import {
  createUserHandler,
  listUsersHandler,
  getUserHandler,
  updateProfileHandler,
} from './users.controller';
import * as usersService from './users.service';
import { ZodError } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('./users.service');
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mocked = usersService as jest.Mocked<typeof usersService>;

function mockReq(opts: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  user?: { id: string; role: string } | undefined;
} = {}): Partial<Request> {
  return {
    params: opts.params || {},
    body: opts.body || {},
    user: opts.user === undefined ? { id: 'admin-1', role: 'admin' } : opts.user,
  } as unknown as Request;
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const mockNext = jest.fn() as unknown as NextFunction;

const sampleUser = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@crm.com',
  role: 'sales',
  is_active: true,
  created_at: new Date('2025-01-01T00:00:00Z'),
};

describe('users.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createUserHandler', () => {
    const validBody = {
      name: 'Alice',
      email: 'alice@crm.com',
      password: 'Strong1Pass',
      role: 'sales',
      is_active: true,
    };

    it('returns 201 on successful create', async () => {
      mocked.createUser.mockResolvedValue(sampleUser);
      const res = mockRes() as Response;
      await createUserHandler(mockReq({ body: validBody }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes validation errors to next (ZodError)', async () => {
      const res = mockRes() as Response;
      await createUserHandler(
        mockReq({ body: { name: '', email: 'not-an-email', password: 'short' } }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes duplicate-email (409) errors to next', async () => {
      mocked.createUser.mockRejectedValue(new AppError('A user with this email already exists', 409));
      const res = mockRes() as Response;
      await createUserHandler(mockReq({ body: validBody }) as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('listUsersHandler', () => {
    it('returns 200 with the list of users', async () => {
      mocked.listUsers.mockResolvedValue([sampleUser]);
      const res = mockRes() as Response;
      await listUsersHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: [sampleUser] }),
      );
    });

    it('returns 200 with empty array when no users exist', async () => {
      mocked.listUsers.mockResolvedValue([]);
      const res = mockRes() as Response;
      await listUsersHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes service errors to next', async () => {
      mocked.listUsers.mockRejectedValue(new Error('db down'));
      const res = mockRes() as Response;
      await listUsersHandler(mockReq() as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('getUserHandler', () => {
    it('returns 200 with the requested user', async () => {
      mocked.getUser.mockResolvedValue(sampleUser);
      const res = mockRes() as Response;
      await getUserHandler(mockReq({ params: { id: 'user-1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: sampleUser }),
      );
    });

    it('returns 401 when req.user is missing', async () => {
      const res = mockRes() as Response;
      await getUserHandler(
        mockReq({ params: { id: 'user-1' }, user: undefined }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
      expect(mocked.getUser).not.toHaveBeenCalled();
    });

    it('passes forbidden (403) errors to next', async () => {
      mocked.getUser.mockRejectedValue(new AppError('Forbidden', 403));
      const res = mockRes() as Response;
      await getUserHandler(
        mockReq({ params: { id: 'other' }, user: { id: 'sales-1', role: 'sales' } }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('passes not-found (404) errors to next', async () => {
      mocked.getUser.mockRejectedValue(new AppError('User not found', 404));
      const res = mockRes() as Response;
      await getUserHandler(mockReq({ params: { id: 'missing' } }) as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('updateProfileHandler', () => {
    it('returns 200 with the updated profile', async () => {
      mocked.updateProfile.mockResolvedValue({ ...sampleUser, name: 'Alice2' });
      const res = mockRes() as Response;
      await updateProfileHandler(
        mockReq({ params: { id: 'user-1' }, body: { name: 'Alice2' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Alice2' }) }),
      );
    });

    it('returns 401 when req.user is missing', async () => {
      const res = mockRes() as Response;
      await updateProfileHandler(
        mockReq({
          params: { id: 'user-1' },
          body: { name: 'X' },
          user: undefined,
        }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
      expect(mocked.updateProfile).not.toHaveBeenCalled();
    });

    it('passes validation errors (empty name) to next', async () => {
      const res = mockRes() as Response;
      await updateProfileHandler(
        mockReq({ params: { id: 'user-1' }, body: { name: '' } }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
      expect(mocked.updateProfile).not.toHaveBeenCalled();
    });

    it('passes forbidden (403) errors to next', async () => {
      mocked.updateProfile.mockRejectedValue(new AppError('Forbidden', 403));
      const res = mockRes() as Response;
      await updateProfileHandler(
        mockReq({
          params: { id: 'other' },
          body: { name: 'X' },
          user: { id: 'sales-1', role: 'sales' },
        }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('passes not-found (404) errors to next', async () => {
      mocked.updateProfile.mockRejectedValue(new AppError('User not found', 404));
      const res = mockRes() as Response;
      await updateProfileHandler(
        mockReq({ params: { id: 'missing' }, body: { name: 'X' } }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    });
  });
});
