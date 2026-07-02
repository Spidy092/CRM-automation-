import { sendChatMessage, getChatHistory } from './chat.service';
import { redis } from '../../shared/utils/redis';
import * as planner from '../agent-planner/planner.service';
import { proposeAgentAction } from '../agent/agent.service';

jest.mock('../agent-planner/planner.service');
jest.mock('../agent/agent.service');
jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  },
}));

const mockedCreatePlanFromGoal = planner.createPlanFromGoal as jest.MockedFunction<
  typeof planner.createPlanFromGoal
>;
const mockedGetPlanForPreview = planner.getPlanForPreview as jest.MockedFunction<
  typeof planner.getPlanForPreview
>;
const mockedPropose = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;
const mockedRedis = redis as jest.Mocked<typeof redis>;

describe('chat.service.sendChatMessage (thin)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates multi-step requests to the planner', async () => {
    mockedCreatePlanFromGoal.mockResolvedValue({
      plan: { id: 'plan-1', status: 'proposed', goal: 'find leads' } as any,
      steps: [{ step_index: 0, action_name: 'lead.list', risk_tier: 'read' } as any],
    });

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'find me some leads',
      actor: { id: 'user-1', role: 'admin', ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
    });

    expect(mockedCreatePlanFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'find me some leads' }),
    );
    expect(result.action?.name).toBe('plan.create');
  });

  it('answers page-awareness questions directly without planner', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'what page am I on?',
      actor: { id: 'user-1', role: 'admin', ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
      pageContext: {
        route: '/leads',
        pageTitle: 'Leads',
        pageCapabilities: [],
        availableActions: [],
        visibleRecords: [],
      },
    });

    expect(mockedCreatePlanFromGoal).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain('leads');
  });

  it('handles "find more" as plan continuation', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([
        { role: 'user', content: 'show leads', createdAt: new Date().toISOString() },
        { role: 'assistant', content: 'plan:11111111-1111-4111-8111-111111111111', createdAt: new Date().toISOString() },
      ]),
    );
    mockedGetPlanForPreview.mockResolvedValue({
      plan: { id: '11111111-1111-4111-8111-111111111111', goal: 'show leads' } as any,
      steps: [],
      estimatedCostCents: 0,
      requiresApproval: false,
    });

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'show more',
      actor: { id: 'user-1', role: 'admin', ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
    });

    expect(mockedCreatePlanFromGoal).not.toHaveBeenCalled();
    expect(result.reply).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('falls back to a trivial lookup for dashboard requests', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: { totalLeads: 5 },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'show dashboard metrics',
      actor: { id: 'user-1', role: 'admin', ipAddress: null },
      user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
    });

    expect(mockedCreatePlanFromGoal).not.toHaveBeenCalled();
    expect(mockedPropose).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'report.dashboard' }),
    );
    expect(result.reply).toContain('Done');
  });
});

describe('chat.service.getChatHistory', () => {
  it('returns array of turns', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([
        { role: 'user', content: 'hi', createdAt: '2026-06-30T00:00:00Z' },
      ]),
    );
    const turns = await getChatHistory('conv-1');
    expect(turns).toHaveLength(1);
  });
});
