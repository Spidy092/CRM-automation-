import type { Request, Response, NextFunction } from 'express';
import {
  getLeadProfile,
  getLeadDecisionLog,
  getDecisionLog,
} from './ai-intelligence.controller';
import * as service from './ai-intelligence.service';
import { AppError } from '../../shared/middleware/errorHandler';
import type { LeadAiProfileRow, AiDecisionLogRow } from './ai-intelligence.types';

jest.mock('./ai-intelligence.service');

const mockedService = service as jest.Mocked<typeof service>;

const validUuid = '019f079c-f429-762a-89ab-d143218efd4e';

function buildRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function buildNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

const fakeProfile: LeadAiProfileRow = {
  id: 'profile-1',
  lead_id: validUuid,
  website_quality_score: 75,
  pain_points: ['slow response times', 'no online booking'],
  offer_angle: 'AI-powered booking assistant',
  inferred_budget_range: 'medium',
  buying_intent: 'high',
  reachability_score: 80,
  buying_signals: [],
  objection_log: [],
  do_not_say: [],
  preferred_channel: 'email',
  preferred_time_of_day: null,
  conversation_summary: null,
  ai_notes: 'Strong web presence but weak conversion tooling.',
  next_best_action: 'send_email',
  next_best_action_reason: 'Email is the preferred channel and intent is high.',
  next_best_action_confidence: 85,
  enrichment_status: 'done',
  last_enriched_at: '2026-06-26T10:00:00.000Z',
  created_at: '2026-06-26T09:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

const fakeDecisionLog: AiDecisionLogRow[] = [
  {
    id: 'd1',
    lead_id: validUuid,
    campaign_id: null,
    decision_type: 'research',
    input_context: { business_name: 'Acme Inc' },
    chain_of_thought: 'Context → Options → Reasoning → Decision → Confidence',
    decision: 'send_email',
    confidence: 85,
    tokens_used: 120,
    latency_ms: 1500,
    model_used: 'gpt-4o-mini',
    autonomy_level: null,
    human_approval_required: false,
    human_approved_by: null,
    human_approved_at: null,
    created_at: '2026-06-26T10:00:00.000Z',
  },
];

describe('ai-intelligence controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeadProfile', () => {
    it('returns a 200 response with the AI profile', async () => {
      mockedService.getAiProfile.mockResolvedValueOnce(fakeProfile);

      const req = { params: { leadId: validUuid } } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadProfile(req, res, next);

      expect(mockedService.getAiProfile).toHaveBeenCalledWith(validUuid);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: fakeProfile,
        }),
      );
    });

    it('returns a 404 AppError when the profile is not found', async () => {
      mockedService.getAiProfile.mockResolvedValueOnce(null);

      const req = { params: { leadId: validUuid } } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadProfile(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain(validUuid);
    });

    it('returns a 400 AppError for an invalid leadId param', async () => {
      const req = { params: { leadId: 'not-a-uuid' } } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadProfile(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('leadId');
    });

    it('forwards service errors to next', async () => {
      const error = new Error('profile lookup failed');
      mockedService.getAiProfile.mockRejectedValueOnce(error);

      const req = { params: { leadId: validUuid } } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getLeadDecisionLog', () => {
    it('returns a 200 response with paginated decision log entries', async () => {
      mockedService.getLeadDecisions.mockResolvedValueOnce({
        items: fakeDecisionLog,
        total: 1,
      });

      const req = {
        params: { leadId: validUuid },
        query: { limit: '10', offset: '0' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadDecisionLog(req, res, next);

      expect(mockedService.getLeadDecisions).toHaveBeenCalledWith(validUuid, 10, 0);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: fakeDecisionLog,
          meta: { total: 1, limit: 10, offset: 0 },
        }),
      );
    });

    it('uses default pagination when query params are omitted', async () => {
      mockedService.getLeadDecisions.mockResolvedValueOnce({
        items: fakeDecisionLog,
        total: 1,
      });

      const req = {
        params: { leadId: validUuid },
        query: {},
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadDecisionLog(req, res, next);

      expect(mockedService.getLeadDecisions).toHaveBeenCalledWith(validUuid, 20, 0);
    });

    it('returns a 400 AppError for an invalid leadId param', async () => {
      const req = {
        params: { leadId: 'not-a-uuid' },
        query: {},
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('leadId');
    });

    it('returns a 400 AppError for invalid pagination', async () => {
      const req = {
        params: { leadId: validUuid },
        query: { limit: '-5', offset: 'bad' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });

    it('forwards service errors to next', async () => {
      const error = new Error('decision log lookup failed');
      mockedService.getLeadDecisions.mockRejectedValueOnce(error);

      const req = {
        params: { leadId: validUuid },
        query: {},
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getLeadDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getDecisionLog', () => {
    it('returns a 200 response with paginated decision log entries', async () => {
      mockedService.getDecisions.mockResolvedValueOnce({
        items: fakeDecisionLog,
        total: 1,
      });

      const req = {
        query: { decision_type: 'research', limit: '25', offset: '5' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getDecisionLog(req, res, next);

      expect(mockedService.getDecisions).toHaveBeenCalledWith({
        decisionType: 'research',
        limit: 25,
        offset: 5,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: fakeDecisionLog,
          meta: { total: 1, limit: 25, offset: 5 },
        }),
      );
    });

    it('uses default pagination and no decision_type filter when omitted', async () => {
      mockedService.getDecisions.mockResolvedValueOnce({
        items: fakeDecisionLog,
        total: 1,
      });

      const req = { query: {} } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getDecisionLog(req, res, next);

      expect(mockedService.getDecisions).toHaveBeenCalledWith({
        decisionType: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('returns a 400 AppError for an invalid decision_type', async () => {
      const req = {
        query: { decision_type: 'invalid_type' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('decision_type');
    });

    it('returns a 400 AppError for invalid pagination', async () => {
      const req = {
        query: { limit: '0', offset: '-1' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as jest.Mock).mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });

    it('forwards service errors to next', async () => {
      const error = new Error('admin decision log lookup failed');
      mockedService.getDecisions.mockRejectedValueOnce(error);

      const req = { query: {} } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getDecisionLog(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
