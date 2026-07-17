import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { AgentActionRow } from '../agent/agent.types';

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let mockRole = 'admin';
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1', role: mockRole, email: 'user@example.com', name: 'Test User' };
    next();
  },
}));

jest.mock('../agent/agent.service', () => ({
  proposeAgentAction: jest.fn(),
}));

import { mcpRoutes } from './mcp.routes';
import { proposeAgentAction } from '../agent/agent.service';

const mockedPropose = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;

const app = express();
app.use(express.json());
app.use('/api/v1/mcp', mcpRoutes);
app.use(errorHandler);

function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: '2.0' as const, id, method, ...(params ? { params } : {}) };
}

const succeededRow = {
  id: 'action-1',
  status: 'succeeded',
  result: { items: [] },
} as unknown as AgentActionRow;

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'admin';
});

describe('MCP endpoint — protocol lifecycle', () => {
  it('responds to initialize with server info and tools capability', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('initialize', { protocolVersion: '2025-03-26' }));
    expect(res.status).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-03-26');
    expect(res.body.result.capabilities).toEqual({ tools: {} });
    expect(res.body.result.serverInfo.name).toBe('crm-ai-sales-operator');
  });

  it('falls back to the default protocol version for unknown versions', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('initialize', { protocolVersion: '1999-01-01' }));
    expect(res.body.result.protocolVersion).toBe('2025-03-26');
  });

  it('returns 202 with no body for notifications', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('answers ping with an empty result', async () => {
    const res = await request(app).post('/api/v1/mcp').send(rpc('ping'));
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  it('returns method-not-found for unknown methods', async () => {
    const res = await request(app).post('/api/v1/mcp').send(rpc('resources/list'));
    expect(res.body.error.code).toBe(-32601);
  });

  it('rejects a malformed JSON-RPC body with 400', async () => {
    const res = await request(app).post('/api/v1/mcp').send({ hello: 'world' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
  });

  it('rejects GET (no SSE stream) with 405', async () => {
    const res = await request(app).get('/api/v1/mcp');
    expect(res.status).toBe(405);
  });
});

describe('MCP endpoint — tools/list', () => {
  it('lists every catalog action as an MCP tool for admin', async () => {
    const res = await request(app).post('/api/v1/mcp').send(rpc('tools/list'));
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.length).toBeGreaterThanOrEqual(57);
    const names = tools.map((t) => t.name);
    expect(names).toContain('lead__list');
    expect(names).toContain('campaign__brief__get');
    expect(names.every((n) => /^[a-zA-Z0-9_-]{1,64}$/.test(n))).toBe(true);
    expect(tools.every((t) => t.inputSchema !== undefined)).toBe(true);
  });

  it('filters tools by the actor role (viewer sees no admin-only tools)', async () => {
    mockRole = 'viewer';
    const res = await request(app).post('/api/v1/mcp').send(rpc('tools/list'));
    const names = (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('lead__list');
    expect(names).not.toContain('scraper__run');
    expect(names).not.toContain('custom_field__create');
    expect(names).not.toContain('ai__decision_log__list');
  });
});

describe('MCP endpoint — tools/call', () => {
  it('routes the call through proposeAgentAction with source chat and an MCP marker', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: succeededRow,
      result: { items: [] },
    });
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'lead__list', arguments: { limit: 5 } }));

    expect(res.status).toBe(200);
    expect(mockedPropose).toHaveBeenCalledWith({
      source: 'chat',
      actionName: 'lead.list',
      args: { limit: 5 },
      actor: expect.objectContaining({ id: 'user-1', role: 'admin' }),
      sourceMessage: 'MCP tool call: lead__list',
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.status).toBe('succeeded');
  });

  it('surfaces pending approval for write actions', async () => {
    mockedPropose.mockResolvedValue({
      policy: {
        outcome: 'require_approval',
        reason: 'Chat write actions require explicit approval',
        assignTo: 'user-1',
      },
      action: { ...succeededRow, id: 'action-2', status: 'pending_approval' },
    });
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'campaign__launch', arguments: { id: 'cmp-1' } }));

    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.status).toBe('pending_approval');
    expect(payload.agent_action_id).toBe('action-2');
    expect(res.body.result.isError).toBeUndefined();
  });

  it('returns isError for policy rejections', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'reject', reason: 'Role is not allowed to perform this action' },
      action: null,
    });
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'scraper__run', arguments: { configId: 'cfg-1' } }));

    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('rejected');
  });

  it('returns isError for unknown tools without calling the pipeline', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'does__not__exist' }));
    expect(res.body.result.isError).toBe(true);
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('returns isError when the pipeline throws (e.g. Zod arg failure)', async () => {
    mockedPropose.mockRejectedValue(new Error('Invalid uuid'));
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'lead__get', arguments: { id: 'not-a-uuid' } }));
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('Invalid uuid');
  });

  it('formats a real ZodError as a readable message, not raw JSON', async () => {
    let zodError: unknown;
    try {
      z.object({ id: z.string().uuid() }).parse({ id: 'not-a-uuid' });
    } catch (err) {
      zodError = err;
    }
    mockedPropose.mockRejectedValue(zodError);
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'lead__get', arguments: { id: 'not-a-uuid' } }));

    const text = res.body.result.content[0].text as string;
    expect(res.body.result.isError).toBe(true);
    expect(text).toBe('Tool call failed: Invalid uuid');
    expect(text).not.toContain('"validation"');
    expect(text).not.toContain('"code"');
  });

  it('rejects invalid tool names at the params layer', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send(rpc('tools/call', { name: 'bad.name!' }));
    expect(res.body.error.code).toBe(-32602);
  });
});

describe('MCP endpoint — batching', () => {
  it('handles a batch of requests and preserves ids', async () => {
    const res = await request(app)
      .post('/api/v1/mcp')
      .send([rpc('ping', undefined, 'a'), rpc('tools/list', undefined, 'b')]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
  });
});
