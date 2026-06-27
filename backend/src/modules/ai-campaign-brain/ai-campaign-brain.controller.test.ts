import type { Request, Response, NextFunction } from 'express';
import {
  getBrief,
  approveBriefHandler,
  rejectBriefHandler,
} from './ai-campaign-brain.controller';
import * as service from './ai-campaign-brain.service';
import { AppError } from '../../shared/middleware/errorHandler';
import type { CampaignBrief } from './ai-campaign-brain.types';

jest.mock('./ai-campaign-brain.service');

const mockedService = service as jest.Mocked<typeof service>;

const CAMPAIGN_ID = '019f079c-f429-762a-89ab-d143218efd4e';
const USER_ID = 'u-1';

function mockReq(
  query: any = {},
  body: any = {},
  params: any = {},
  user: any = { id: USER_ID, role: 'manager' },
): Request {
  return { query, body, params, user } as unknown as Request;
}

function mockRes(): Response {
  const json = jest.fn();
  return { json } as unknown as Response;
}

const mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

const fakeBrief: CampaignBrief = {
  id: 'brief-1',
  campaign_id: CAMPAIGN_ID,
  total_leads_evaluated: 100,
  eligible_leads: 80,
  high_fit_leads: 30,
  segment_summary: 'SMBs in logistics',
  recommended_offer_angle: 'Save 20% on fleet insurance',
  expected_objections: ['Too expensive'],
  risk_warnings: ['Seasonal demand'],
  recommended_sequence: [
    { step_number: 1, channel: 'email', delay_hours: 0, goal: 'Introduce offer' },
  ],
  template_suggestions: [
    { channel: 'email', subject: 'Fleet insurance offer', body_preview: 'Hi...' },
  ],
  recommended_autonomy_level: 'guarded',
  confidence_score: 85,
  status: 'draft',
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('ai-campaign-brain.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBrief', () => {
    it('returns the campaign brief when it exists', async () => {
      mockedService.getCampaignBrief.mockResolvedValue(fakeBrief);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await getBrief(req, res, mockNext);

      expect(mockedService.getCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_ID);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: fakeBrief,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes a 400 AppError to next for an invalid campaign id', async () => {
      const req = mockReq({}, {}, { campaignId: 'not-a-uuid' });
      const res = mockRes();

      await getBrief(req, res, mockNext);

      expect(mockedService.getCampaignBrief).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });

    it('passes a 404 AppError to next when the brief is not found', async () => {
      mockedService.getCampaignBrief.mockResolvedValue(null);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await getBrief(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain(CAMPAIGN_ID);
    });

    it('passes service errors to next', async () => {
      const error = new Error('db failure');
      mockedService.getCampaignBrief.mockRejectedValue(error);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await getBrief(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('approveBriefHandler', () => {
    it('approves the brief and returns the updated brief', async () => {
      const approved: CampaignBrief = { ...fakeBrief, status: 'approved', approved_by: USER_ID };
      mockedService.approveCampaignBrief.mockResolvedValue(approved);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await approveBriefHandler(req, res, mockNext);

      expect(mockedService.approveCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_ID, USER_ID);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: approved,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes a 400 AppError to next for an invalid campaign id', async () => {
      const req = mockReq({}, {}, { campaignId: 'bad-id' });
      const res = mockRes();

      await approveBriefHandler(req, res, mockNext);

      expect(mockedService.approveCampaignBrief).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });

    it('returns a 404 AppError when the service reports not found', async () => {
      const error = new Error(`Campaign brief not found: ${CAMPAIGN_ID}`);
      mockedService.approveCampaignBrief.mockRejectedValue(error);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await approveBriefHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const nextError = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(nextError).toBeInstanceOf(AppError);
      expect(nextError.statusCode).toBe(404);
      expect(nextError.message).toBe(error.message);
    });

    it('passes other errors through unchanged', async () => {
      const error = new Error('approval failed');
      mockedService.approveCampaignBrief.mockRejectedValue(error);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await approveBriefHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      const nextError = (mockNext as jest.Mock).mock.calls[0][0] as Error;
      expect(nextError).not.toBeInstanceOf(AppError);
    });
  });

  describe('rejectBriefHandler', () => {
    it('rejects the brief and returns the updated brief', async () => {
      const rejected: CampaignBrief = { ...fakeBrief, status: 'rejected' };
      mockedService.rejectCampaignBrief.mockResolvedValue(rejected);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await rejectBriefHandler(req, res, mockNext);

      expect(mockedService.rejectCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_ID);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: rejected,
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes a 400 AppError to next for an invalid campaign id', async () => {
      const req = mockReq({}, {}, { campaignId: 'bad-id' });
      const res = mockRes();

      await rejectBriefHandler(req, res, mockNext);

      expect(mockedService.rejectCampaignBrief).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });

    it('returns a 404 AppError when the service reports not found', async () => {
      const error = new Error(`Campaign brief not found: ${CAMPAIGN_ID}`);
      mockedService.rejectCampaignBrief.mockRejectedValue(error);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await rejectBriefHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const nextError = (mockNext as jest.Mock).mock.calls[0][0] as AppError;
      expect(nextError).toBeInstanceOf(AppError);
      expect(nextError.statusCode).toBe(404);
      expect(nextError.message).toBe(error.message);
    });

    it('passes other errors through unchanged', async () => {
      const error = new Error('rejection failed');
      mockedService.rejectCampaignBrief.mockRejectedValue(error);

      const req = mockReq({}, {}, { campaignId: CAMPAIGN_ID });
      const res = mockRes();

      await rejectBriefHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      const nextError = (mockNext as jest.Mock).mock.calls[0][0] as Error;
      expect(nextError).not.toBeInstanceOf(AppError);
    });
  });
});
