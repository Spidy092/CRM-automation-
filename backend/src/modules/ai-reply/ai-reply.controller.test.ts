import type { Request, Response, NextFunction } from 'express';
import {
  classifyReplyHandler,
  getReplyHistoryHandler,
  triggerReplyClassificationHandler,
} from './ai-reply.controller';
import * as aiReplyService from './ai-reply.service';

jest.mock('./ai-reply.service', () => ({
  classifyInboundReply: jest.fn(),
  getReplyHistory: jest.fn(),
  triggerClassification: jest.fn(),
}));

const validUuid = '019f079c-f429-762a-89ab-d143218efd4e';

function buildRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function buildNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

describe('ai-reply controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('classifyReplyHandler', () => {
    it('forwards service errors to next', async () => {
      const error = new Error('classification failed');
      (aiReplyService.classifyInboundReply as jest.Mock).mockRejectedValueOnce(error);

      const req = {
        body: {
          lead_id: validUuid,
          message: 'I am interested.',
          channel: 'email',
        },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await classifyReplyHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('classifies a valid reply and returns 200', async () => {
      const classification = {
        intent_class: 'interested',
        intent_subtype: 'high',
        confidence: 92,
        draft_response: 'Great, let us schedule a call.',
        next_best_action: 'schedule_call',
        update_stage_to: null,
        objection_type: null,
        buying_signal: 'asked for pricing',
        chain_of_thought: 'The lead is interested.',
        should_stop_sequence: false,
        requires_human_review: false,
      };
      (aiReplyService.classifyInboundReply as jest.Mock).mockResolvedValueOnce(classification);

      const req = {
        body: {
          lead_id: validUuid,
          message: 'I am interested.',
          channel: 'email',
        },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await classifyReplyHandler(req, res, next);

      expect(aiReplyService.classifyInboundReply).toHaveBeenCalledWith({
        leadId: validUuid,
        channel: 'email',
        messageText: 'I am interested.',
        externalMessageId: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: classification,
        }),
      );
    });

    it('returns a validation error for an invalid payload', async () => {
      const req = {
        body: {
          lead_id: 'not-a-uuid',
          message: '',
          channel: 'fax',
        },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await classifyReplyHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = (next as jest.Mock).mock.calls[0][0] as Error;
      expect(err.message).toContain('lead_id');
      expect(err.message).toContain('message');
      expect(err.message).toContain('channel');
    });
  });

  describe('getReplyHistoryHandler', () => {
    it('forwards service errors to next', async () => {
      const error = new Error('history failed');
      (aiReplyService.getReplyHistory as jest.Mock).mockRejectedValueOnce(error);

      const req = {
        query: { lead_id: validUuid },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getReplyHistoryHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('returns a validation error for an invalid query', async () => {
      const req = {
        query: { lead_id: 'not-a-uuid', limit: 'ten' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getReplyHistoryHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = (next as jest.Mock).mock.calls[0][0] as Error;
      expect(err.message).toContain('lead_id');
      expect(err.message).toContain('limit');
    });

    it('returns paginated history', async () => {
      const items = [
        { id: 'd1', lead_id: validUuid, decision: 'interested', confidence: 90 },
        { id: 'd2', lead_id: validUuid, decision: 'objection', confidence: 70 },
      ];
      (aiReplyService.getReplyHistory as jest.Mock).mockResolvedValueOnce({
        items,
        total: 2,
      });

      const req = {
        query: { lead_id: validUuid, limit: '10', offset: '0' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await getReplyHistoryHandler(req, res, next);

      expect(aiReplyService.getReplyHistory).toHaveBeenCalledWith({
        leadId: validUuid,
        campaignId: undefined,
        classification: undefined,
        limit: 10,
        offset: 0,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: items,
          meta: { total: 2, limit: 10, offset: 0 },
        }),
      );
    });
  });

  describe('triggerReplyClassificationHandler', () => {
    it('forwards service errors to next', async () => {
      const error = new Error('trigger failed');
      (aiReplyService.triggerClassification as jest.Mock).mockRejectedValueOnce(error);

      const req = {
        params: { leadId: validUuid },
        body: {},
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await triggerReplyClassificationHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('returns a validation error for an invalid leadId param', async () => {
      const req = {
        params: { leadId: 'not-a-uuid' },
        body: {},
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await triggerReplyClassificationHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = (next as jest.Mock).mock.calls[0][0] as Error;
      expect(err.message).toBe('leadId must be a valid UUID');
    });

    it('returns a validation error for an invalid body', async () => {
      const req = {
        params: { leadId: validUuid },
        body: { channel: 'fax' },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await triggerReplyClassificationHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const err = (next as jest.Mock).mock.calls[0][0] as Error;
      expect(err.message).toContain('channel');
    });

    it('accepts a trigger request and returns 202', async () => {
      (aiReplyService.triggerClassification as jest.Mock).mockResolvedValueOnce(undefined);

      const req = {
        params: { leadId: validUuid },
        body: {
          message: 'Can you tell me more?',
          channel: 'email',
        },
      } as unknown as Request;
      const res = buildRes();
      const next = buildNext();

      await triggerReplyClassificationHandler(req, res, next);

      expect(aiReplyService.triggerClassification).toHaveBeenCalledWith({
        leadId: validUuid,
        channel: 'email',
        messageText: 'Can you tell me more?',
        externalMessageId: undefined,
      });
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { accepted: true },
        }),
      );
    });
  });
});
