import { getChatHistory, sendChatMessage } from './chat.service';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { proposeAgentAction } from '../agent/agent.service';
import { redis } from '../../shared/utils/redis';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';

jest.mock('../ai-settings/ai-settings.service');
jest.mock('../agent/agent.service');
jest.mock('../ai-intelligence/ai-intelligence.repository', () => ({ insertDecisionLog: jest.fn() }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: jest.fn() } },
})));
jest.mock('../../shared/utils/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('../../shared/utils/metrics', () => ({ incAiTokens: jest.fn() }));
jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
  },
}));

const mockedGetAiConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockedPropose = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;
const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedInsertDecisionLog = insertDecisionLog as jest.MockedFunction<typeof insertDecisionLog>;

const actor = {
  id: 'user-1',
  role: 'admin' as const,
  email: 'admin@example.com',
  name: 'Admin User',
};
const user = { ...actor };

describe('chat.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.setex.mockResolvedValue('OK');
    mockedInsertDecisionLog.mockResolvedValue({} as never);
  });

  it('falls back to dashboard action when AI is unavailable', async () => {
    mockedGetAiConfig.mockResolvedValue(null);
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read or compliance-critical action' },
      action: null,
      result: { totalLeads: 5 },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-1',
      message: 'show dashboard metrics',
      actor,
      user,
    });

    expect(mockedPropose).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'report.dashboard', source: 'chat' }),
    );
    expect(result.reply).toContain('5 leads');
    expect(mockedRedis.setex).toHaveBeenCalled();
  });

  it('returns unavailable message when AI is unavailable and no fallback command matches', async () => {
    mockedGetAiConfig.mockResolvedValue(null);

    const result = await sendChatMessage({
      conversationId: 'conv-2',
      message: 'hello there',
      actor,
      user,
    });

    expect(mockedPropose).not.toHaveBeenCalled();
    expect(result.reply).toContain('Copilot AI is unavailable');
  });

  it('logs a failed chat decision when OpenAI orchestration fails', async () => {
    const OpenAI = (await import('openai')).default as unknown as jest.Mock;
    const create = jest.fn().mockRejectedValue(new Error('provider down'));
    OpenAI.mockImplementation(() => ({ chat: { completions: { create } } }));

    mockedGetAiConfig.mockResolvedValue({
      apiKey: 'test-key',
      baseUrl: null,
      model: 'gpt-test',
      maxTokens: 500,
      temperature: 0.2,
      systemPromptOverride: null,
      cacheTtlSeconds: 3600,
    });

    const result = await sendChatMessage({
      conversationId: 'conv-3',
      message: 'hello there',
      actor,
      user,
    });

    expect(result.reply).toContain('Copilot AI is unavailable');
    expect(mockedInsertDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_type: 'chat',
        decision: 'failed',
        model_used: 'gpt-test',
        human_approval_required: false,
        input_context: expect.objectContaining({
          conversationId: 'conv-3',
          actorId: 'user-1',
          actorRole: 'admin',
        }),
      }),
    );
  });


  it('uses scraper page context to ask for a source name instead of raw config id', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-4',
      message: 'can you run the scrapper',
      actor,
      user,
      pageContext: {
        route: '/scraper',
        pageTitle: 'Scrapers',
        visibleRecords: [
          { type: 'scraper', id: '11111111-1111-4111-8111-111111111111', name: 'my web scrapper', status: 'active', subtitle: 'web scrape', meta: { source_type: 'web_scrape' } },
          { type: 'scraper', id: '22222222-2222-4222-8222-222222222222', name: 'places', status: 'active', subtitle: 'google places', meta: { source_type: 'google_places' } },
        ],
        availableActions: ['scraper.run'],
      },
    });

    expect(mockedGetAiConfig).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
    expect(result.reply).toContain('Which scraper should I run?');
    expect(result.reply).toContain('my web scrapper');
    expect(result.reply).toContain('places');
    expect(result.reply).not.toContain('config ID');
  });

  it('runs a named scraper from page context through approval action', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'require_approval', reason: 'Chat write actions require explicit approval', assignTo: 'user-1' },
      action: null,
    });

    const result = await sendChatMessage({
      conversationId: 'conv-5',
      message: 'run places scraper',
      actor,
      user,
      pageContext: {
        route: '/scraper',
        pageTitle: 'Scrapers',
        visibleRecords: [
          { type: 'scraper', id: '11111111-1111-4111-8111-111111111111', name: 'my web scrapper', status: 'active', subtitle: 'web scrape', meta: { source_type: 'web_scrape' } },
          { type: 'scraper', id: '22222222-2222-4222-8222-222222222222', name: 'places', status: 'active', subtitle: 'google places', meta: { source_type: 'google_places' } },
        ],
        availableActions: ['scraper.run'],
      },
    });

    expect(mockedPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat',
        actionName: 'scraper.run',
        args: { configId: '22222222-2222-4222-8222-222222222222' },
        forceApproval: true,
      }),
    );
    expect(result.reply).toContain('places');
    expect(result.action?.name).toBe('scraper.run');
  });

  it('resolves typo scraper prompt on scraper page without asking for config id', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-6',
      message: 'can you ran the scrapper',
      actor,
      user,
      pageContext: {
        route: '/scraper',
        pageTitle: 'Scrapers',
        visibleRecords: [
          { type: 'scraper', id: '11111111-1111-4111-8111-111111111111', name: 'my web scrapper', status: 'active', subtitle: 'web scrape' },
          { type: 'scraper', id: '22222222-2222-4222-8222-222222222222', name: 'places', status: 'active', subtitle: 'google places' },
        ],
      },
    });

    expect(mockedGetAiConfig).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
    expect(result.reply).toContain('Which scraper should I run?');
    expect(result.reply).toContain('my web scrapper');
    expect(result.reply).toContain('places');
    expect(result.reply).not.toContain('config ID');
  });

  it('resolves current campaign from page context for a launch request', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'require_approval', reason: 'Explicit approval required', assignTo: 'user-1' },
      action: null,
    });

    const result = await sendChatMessage({
      conversationId: 'conv-7',
      message: 'launch this campaign',
      actor,
      user,
      pageContext: {
        route: '/campaigns/33333333-3333-4333-8333-333333333333',
        pageTitle: 'Campaigns',
        visibleRecords: [
          { type: 'campaign', id: '33333333-3333-4333-8333-333333333333', name: 'June promo', status: 'draft' },
        ],
        availableActions: ['campaign.launch'],
      },
    });

    expect(mockedPropose).toHaveBeenCalledWith(expect.objectContaining({
      actionName: 'campaign.launch',
      args: { id: '33333333-3333-4333-8333-333333333333' },
      forceApproval: true,
    }));
    expect(result.reply).toContain('June promo');
  });

  it('summarizes lead list results instead of returning a generic tool status', async () => {
    mockedGetAiConfig.mockResolvedValue(null);
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: {
        items: [
          { business_name: 'Acme Dental' },
          { business_name: 'Bright Clinic' },
        ],
        total: 2,
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-8',
      message: 'how many leads are there',
      actor,
      user,
    });

    expect(result.reply).toContain('I found 2 leads');
    expect(result.reply).toContain('Acme Dental');
    expect(result.reply).not.toContain('lead.list successfully');
  });


  it('approves a visible AI Inbox item without asking for an item id', async () => {
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read or compliance-critical action' },
      action: null,
      result: {
        id: '44444444-4444-4444-8444-444444444444',
        title: 'Approve agent action: scraper.run',
        status: 'actioned',
        action_result: { status: 'succeeded' },
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-9',
      message: 'approve this item',
      actor,
      user,
      pageContext: {
        route: '/ai-inbox',
        pageTitle: 'AI Inbox',
        visibleRecords: [
          {
            type: 'ai_inbox_item',
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Approve agent action: scraper.run',
            status: 'pending',
            subtitle: 'approve response',
          },
        ],
        availableActions: ['ai.inbox.action'],
      },
    });

    expect(mockedPropose).toHaveBeenCalledWith(expect.objectContaining({
      actionName: 'ai.inbox.action',
      args: { id: '44444444-4444-4444-8444-444444444444', action: 'approve' },
      forceApproval: false,
    }));
    expect(result.reply).toContain('AI Inbox item Approve agent action: scraper.run is now actioned');
    expect(result.reply).not.toContain('item id');
  });


  it('answers what page the user is on using page capabilities and metrics', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-10',
      message: 'what can you do on this screen?',
      actor,
      user,
      pageContext: {
        route: '/settings/ai',
        pageTitle: 'AI Settings',
        pageCapabilities: [
          'Configure AI provider settings',
          'Check whether an API key is stored',
          'Adjust model, max tokens, temperature, and cache TTL',
        ],
        pageMetrics: {
          aiEnabled: true,
          hasApiKey: true,
          model: 'gpt-4o',
        },
      },
    });

    expect(mockedGetAiConfig).not.toHaveBeenCalled();
    expect(result.reply).toContain('You are on AI Settings');
    expect(result.reply).toContain('Configure AI provider settings');
    expect(result.reply).toContain('model: gpt-4o');
  });

  it('describes visible records on the current page without calling the LLM', async () => {
    const result = await sendChatMessage({
      conversationId: 'conv-11',
      message: 'what page am i on?',
      actor,
      user,
      pageContext: {
        route: '/settings/integrations',
        pageTitle: 'Integrations',
        pageCapabilities: ['Review integration status', 'Test integrations'],
        visibleRecords: [
          { type: 'integration', id: '55555555-5555-4555-8555-555555555555', name: 'WhatsApp', status: 'enabled' },
          { type: 'integration', id: '66666666-6666-4666-8666-666666666666', name: 'SendGrid', status: 'disabled' },
        ],
      },
    });

    expect(mockedGetAiConfig).not.toHaveBeenCalled();
    expect(result.reply).toContain('You are on Integrations');
    expect(result.reply).toContain('2 integrations');
    expect(result.reply).toContain('WhatsApp');
    expect(result.reply).toContain('SendGrid');
  });


  it('lists every returned lead when the user asks for 25 leads', async () => {
    mockedGetAiConfig.mockResolvedValue(null);
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: {
        items: Array.from({ length: 25 }, (_, index) => ({ business_name: `Lead ${index + 1}` })),
        meta: { limit: 25, hasMore: true },
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-12',
      message: 'i want the list of all the 25 leads',
      actor,
      user,
    });

    expect(mockedPropose).toHaveBeenCalledWith(expect.objectContaining({
      actionName: 'lead.list',
      args: { limit: 25, search: undefined },
    }));
    expect(result.reply).toContain('Showing 25');
    expect(result.reply).toContain('1. Lead 1');
    expect(result.reply).toContain('25. Lead 25');
    expect(result.reply).not.toContain('Top matches');
  });

  it('requests and lists 75 leads when the user asks for 75 leads', async () => {
    mockedGetAiConfig.mockResolvedValue(null);
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: {
        items: Array.from({ length: 75 }, (_, index) => ({ business_name: `Restaurant ${index + 1}` })),
        meta: { limit: 75, hasMore: false },
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-13',
      message: 'list the 75 leads',
      actor,
      user,
    });

    expect(mockedPropose).toHaveBeenCalledWith(expect.objectContaining({
      actionName: 'lead.list',
      args: { limit: 75, search: undefined },
    }));
    expect(result.reply).toContain('Showing 75');
    expect(result.reply).toContain('1. Restaurant 1');
    expect(result.reply).toContain('75. Restaurant 75');
    expect(result.reply).not.toContain('Top matches');
  });


  it('stores lead-list cursor state internally without exposing it in the reply', async () => {
    mockedGetAiConfig.mockResolvedValue(null);
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: {
        items: Array.from({ length: 3 }, (_, index) => ({ business_name: `Cursor Lead ${index + 1}` })),
        meta: { limit: 3, hasMore: true, nextCursor: 'cursor-next-1' },
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-14',
      message: 'list 3 leads',
      actor,
      user,
    });

    expect(result.reply).toContain('Say "next page" to continue');
    expect(result.reply).not.toContain('[crm:lead-list-state:');
    const savedPayload = mockedRedis.setex.mock.calls.at(-1)?.[2] as string;
    expect(savedPayload).toContain('[crm:lead-list-state:');
  });

  it('continues a lead list from the saved cursor when the user asks for next page', async () => {
    const previousHistory = [
      { role: 'user' as const, content: 'list 3 leads', createdAt: '2026-06-29T00:00:00.000Z' },
      {
        role: 'assistant' as const,
        content: [
          'I found 3 leads. Showing 3:',
          '1. Lead 1',
          '2. Lead 2',
          '3. Lead 3',
          'There are more leads after this page. Say \"next page\" to continue.[crm:lead-list-state:eyJsaW1pdCI6MywiY3Vyc29yIjoiY3Vyc29yLW5leHQtMSJ9]',
        ].join('\\n'),
        createdAt: '2026-06-29T00:00:01.000Z',
      },
    ];
    mockedRedis.get.mockResolvedValue(JSON.stringify(previousHistory));
    mockedPropose.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Read action' },
      action: null,
      result: {
        items: [
          { business_name: 'Lead 4' },
          { business_name: 'Lead 5' },
          { business_name: 'Lead 6' },
        ],
        meta: { limit: 3, hasMore: false },
      },
    });

    const result = await sendChatMessage({
      conversationId: 'conv-14',
      message: 'next page',
      actor,
      user,
    });

    expect(mockedGetAiConfig).not.toHaveBeenCalled();
    expect(mockedPropose).toHaveBeenCalledWith(expect.objectContaining({
      actionName: 'lead.list',
      args: { limit: 3, cursor: 'cursor-next-1' },
    }));
    expect(result.reply).toContain('1. Lead 4');
    expect(result.reply).toContain('3. Lead 6');
    expect(result.reply).not.toContain('[crm:lead-list-state:');
  });

  it('strips internal lead-list cursor markers from returned chat history', async () => {
    mockedRedis.get.mockResolvedValue(JSON.stringify([
      {
        role: 'assistant',
        content: 'Visible reply.[crm:lead-list-state:eyJsaW1pdCI6MywiY3Vyc29yIjoiYyJ9]',
        createdAt: '2026-06-29T00:00:00.000Z',
      },
    ]));

    const history = await getChatHistory('conv-15');

    expect(history[0].content).toBe('Visible reply.');
  });

});
