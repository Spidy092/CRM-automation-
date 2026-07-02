import type { Request, Response, NextFunction } from 'express';
import { getHistory, sendMessage } from './chat.controller';
import * as service from './chat.service';
import { AppError } from '../../shared/middleware/errorHandler';
import type { ChatResponse, ChatTurn } from './chat.types';

jest.mock('./chat.service');

const mockedService = service as jest.Mocked<typeof service>;

function mockReq(body: any = {}, params: any = {}, user?: any): Request {
  return {
    body,
    params,
    user: user ?? { id: 'user-1', role: 'admin', email: 'admin@example.com' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function mockRes(): Response {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status } as unknown as Response;
}

const mockNext = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

const fakeTurn: ChatTurn = {
  role: 'assistant',
  content: 'Hello, how can I help?',
  createdAt: '2026-06-29T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chat.controller — sendMessage', () => {
  it('returns 200 on execute_now policy', async () => {
    const response: ChatResponse = {
      conversationId: 'conv-1',
      reply: 'Here is your dashboard',
      action: {
        name: 'report.dashboard',
        policy: { outcome: 'execute_now', reason: 'low risk' },
        agentAction: null,
        result: { totalLeads: 100 },
      },
    };
    mockedService.sendChatMessage.mockResolvedValue(response);

    const req = mockReq({
      conversationId: 'conv-1',
      message: 'show me the dashboard',
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: response });
  });

  it('returns 202 on require_approval policy', async () => {
    const response: ChatResponse = {
      conversationId: 'conv-1',
      reply: 'I prepared the action for approval',
      action: {
        name: 'campaign.launch',
        policy: { outcome: 'require_approval', reason: 'sensitive write', assignTo: 'manager-1' },
        agentAction: null,
        result: undefined,
      },
    };
    mockedService.sendChatMessage.mockResolvedValue(response);

    const req = mockReq({
      conversationId: 'conv-1',
      message: 'launch the summer campaign',
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('returns 400 on invalid body', async () => {
    const req = mockReq({
      conversationId: '',
      message: '',
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    const err = mockNext.mock.calls[0][0] as unknown as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it('returns 400 when message is too long', async () => {
    const req = mockReq({
      conversationId: 'conv-1',
      message: 'a'.repeat(4001),
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    const err = mockNext.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(400);
  });

  it('passes service errors to next', async () => {
    const error = new Error('service boom');
    mockedService.sendChatMessage.mockRejectedValue(error);

    const req = mockReq({
      conversationId: 'conv-1',
      message: 'show leads',
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('forwards actor derived from req.user to service', async () => {
    mockedService.sendChatMessage.mockResolvedValue({
      conversationId: 'conv-1',
      reply: 'ok',
    });

    const req = mockReq({
      conversationId: 'conv-1',
      message: 'list campaigns',
    });
    const res = mockRes();

    await sendMessage(req, res, mockNext);

    const call = mockedService.sendChatMessage.mock.calls[0][0];
    expect(call.actor).toEqual(
      expect.objectContaining({ id: 'user-1', role: 'admin', ipAddress: '127.0.0.1' }),
    );
    expect(call.user).toEqual(expect.objectContaining({ id: 'user-1' }));
  });
});

describe('chat.controller — getHistory', () => {
  it('returns 200 with history items', async () => {
    mockedService.getChatHistory.mockResolvedValue([fakeTurn]);

    const req = mockReq({}, { conversationId: 'conv-1' });
    const res = mockRes();

    await getHistory(req, res, mockNext);

    expect(mockedService.getChatHistory).toHaveBeenCalledWith('conv-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [fakeTurn] });
  });

  it('returns 400 on missing conversationId', async () => {
    const req = mockReq({}, {});
    const res = mockRes();

    await getHistory(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    const err = mockNext.mock.calls[0][0] as unknown as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it('passes service errors to next', async () => {
    const error = new Error('redis down');
    mockedService.getChatHistory.mockRejectedValue(error);

    const req = mockReq({}, { conversationId: 'conv-1' });
    const res = mockRes();

    await getHistory(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});
