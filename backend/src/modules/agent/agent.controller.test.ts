import type { Request, Response, NextFunction } from 'express';
import { executeAction, proposeAction, rejectAction } from './agent.controller';
import * as service from './agent.service';
import { AppError } from '../../shared/middleware/errorHandler';
import type { AgentActionRow } from './agent.types';

jest.mock('./agent.service');

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

const baseRow: AgentActionRow = {
  id: 'action-1',
  source: 'chat',
  action_name: 'lead.list',
  action_args: {},
  risk_tier: 'read',
  status: 'proposed',
  requested_by: 'user-1',
  requester_role: 'admin',
  requester_email: 'admin@example.com',
  requester_name: 'Admin User',
  approved_by: null,
  lead_id: null,
  campaign_id: null,
  confidence: null,
  autonomy_level: null,
  idempotency_key: 'agent:abc',
  result: null,
  error_message: null,
  source_message: null,
  expires_at: null,
  executed_at: null,
  created_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('agent.controller — proposeAction', () => {
  it('returns 200 with successResponse on execute_now policy', async () => {
    mockedService.proposeAgentAction.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'low risk' },
      action: baseRow,
      result: { items: [] },
    });

    const req = mockReq({
      source: 'chat',
      actionName: 'lead.list',
      args: { limit: 25 },
      actor: null,
    });
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    expect(mockedService.proposeAgentAction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ policy: expect.objectContaining({ outcome: 'execute_now' }) }),
    });
  });

  it('returns 202 when policy outcome is require_approval', async () => {
    const pendingRow: AgentActionRow = { ...baseRow, status: 'pending_approval' };
    mockedService.proposeAgentAction.mockResolvedValue({
      policy: { outcome: 'require_approval', reason: 'sensitive write', assignTo: 'manager-1' },
      action: pendingRow,
    });

    const req = mockReq({
      source: 'chat',
      actionName: 'campaign.launch',
      args: { id: '11111111-1111-4111-8111-111111111111' },
      actor: null,
    });
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('uses actor from req.user when present', async () => {
    mockedService.proposeAgentAction.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'low risk' },
      action: baseRow,
    });

    const req = mockReq({
      source: 'chat',
      actionName: 'lead.list',
      args: {},
      actor: null,
    });
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    const call = mockedService.proposeAgentAction.mock.calls[0][0];
    expect(call.actor).toEqual(
      expect.objectContaining({ id: 'user-1', role: 'admin', ipAddress: '127.0.0.1' }),
    );
  });

  it('falls back to body.actor when req.user is missing', async () => {
    mockedService.proposeAgentAction.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'low risk' },
      action: baseRow,
    });

    const bodyActor = { id: '11111111-1111-4111-8111-111111111111', role: 'manager' };
    const req = mockReq({
      source: 'event',
      actionName: 'lead.list',
      args: {},
      actor: bodyActor,
    });
    req.user = undefined as any;
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    const call = mockedService.proposeAgentAction.mock.calls[0][0];
    expect(call.actor).toEqual(bodyActor);
  });

  it('returns 400 AppError when body schema is invalid', async () => {
    const req = mockReq({
      source: 'invalid_source',
      actionName: 'lead.list',
      args: {},
      actor: null,
    });
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    const err = mockNext.mock.calls[0][0] as unknown as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it('passes service errors to next', async () => {
    const error = new Error('proposal failed');
    mockedService.proposeAgentAction.mockRejectedValue(error);

    const req = mockReq({
      source: 'chat',
      actionName: 'lead.list',
      args: {},
      actor: null,
    });
    const res = mockRes();

    await proposeAction(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

describe('agent.controller — executeAction', () => {
  it('returns 200 with executed action', async () => {
    const executedRow: AgentActionRow = { ...baseRow, status: 'succeeded' };
    mockedService.executeAgentAction.mockResolvedValue(executedRow);

    const req = mockReq({}, { id: 'action-1' });
    const res = mockRes();

    await executeAction(req, res, mockNext);

    expect(mockedService.executeAgentAction).toHaveBeenCalledWith('action-1', {
      actor: expect.objectContaining({ id: 'user-1' }),
      approvedBy: 'user-1',
      source: 'manual',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: executedRow });
  });

  it('passes service errors to next', async () => {
    const error = new Error('not found');
    mockedService.executeAgentAction.mockRejectedValue(error);

    const req = mockReq({}, { id: 'missing' });
    const res = mockRes();

    await executeAction(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});

describe('agent.controller — rejectAction', () => {
  it('returns 200 with rejected action', async () => {
    const rejectedRow: AgentActionRow = { ...baseRow, status: 'rejected' };
    mockedService.rejectAgentAction.mockResolvedValue(rejectedRow);

    const req = mockReq({}, { id: 'action-1' });
    const res = mockRes();

    await rejectAction(req, res, mockNext);

    expect(mockedService.rejectAgentAction).toHaveBeenCalledWith('action-1', 'user-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: rejectedRow });
  });

  it('passes service errors to next', async () => {
    const error = new Error('reject failed');
    mockedService.rejectAgentAction.mockRejectedValue(error);

    const req = mockReq({}, { id: 'action-1' });
    const res = mockRes();

    await rejectAction(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });
});
