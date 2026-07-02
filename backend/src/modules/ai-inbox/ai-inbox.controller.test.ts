import type { Request, Response, NextFunction } from 'express';
import { getInbox, actionInboxItem } from './ai-inbox.controller';
import * as service from './ai-inbox.service';
import { AppError } from '../../shared/middleware/errorHandler';
import type { AiInboxItem } from './ai-inbox.types';

jest.mock('./ai-inbox.service');

const mockedService = service as jest.Mocked<typeof service>;

function mockReq(
  query: any = {},
  body: any = {},
  params: any = {},
  user: any = { id: 'u-1', role: 'sales' },
): Request {
  return { query, body, params, user } as unknown as Request;
}

function mockRes(): Response {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status } as unknown as Response;
}

const mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

const fakeItem: AiInboxItem = {
  id: 'item-1',
  assigned_to: 'u-1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'approve_response',
  title: 'Approve this draft',
  summary: null,
  urgency_score: 80,
  ai_draft_response: 'Draft reply',
  ai_draft_confidence: 0.9,
  expires_at: null,
  status: 'pending',
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

describe('ai-inbox.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInbox', () => {
    it('returns inbox items with default pagination and no filters', async () => {
      mockedService.listItems.mockResolvedValue({
        items: [fakeItem, { ...fakeItem, id: 'item-2' }, { ...fakeItem, id: 'item-3' }],
        total: 3,
      });

      const req = mockReq();
      const res = mockRes();

      await getInbox(req, res, mockNext);

      expect(mockedService.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_to: 'u-1' }),
      );
      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [fakeItem, { ...fakeItem, id: 'item-2' }, { ...fakeItem, id: 'item-3' }],
        meta: { total: 3, limit: 50, offset: 0 },
      });
    });

    it('passes all filters to the service', async () => {
      mockedService.listItems.mockResolvedValue({ items: [fakeItem], total: 1 });

      const req = mockReq(
        { status: 'pending', item_type: 'urgent_reply', limit: '25', offset: '5' },
        {},
        {},
      );
      const res = mockRes();

      await getInbox(req, res, mockNext);

      expect(mockedService.listItems).toHaveBeenCalledWith({
        assigned_to: 'u-1',
        status: 'pending',
        item_type: 'urgent_reply',
        limit: 25,
        offset: 5,
      });
    });

    it('passes a 400 AppError to next for an invalid status', async () => {
      const req = mockReq({ status: 'invalid_status' });
      const res = mockRes();

      await getInbox(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = (mockNext as jest.Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('status');
    });

    it('passes service errors to next', async () => {
      const error = new Error('boom');
      mockedService.listItems.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();

      await getInbox(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('actionInboxItem', () => {
    it('approves an item and returns the updated item', async () => {
      const approved: AiInboxItem = { ...fakeItem, status: 'actioned', actioned_by: 'u-1' };
      mockedService.actionItem.mockResolvedValue(approved);

      const req = mockReq({}, { action: 'approve' }, { id: 'item-1' });
      const res = mockRes();

      await actionInboxItem(req, res, mockNext);

      expect(mockedService.actionItem).toHaveBeenCalledWith('item-1', 'u-1', 'approve', undefined);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: approved,
      });
    });

    it('snoozes an item with a snoozed_until timestamp', async () => {
      const snoozed: AiInboxItem = {
        ...fakeItem,
        status: 'snoozed',
        snoozed_until: '2026-07-01T10:00:00.000Z',
      };
      mockedService.actionItem.mockResolvedValue(snoozed);

      const req = mockReq(
        {},
        { action: 'snooze', snoozed_until: '2026-07-01T10:00:00.000Z' },
        { id: 'item-1' },
      );
      const res = mockRes();

      await actionInboxItem(req, res, mockNext);

      expect(mockedService.actionItem).toHaveBeenCalledWith(
        'item-1',
        'u-1',
        'snooze',
        '2026-07-01T10:00:00.000Z',
      );
    });

    it('returns a 404 AppError when the service reports not found', async () => {
      const error = new Error('Inbox item not found: item-1');
      mockedService.actionItem.mockRejectedValue(error);

      const req = mockReq({}, { action: 'approve' }, { id: 'item-1' });
      const res = mockRes();

      await actionInboxItem(req, res, mockNext);

      const nextError = mockNext.mock.calls[0][0] as unknown as AppError;
      expect(nextError).toBeInstanceOf(AppError);
      expect(nextError.statusCode).toBe(404);
      expect(nextError.message).toBe('Inbox item not found: item-1');
    });

    it('passes other errors through unchanged', async () => {
      const error = new Error('some other error');
      mockedService.actionItem.mockRejectedValue(error);

      const req = mockReq({}, { action: 'approve' }, { id: 'item-1' });
      const res = mockRes();

      await actionInboxItem(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      const nextError = mockNext.mock.calls[0][0] as unknown as Error;
      expect(nextError).not.toBeInstanceOf(AppError);
    });

    it('passes a 400 AppError to next for an invalid action enum', async () => {
      const req = mockReq({}, { action: 'invalid_action' }, { id: 'item-1' });
      const res = mockRes();

      await actionInboxItem(req, res, mockNext);

      const err = (mockNext as jest.Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
    });
  });
});
