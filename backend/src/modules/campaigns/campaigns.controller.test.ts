import { Request, Response, NextFunction } from 'express';
import {
  listCampaignsHandler,
  getCampaignHandler,
  createCampaignHandler,
  updateCampaignHandler,
  deleteCampaignHandler,
  launchCampaignHandler,
  pauseCampaignHandler,
  resumeCampaignHandler,
  addLeadsHandler,
  removeLeadHandler,
  listCampaignLeadsHandler,
  getCampaignStatsHandler,
} from './campaigns.controller';
import * as service from './campaigns.service';
import { ZodError } from 'zod';

jest.mock('./campaigns.service');
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

describe('campaigns.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listCampaignsHandler', () => {
    it('returns 200 with campaigns', async () => {
      mocked.getAllCampaigns.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listCampaignsHandler(mockReq() as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.getAllCampaigns.mockRejectedValue(new Error('db'));
      const res = mockRes() as Response;
      await listCampaignsHandler(mockReq() as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getCampaignHandler', () => {
    it('returns 200 with campaign', async () => {
      mocked.getCampaignById.mockResolvedValue({ id: 'c1' } as never);
      const res = mockRes() as Response;
      await getCampaignHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createCampaignHandler', () => {
    it('returns 201 with created campaign', async () => {
      mocked.createCampaign.mockResolvedValue({ id: 'c1' } as never);
      const res = mockRes() as Response;
      await createCampaignHandler(
        mockReq({ body: { name: 'Q3 Outreach', type: 'email' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await createCampaignHandler(mockReq({ body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('updateCampaignHandler', () => {
    it('returns 200 on success', async () => {
      mocked.updateCampaignById.mockResolvedValue({ id: 'c1' } as never);
      const res = mockRes() as Response;
      await updateCampaignHandler(
        mockReq({ params: { id: 'c1' }, body: { name: 'Updated' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteCampaignHandler', () => {
    it('returns 204 on success', async () => {
      mocked.deleteCampaignById.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await deleteCampaignHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('launchCampaignHandler', () => {
    it('returns 200 on success', async () => {
      mocked.launchCampaignById.mockResolvedValue({ id: 'c1', status: 'active' } as never);
      const res = mockRes() as Response;
      await launchCampaignHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('pauseCampaignHandler', () => {
    it('returns 200 on success', async () => {
      mocked.pauseCampaignById.mockResolvedValue({ id: 'c1', status: 'paused' } as never);
      const res = mockRes() as Response;
      await pauseCampaignHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('resumeCampaignHandler', () => {
    it('returns 200 on success', async () => {
      mocked.resumeCampaignById.mockResolvedValue({ id: 'c1', status: 'active' } as never);
      const res = mockRes() as Response;
      await resumeCampaignHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('addLeadsHandler', () => {
    it('returns 200 with result', async () => {
      mocked.addLeads.mockResolvedValue({ added: 5 } as never);
      const res = mockRes() as Response;
      await addLeadsHandler(
        mockReq({ params: { id: 'c1' }, body: { lead_ids: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'] } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes validation errors to next', async () => {
      const res = mockRes() as Response;
      await addLeadsHandler(mockReq({ params: { id: 'c1' }, body: {} }) as Request, res, mockNext);
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('removeLeadHandler', () => {
    it('returns 204 on success', async () => {
      mocked.removeLead.mockResolvedValue(undefined);
      const res = mockRes() as Response;
      await removeLeadHandler(
        mockReq({ params: { id: 'c1', leadId: 'l1' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('listCampaignLeadsHandler', () => {
    it('returns 200 with lead ids', async () => {
      mocked.getCampaignLeads.mockResolvedValue(['l1', 'l2'] as never);
      const res = mockRes() as Response;
      await listCampaignLeadsHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getCampaignStatsHandler', () => {
    it('returns 200 with stats', async () => {
      mocked.getStats.mockResolvedValue({ total: 100, sent: 80 } as never);
      const res = mockRes() as Response;
      await getCampaignStatsHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
