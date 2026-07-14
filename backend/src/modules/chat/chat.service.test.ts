jest.mock('../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import OpenAI from 'openai';
import { sendChatMessage, getChatHistory } from './chat.service';
import { redis } from '../../shared/utils/redis';
import * as planner from '../agent-planner/planner.service';
import { proposeAgentAction } from '../agent/agent.service';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findPendingItemForAgentAction } from '../ai-inbox/ai-inbox.service';

jest.mock('openai');
jest.mock('../agent-planner/planner.service');
jest.mock('../agent/agent.service');
jest.mock('../ai-settings/ai-settings.service');
jest.mock('../ai-inbox/ai-inbox.service');
jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  },
}));

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const openAiCreateMock = jest.fn();
(MockedOpenAI as unknown as jest.Mock).mockImplementation(() => ({
  chat: { completions: { create: openAiCreateMock } },
}));

const mockedCreatePlanFromGoal = planner.createPlanFromGoal as jest.MockedFunction<
  typeof planner.createPlanFromGoal
>;
const mockedGetPlanForPreview = planner.getPlanForPreview as jest.MockedFunction<
  typeof planner.getPlanForPreview
>;
const mockedPropose = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;
const mockedGetAiConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedFindPendingItem = findPendingItemForAgentAction as jest.MockedFunction<
  typeof findPendingItemForAgentAction
>;

const baseInput = {
  conversationId: 'conv-1',
  actor: { id: 'user-1', role: 'admin', ipAddress: null } as any,
  user: { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' } as any,
};

function assistantTextResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content, tool_calls: [] } }] };
}

function assistantToolCallResponse(name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRedis.get.mockResolvedValue(null as any);
  mockedGetAiConfig.mockResolvedValue({
    apiKey: 'test-key',
    baseUrl: null,
    model: 'gpt-4o-mini',
    maxTokens: 2000,
    temperature: 0.2,
    systemPromptOverride: null,
    cacheTtlSeconds: 3600,
  } as any);
});

