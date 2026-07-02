import request from 'supertest';
import express from 'express';

jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { errorHandler } from '../../../shared/middleware/errorHandler';
import chatRoutes from '../../chat/chat.routes';
import planRoutes from '../plan.routes';
import aiInboxRoutes from '../../ai-inbox/ai-inbox.routes';
import * as chatService from '../../chat/chat.service';
import * as plannerService from '../planner.service';
import * as runnerService from '../runner.service';
import * as aiInboxService from '../../ai-inbox/ai-inbox.service';
import type { ChatResponse } from '../../chat/chat.types';
import type { AiInboxItem } from '../../ai-inbox/ai-inbox.types';

jest.mock('../../../shared/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' };
    next();
  },
}));
jest.mock('../../../shared/middleware/rbac', () => ({
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../chat/chat.service');
jest.mock('../planner.service');
jest.mock('../runner.service');
jest.mock('../../ai-inbox/ai-inbox.service');

const mockedChatService = chatService as jest.Mocked<typeof chatService>;
const mockedPlannerService = plannerService as jest.Mocked<typeof plannerService>;
const mockedRunnerService = runnerService as jest.Mocked<typeof runnerService>;
const mockedAiInboxService = aiInboxService as jest.Mocked<typeof aiInboxService>;

const app = express();
app.use(express.json());
app.use('/chat', chatRoutes);
app.use('/chat/plans', planRoutes);
app.use('/ai-inbox', aiInboxRoutes);
app.use(errorHandler);

const planId = '019f079c-f429-762a-89ab-d143218efd4e';

const fakeInboxItem: AiInboxItem = {
  id: 'inbox-1',
  assigned_to: 'user-1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'approve_response',
  title: 'Approve outreach draft',
  summary: 'Drafted outreach for hot leads',
  urgency_score: 80,
  ai_draft_response: 'Hello, I noticed you are interested...',
  ai_draft_confidence: 0.9,
  expires_at: null,
  status: 'pending',
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-07-02T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
  agent_action_id: 'action-1',
  agent_plan_id: planId,
  agent_plan_step_id: 'step-1',
  action_result: null,
};

function buildChatResponse(): ChatResponse {
  return {
    conversationId: 'conv-1',
    reply: 'I created a plan to find hot leads and draft outreach. Please review it.',
    action: {
      name: 'report.dashboard',
      policy: { outcome: 'require_approval', reason: 'plan requires approval', assignTo: 'manager-1' },
      agentAction: null,
      result: { planId },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Agent Planner E2E Journey', () => {
  it('flows chat -> plan preview -> approve -> execute -> inbox', async () => {
    mockedChatService.sendChatMessage.mockResolvedValue(buildChatResponse());
    mockedPlannerService.getPlanForPreview.mockResolvedValue({
      plan: {
        id: planId,
        goal: 'find hot leads and draft outreach',
        status: 'proposed',
        autonomy_level: 'supervised',
        confidence: 0.85,
        source: 'chat',
        requested_by: 'user-1',
        source_message: 'find hot leads and draft outreach',
        cost_cap_cents: 50,
        step_cap: 5,
        cost_used_cents: 0,
        deadline_at: null,
        started_at: null,
        completed_at: null,
        expires_at: null,
        error_message: null,
        created_at: '2026-07-02T00:00:00.000Z',
        updated_at: '2026-07-02T00:00:00.000Z',
        idempotency_key: 'key-1',
        conversation_id: 'conv-1',
      },
      steps: [
        {
          id: 'step-1',
          plan_id: planId,
          step_index: 0,
          action_name: 'lead.list',
          action_args: {},
          risk_tier: 'read',
          depends_on: [],
          rationale: 'Find hot leads',
          status: 'pending',
          agent_action_id: null,
          result: null,
          error_message: null,
          started_at: null,
          completed_at: null,
        },
      ],
      estimatedCostCents: 10,
      requiresApproval: true,
    });
    mockedRunnerService.executePlan.mockResolvedValue({
      planId,
      status: 'running',
      errorMessage: null,
    });
    mockedAiInboxService.listItems.mockResolvedValue({ items: [fakeInboxItem], total: 1 });

    const chatRes = await request(app)
      .post('/chat')
      .send({ conversationId: 'conv-1', message: 'find hot leads and draft outreach' });

    expect(chatRes.status).toBe(202);
    expect(chatRes.body.success).toBe(true);
    expect(chatRes.body.data.action.result.planId).toBe(planId);
    expect(mockedChatService.sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        message: 'find hot leads and draft outreach',
      }),
    );

    const planRes = await request(app).get(`/chat/plans/${planId}`);

    expect(planRes.status).toBe(200);
    expect(planRes.body.success).toBe(true);
    expect(planRes.body.data.requiresApproval).toBe(true);
    expect(planRes.body.data.steps).toHaveLength(1);
    expect(mockedPlannerService.getPlanForPreview).toHaveBeenCalledWith(planId);

    const approveRes = await request(app).post(`/chat/plans/${planId}/approve`).send({});

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.data.status).toBe('running');
    expect(mockedRunnerService.executePlan).toHaveBeenCalledWith(
      planId,
      expect.objectContaining({ id: 'user-1', role: 'admin' }),
    );

    const inboxRes = await request(app).get('/ai-inbox?status=pending');

    expect(inboxRes.status).toBe(200);
    expect(inboxRes.body.success).toBe(true);
    expect(inboxRes.body.data).toHaveLength(1);
    expect(inboxRes.body.data[0].agent_plan_id).toBe(planId);
    expect(inboxRes.body.meta.total).toBe(1);
    expect(mockedAiInboxService.listItems).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_to: 'user-1',
        status: 'pending',
      }),
    );
  });

  it('flows chat -> plan preview -> cancel', async () => {
    mockedChatService.sendChatMessage.mockResolvedValue(buildChatResponse());
    mockedPlannerService.getPlanForPreview.mockResolvedValue({
      plan: {
        id: planId,
        goal: 'find hot leads and draft outreach',
        status: 'proposed',
        autonomy_level: 'supervised',
        confidence: 0.85,
        source: 'chat',
        requested_by: 'user-1',
        source_message: 'find hot leads and draft outreach',
        cost_cap_cents: 50,
        step_cap: 5,
        cost_used_cents: 0,
        deadline_at: null,
        started_at: null,
        completed_at: null,
        expires_at: null,
        error_message: null,
        created_at: '2026-07-02T00:00:00.000Z',
        updated_at: '2026-07-02T00:00:00.000Z',
        idempotency_key: 'key-1',
        conversation_id: 'conv-1',
      },
      steps: [],
      estimatedCostCents: 10,
      requiresApproval: true,
    });
    mockedRunnerService.cancelPlan.mockResolvedValue({
      planId,
      status: 'cancelled',
      errorMessage: null,
    });

    const chatRes = await request(app)
      .post('/chat')
      .send({ conversationId: 'conv-1', message: 'find hot leads and draft outreach' });

    expect(chatRes.status).toBe(202);
    expect(chatRes.body.data.action.result.planId).toBe(planId);

    const planRes = await request(app).get(`/chat/plans/${planId}`);

    expect(planRes.status).toBe(200);
    expect(planRes.body.data.requiresApproval).toBe(true);

    const cancelRes = await request(app).post(`/chat/plans/${planId}/cancel`).send({});

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.success).toBe(true);
    expect(cancelRes.body.data.status).toBe('cancelled');
    expect(mockedRunnerService.cancelPlan).toHaveBeenCalledWith(planId);
  });
});
