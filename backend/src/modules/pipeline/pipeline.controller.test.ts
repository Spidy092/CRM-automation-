import { Request, Response, NextFunction } from 'express';
import {
  listPipelinesHandler,
  getPipelineHandler,
  createPipelineHandler,
  updatePipelineHandler,
  deletePipelineHandler,
  listStagesHandler,
  createStageHandler,
  updateStageHandler,
  deleteStageHandler,
  moveLeadHandler,
} from './pipeline.controller';
import * as service from './pipeline.service';
import { ZodError } from 'zod';

jest.mock('./pipeline.service');
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

describe('pipeline.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listPipelinesHandler', () => {
    it('returns 200 with pipelines', async () => {
      mocked.getAllPipelines.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listPipelinesHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.getAllPipelines.mockRejectedValue(new Error('db'));
      const res = mockRes() as Response;
      await listPipelinesHandler(mockReq() as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getPipelineHandler', () => {
    it('returns 200 with pipeline', async () => {
      mocked.getPipelineById.mockResolvedValue({ id: 'p1' } as never);
      const res = mockRes() as Response;
      await getPipelineHandler(mockReq({ params: { id: 'p1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createPipelineHandler', () => {
    it('returns 201 with created pipeline', async () => {
      mocked.createPipeline.mockResolvedValue({ id: 'p1' } as never);
      const res = mockRes() as Response;
      await createPipelineHandler(
        mockReq({ body: { name: 'Sales', stages: [{ name: 'New', position: 0 }] } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await createPipelineHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('updatePipelineHandler', () => {
    it('returns 200 on success', async () => {
      mocked.updatePipelineById.mockResolvedValue({ id: 'p1' } as never);
      const res = mockRes() as Response;
      await updatePipelineHandler(
        mockReq({ params: { id: 'p1' }, body: { name: 'Updated' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deletePipelineHandler', () => {
    it('returns 204 on success', async () => {
      mocked.deletePipelineById.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await deletePipelineHandler(mockReq({ params: { id: 'p1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('listStagesHandler', () => {
    it('returns 200 with stages', async () => {
      mocked.getStages.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listStagesHandler(mockReq({ params: { pipelineId: 'p1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createStageHandler', () => {
    it('returns 201 with stage', async () => {
      mocked.createStage.mockResolvedValue({ id: 's1' } as never);
      const res = mockRes() as Response;
      await createStageHandler(
        mockReq({ params: { pipelineId: 'p1' }, body: { name: 'Proposal', position: 1 } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('updateStageHandler', () => {
    it('returns 200 on success', async () => {
      mocked.updateStageById.mockResolvedValue({ id: 's1' } as never);
      const res = mockRes() as Response;
      await updateStageHandler(
        mockReq({ params: { id: 's1' }, body: { name: 'Renamed' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteStageHandler', () => {
    it('returns 204 on success', async () => {
      mocked.deleteStageById.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await deleteStageHandler(mockReq({ params: { id: 's1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('moveLeadHandler', () => {
    it('returns 200 on success', async () => {
      mocked.moveLead.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await moveLeadHandler(
        mockReq({ body: { lead_id: '550e8400-e29b-41d4-a716-446655440001', stage_id: '550e8400-e29b-41d4-a716-446655440002' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await moveLeadHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });
});