describe('chat.service.sendChatMessage (agent conversation)', () => {
  it('answers greetings conversationally without calling OpenAI or actions', async () => {
    const result = await sendChatMessage({ ...baseInput, message: 'hello' });

    expect(openAiCreateMock).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain('copilot');
  });

  it('answers a plain question with the LLM text reply', async () => {
    openAiCreateMock.mockResolvedValueOnce(
      assistantTextResponse('You are on the Templates page. It shows 3 templates.'),
    );

    const result = await sendChatMessage({
      ...baseInput,
      message: 'can you see the template page',
      pageContext: { route: '/templates', pageTitle: 'Templates' },
    });

    expect(result.reply).toContain('Templates page');
    expect(mockedPropose).not.toHaveBeenCalled();
    // Page context must be embedded in the system prompt
    const messages = openAiCreateMock.mock.calls[0][0].messages;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Templates');
  });

  it('executes a read tool call and feeds the result back to the LLM', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read or compliance-critical action' },
      action: null,
      result: { items: [{ name: 'Welcome Email' }], meta: { hasMore: false } },
    } as any);
    openAiCreateMock
      .mockResolvedValueOnce(assistantToolCallResponse('template__list', { limit: 25 }))
      .mockResolvedValueOnce(assistantTextResponse('You have 1 template: Welcome Email.'));

    const result = await sendChatMessage({ ...baseInput, message: 'how many templates' });

    expect(mockedPropose).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'template.list', source: 'chat' }),
    );
    expect(result.reply).toContain('Welcome Email');
    // Tool result was appended for the second round
    const secondCallMessages = openAiCreateMock.mock.calls[1][0].messages;
    expect(secondCallMessages.some((m: { role: string }) => m.role === 'tool')).toBe(true);
  });

  it('returns approval action metadata with the linked inbox item id when a write tool requires approval', async () => {
    mockedPropose.mockResolvedValue({
      policy: {
        outcome: 'require_approval',
        reason: 'Chat write actions require explicit approval',
        assignTo: 'user-1',
      },
      action: { id: 'action-1', status: 'pending_approval' },
    } as any);
    mockedFindPendingItem.mockResolvedValue({ id: 'inbox-item-1' } as any);
    openAiCreateMock
      .mockResolvedValueOnce(
        assistantToolCallResponse('scraper__run', { configId: '11111111-1111-4111-8111-111111111111' }),
      )
      .mockResolvedValueOnce(assistantTextResponse('Approve below to run the scraper.'));

    const result = await sendChatMessage({ ...baseInput, message: 'run the scraper' });

    expect(mockedFindPendingItem).toHaveBeenCalledWith('action-1');
    expect(result.action?.name).toBe('scraper.run');
    expect(result.action?.policy.outcome).toBe('require_approval');
    expect(result.action?.inboxItemId).toBe('inbox-item-1');
    expect(result.reply.toLowerCase()).not.toContain('ai inbox');
  });

  it('leaves inboxItemId null when no pending inbox item can be found', async () => {
    mockedPropose.mockResolvedValue({
      policy: {
        outcome: 'require_approval',
        reason: 'Chat write actions require explicit approval',
        assignTo: 'user-1',
      },
      action: { id: 'action-1', status: 'pending_approval' },
    } as any);
    mockedFindPendingItem.mockResolvedValue(null);
    openAiCreateMock
      .mockResolvedValueOnce(
        assistantToolCallResponse('scraper__run', { configId: '11111111-1111-4111-8111-111111111111' }),
      )
      .mockResolvedValueOnce(assistantTextResponse('Approve below to run the scraper.'));

    const result = await sendChatMessage({ ...baseInput, message: 'run the scraper' });

    expect(result.action?.inboxItemId).toBeNull();
  });

  it('delegates multi-step goals to the planner via the plan__create tool', async () => {
    openAiCreateMock.mockResolvedValueOnce(
      assistantToolCallResponse('plan__create', { goal: 'pause all cold leads' }),
    );
    mockedCreatePlanFromGoal.mockResolvedValue({
      plan: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'proposed',
        goal: 'pause all cold leads',
      } as any,
      steps: [{ step_index: 0, action_name: 'lead.pause', risk_tier: 'sensitive_write' } as any],
    });

    const result = await sendChatMessage({ ...baseInput, message: 'pause all my cold leads' });

    expect(mockedCreatePlanFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'pause all cold leads' }),
    );
    expect(result.action?.name).toBe('plan.create');
  });

  it('falls back to the planner when OpenAI fails', async () => {
    openAiCreateMock.mockRejectedValue(new Error('openai down'));
    mockedCreatePlanFromGoal.mockResolvedValue({
      plan: { id: '22222222-2222-4222-8222-222222222222', status: 'proposed', goal: 'find leads' } as any,
      steps: [{ step_index: 0, action_name: 'lead.update', risk_tier: 'low_risk_write' } as any],
    });

    const result = await sendChatMessage({ ...baseInput, message: 'find me some leads' });

    expect(mockedCreatePlanFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goal: 'find me some leads' }),
    );
    expect(result.action?.name).toBe('plan.create');
  });

  it('surfaces the planner reason when a goal is unsupported', async () => {
    const { PlannerError } = jest.requireActual<
      typeof import('../agent-planner/errors')
    >('../agent-planner/errors');
    openAiCreateMock.mockResolvedValueOnce(
      assistantToolCallResponse('plan__create', { goal: 'create a campaign' }),
    );
    mockedCreatePlanFromGoal.mockRejectedValue(
      new PlannerError('unsupported_goal', 'I cannot create campaigns yet.'),
    );

    const result = await sendChatMessage({
      ...baseInput,
      message: 'create a new campaign called Summer Promo',
    });

    expect(result.reply).toContain('I cannot create campaigns yet.');
    expect(result.action).toBeUndefined();
  });

  it('handles "show more" as plan continuation', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([
        { role: 'user', content: 'show leads', createdAt: new Date().toISOString() },
        {
          role: 'assistant',
          content: 'plan:11111111-1111-4111-8111-111111111111',
          createdAt: new Date().toISOString(),
        },
      ]),
    );
    mockedGetPlanForPreview.mockResolvedValue({
      plan: { id: '11111111-1111-4111-8111-111111111111', goal: 'show leads' } as any,
      steps: [],
      estimatedCostCents: 0,
      requiresApproval: false,
    });

    const result = await sendChatMessage({ ...baseInput, message: 'show more' });

    expect(openAiCreateMock).not.toHaveBeenCalled();
    expect(result.reply).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('does not treat longer messages containing "more" as plan continuation', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([
        {
          role: 'assistant',
          content: 'plan:11111111-1111-4111-8111-111111111111',
          createdAt: new Date().toISOString(),
        },
      ]),
    );
    openAiCreateMock.mockResolvedValueOnce(assistantTextResponse('Here are more leads.'));

    await sendChatMessage({ ...baseInput, message: 'find me more leads in Bangalore' });

    expect(mockedGetPlanForPreview).not.toHaveBeenCalled();
    expect(openAiCreateMock).toHaveBeenCalled();
  });

  it('reports a rejected tool call back to the LLM instead of failing', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'reject', reason: 'Role is not allowed to perform this action' },
      action: null,
    } as any);
    openAiCreateMock
      .mockResolvedValueOnce(
        assistantToolCallResponse('campaign__launch', { id: '11111111-1111-4111-8111-111111111111' }),
      )
      .mockResolvedValueOnce(
        assistantTextResponse('You are not allowed to launch campaigns with your role.'),
      );

    const result = await sendChatMessage({ ...baseInput, message: 'launch the campaign' });

    expect(result.reply.toLowerCase()).toContain('not allowed');
    expect(result.action).toBeUndefined();
  });
});

describe('chat.service.getChatHistory', () => {
  it('returns array of turns', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([{ role: 'user', content: 'hi', createdAt: '2026-06-30T00:00:00Z' }]),
    );
    const turns = await getChatHistory('conv-1');
    expect(turns).toHaveLength(1);
  });

  it('strips internal plan: markers from assistant turns', async () => {
    mockedRedis.get.mockResolvedValueOnce(
      JSON.stringify([
        {
          role: 'assistant',
          content: 'plan:11111111-1111-4111-8111-111111111111:I planned: "find leads". 2 steps.',
          createdAt: '2026-06-30T00:00:00Z',
        },
      ]),
    );
    const turns = await getChatHistory('conv-1');
    expect(turns[0].content).toBe('I planned: "find leads". 2 steps.');
  });
});
