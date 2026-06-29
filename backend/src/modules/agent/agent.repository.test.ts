import { pool, queryOne } from '../../shared/utils/db';
import {
  createAgentAction,
  findAgentActionById,
  findAgentActionByIdempotencyKey,
  updateAgentActionStatus,
  claimAgentActionForExecution,
} from './agent.repository';
import type { AgentActionRow } from './agent.types';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedPoolQuery = pool.query as jest.Mock;

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
  requester_name: 'Admin',
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

describe('createAgentAction', () => {
  it('returns created row on success', async () => {
    mockedQueryOne.mockResolvedValue(baseRow);

    const result = await createAgentAction({
      source: 'chat',
      actionName: 'lead.list',
      actionArgs: {},
      riskTier: 'read',
      status: 'proposed',
      idempotencyKey: 'agent:abc',
    });

    expect(result).toEqual(baseRow);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws when insert returns null', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(
      createAgentAction({
        source: 'chat',
        actionName: 'lead.list',
        actionArgs: {},
        riskTier: 'read',
        status: 'proposed',
        idempotencyKey: 'agent:abc',
      }),
    ).rejects.toThrow('Failed to create agent action');
  });

  it('passes JSON-stringified action_args', async () => {
    mockedQueryOne.mockResolvedValue(baseRow);

    await createAgentAction({
      source: 'chat',
      actionName: 'lead.list',
      actionArgs: { limit: 25, search: 'test' },
      riskTier: 'read',
      status: 'proposed',
      idempotencyKey: 'agent:abc',
    });

    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe(JSON.stringify({ limit: 25, search: 'test' }));
  });

  it('normalizes null action_args and result on the returned row', async () => {
    mockedQueryOne.mockResolvedValue({
      ...baseRow,
      action_args: null as unknown as Record<string, unknown>,
      result: null,
    });

    const result = await createAgentAction({
      source: 'chat',
      actionName: 'lead.list',
      actionArgs: {},
      riskTier: 'read',
      status: 'proposed',
      idempotencyKey: 'agent:abc',
    });

    expect(result.action_args).toEqual({});
    expect(result.result).toBeNull();
  });
});

describe('findAgentActionById', () => {
  it('returns the row when found', async () => {
    mockedQueryOne.mockResolvedValue(baseRow);

    const result = await findAgentActionById('action-1');

    expect(result).toEqual(baseRow);
    expect(mockedQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM agent_actions WHERE id = $1',
      ['action-1'],
    );
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findAgentActionById('missing');

    expect(result).toBeNull();
  });
});

describe('findAgentActionByIdempotencyKey', () => {
  it('returns the row when found', async () => {
    mockedQueryOne.mockResolvedValue(baseRow);

    const result = await findAgentActionByIdempotencyKey('agent:abc');

    expect(result).toEqual(baseRow);
    expect(mockedQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM agent_actions WHERE idempotency_key = $1',
      ['agent:abc'],
    );
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findAgentActionByIdempotencyKey('agent:missing');

    expect(result).toBeNull();
  });
});

describe('updateAgentActionStatus', () => {
  it('updates the row and returns it', async () => {
    const updatedRow: AgentActionRow = { ...baseRow, status: 'succeeded' };
    mockedQueryOne.mockResolvedValue(updatedRow);

    const result = await updateAgentActionStatus('action-1', 'succeeded', {
      result: { items: [] },
    });

    expect(result).toEqual(updatedRow);
    const sql = mockedQueryOne.mock.calls[0][0] as string;
    expect(sql).toContain('SET status = $2');
    expect(sql).toContain('RETURNING *');
  });

  it('throws when no row matches', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(updateAgentActionStatus('missing', 'succeeded')).rejects.toThrow(
      'Agent action not found',
    );
  });

  it('serialises result as JSON when provided', async () => {
    mockedQueryOne.mockResolvedValue({ ...baseRow, status: 'failed', error_message: 'boom' });

    await updateAgentActionStatus('action-1', 'failed', {
      result: { code: 500 },
      errorMessage: 'boom',
    });

    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(params[3]).toBe(JSON.stringify({ code: 500 }));
    expect(params[4]).toBe('boom');
  });
});

describe('claimAgentActionForExecution', () => {
  it('returns the claimed row when UPDATE matches', async () => {
    const executingRow: AgentActionRow = { ...baseRow, status: 'executing' };
    mockedPoolQuery.mockResolvedValue({ rows: [executingRow] });

    const result = await claimAgentActionForExecution('action-1');

    expect(result).toEqual(executingRow);
    const sql = mockedPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain("SET status = 'executing'");
    expect(sql).toContain("status IN ('proposed', 'pending_approval', 'approved')");
    expect(sql).toContain('RETURNING *');
  });

  it('returns null when no rows are claimed', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    const result = await claimAgentActionForExecution('action-1');

    expect(result).toBeNull();
  });
});
