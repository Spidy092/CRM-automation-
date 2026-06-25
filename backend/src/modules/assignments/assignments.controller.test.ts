import { Request, Response, NextFunction } from 'express';
import {
  getConfigHandler,
  updateConfigHandler,
  listEligibleUsersHandler,
  manualAssignHandler,
  overrideAssignHandler,
  getUserAssignmentsHandler,
} from './assignments.controller';
import * as service from './assignments.service';
import { ZodError } from 'zod';

jest.mock('./assignments.service');
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mocked = service as jest.Mocked<typeof service>;

function mockReq(opts: { params?: Record<string, string>; body?: Record<string, unknown>; user?: { id: string; role: string } } = {}): Partial<Request> {
  return {
    params: opts.params || {},
    body: opts.body || {},
    user: opts.user || { id: 'admin-1', role: 'admin' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const mockNext = jest.fn() as NextFunction;

describe('assignments.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getConfigHandler', () => {
    it('returns 200 with config', async () => {
      mocked.getConfig.mockResolvedValue({ strategy: 'round_robin' } as never);
      const res = mockRes() as Response;
      await getConfigHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.getConfig.mockRejectedValue(new Error('db'));
      const res = mockRes() as Response;
      await getConfigHandler(mockReq() as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('updateConfigHandler', () => {
    it('returns 200 on success', async () => {
      mocked.updateConfig.mockResolvedValue({ strategy: 'round_robin' } as never);
      const res = mockRes() as Response;
      await updateConfigHandler(
        mockReq({ body: { strategy: 'round_robin' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('accepts empty body (all fields optional)', async () => {
      mocked.updateConfig.mockResolvedValue({} as never);
      const res = mockRes() as Response;
      await updateConfigHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('listEligibleUsersHandler', () => {
    it('returns 200 with users', async () => {
      mocked.getEligibleUsers.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listEligibleUsersHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('manualAssignHandler', () => {
    it('returns 201 with assignment', async () => {
      mocked.assignManually.mockResolvedValue({ lead_id: 'l1', user_id: 'u1' } as never);
      const res = mockRes() as Response;
      await manualAssignHandler(
        mockReq({ body: { lead_id: '550e8400-e29b-41d4-a716-446655440001', user_id: '550e8400-e29b-41d4-a716-446655440002' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await manualAssignHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('overrideAssignHandler', () => {
    it('returns 200 on success', async () => {
      mocked.overrideAssignment.mockResolvedValue({ lead_id: 'l1', new_user_id: 'u2' } as never);
      const res = mockRes() as Response;
      await overrideAssignHandler(
        mockReq({ body: { lead_id: '550e8400-e29b-41d4-a716-446655440001', new_user_id: '550e8400-e29b-41d4-a716-446655440003', reason: 'rebalance' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await overrideAssignHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('getUserAssignmentsHandler', () => {
    it('returns 200 with assignments', async () => {
      mocked.getUserAssignments.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await getUserAssignmentsHandler(mockReq({ params: { userId: 'u1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
