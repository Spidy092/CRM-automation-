import { Request, Response, NextFunction } from 'express';
import {
  listCampaignsHandler,
  getCampaignHandler,
  createCampaignHandler,
  updateCampaignHandler,
  deleteCampaignHandler,
  automationPreviewHandler,
  launchCampaignHandler,
  pauseCampaignHandler,
  resumeCampaignHandler,
  addLeadsHandler,
  removeLeadHandler,
  listCampaignLeadsHandler,
  getCampaignStatsHandler,
  getCampaignStepStatsHandler,
  retryLeadOutreachStepHandler,
} from './campaigns.controller';
import * as service from './campaigns.service';
import { ZodError } from 'zod';

jest.mock('./campaigns.service');
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mocked = service as jest.Mocked<typeof service>;

function mockReq(opts: { params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown>; user?: { id: string; role: string } } = {}): Partial<Request> {
  return {
    params: opts.params || {},
    query: opts.query || {},
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
      expect(mocked.getAllCampaigns).toHaveBeenCalledWith({ pipeline_id: undefined });
    });

    it('filters campaigns by pipeline_id query param', async () => {
      mocked.getAllCampaigns.mockResolvedValue([] as never);
      const res = mockRes() as Response;
      await listCampaignsHandler(mockReq({ query: { pipeline_id: 'pipe-1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mocked.getAllCampaigns).toHaveBeenCalledWith({ pipeline_id: 'pipe-1' });
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

  describe('getCampaignStepStatsHandler', () => {
    it('returns 200 with step stats', async () => {
      mocked.getStepStats.mockResolvedValue([
        { step_number: 1, sent: 5, delivered: 4, opened: 3, replied: 1, failed: 0 },
      ] as never);
      const res = mockRes() as Response;
      await getCampaignStepStatsHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.getStepStats.mockRejectedValue(new Error('db'));
      const res = mockRes() as Response;
      await getCampaignStepStatsHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('automationPreviewHandler', () => {
    it('returns 200 with preview', async () => {
      mocked.getCampaignAutomationPreview.mockResolvedValue({
        campaignId: 'c1',
        sequenceId: null,
        firstStep: null,
        eligibleLeads: [],
        skippedLeads: [],
        templateIssues: [],
        connectorIssues: [],
        expectedJobs: 0,
        mockMode: false,
      } as never);
      const res = mockRes() as Response;
      await automationPreviewHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.getCampaignAutomationPreview.mockRejectedValue(new Error('not found'));
      const res = mockRes() as Response;
      await automationPreviewHandler(mockReq({ params: { id: 'c1' } }) as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('retryLeadOutreachStepHandler', () => {
    it('returns 200 with enqueue result', async () => {
      mocked.retryLeadOutreachStep.mockResolvedValue({ enqueued: true } as never);
      const res = mockRes() as Response;
      await retryLeadOutreachStepHandler(
        mockReq({ params: { id: 'c1', leadId: 'l1' } }) as Request,
        res,
        mockNext,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mocked.retryLeadOutreachStep.mockRejectedValue(new Error('no failed send'));
      const res = mockRes() as Response;
      await retryLeadOutreachStepHandler(
        mockReq({ params: { id: 'c1', leadId: 'l1' } }) as Request,
        res,
        mockNext,
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
