import { Request, Response, NextFunction } from 'express';
import {
  getConfigHandler,
  updateConfigHandler,
  listRulesHandler,
  getRuleHandler,
  createRuleHandler,
  updateRuleHandler,
  deleteRuleHandler,
  calculateScoreHandler,
  recalculateAllHandler,
} from './scoring.controller';
import * as service from './scoring.service';
import { ZodError } from 'zod';

jest.mock('./scoring.service');
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
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const mockNext = jest.fn() as NextFunction;

describe('scoring.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getConfigHandler', () => {
    it('returns 200 with config', async () => {
      mocked.getConfig.mockResolvedValue({ hot_threshold: 80 } as never);
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
      mocked.updateConfig.mockResolvedValue({ hot_threshold: 90 } as never);
      const res = mockRes() as Response;
      await updateConfigHandler(
        mockReq({ body: { hot_threshold: 90 } }) as Request,
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

  describe('listRulesHandler', () => {
    it('returns 200 with rules', async () => {
      mocked.getAllRules.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listRulesHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getRuleHandler', () => {
    it('returns 200 with rule', async () => {
      mocked.getRuleById.mockResolvedValue({ id: 'r1' } as never);
      const res = mockRes() as Response;
      await getRuleHandler(mockReq({ params: { id: 'r1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createRuleHandler', () => {
    it('returns 201 with created rule', async () => {
      mocked.createRule.mockResolvedValue({ id: 'r1' } as never);
      const res = mockRes() as Response;
      await createRuleHandler(
        mockReq({ body: { factor: 'google_rating', weight: 10, condition: { operator: 'gte', value: 4 }, score_value: 10 } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await createRuleHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('updateRuleHandler', () => {
    it('returns 200 on success', async () => {
      mocked.updateRuleById.mockResolvedValue({ id: 'r1' } as never);
      const res = mockRes() as Response;
      await updateRuleHandler(
        mockReq({ params: { id: 'r1' }, body: { points: 20 } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteRuleHandler', () => {
    it('returns 204 on success', async () => {
      mocked.deleteRuleById.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await deleteRuleHandler(mockReq({ params: { id: 'r1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('calculateScoreHandler', () => {
    it('returns 200 with score', async () => {
      mocked.calculateLeadScore.mockResolvedValue({ score: 75, classification: 'warm' } as never);
      const res = mockRes() as Response;
      await calculateScoreHandler(mockReq({ params: { leadId: 'l1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('recalculateAllHandler', () => {
    it('returns 200 with result', async () => {
      mocked.recalculateAllScores.mockResolvedValue({ updated: 10 } as never);
      const res = mockRes() as Response;
      await recalculateAllHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
