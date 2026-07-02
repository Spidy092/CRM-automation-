import {
  classifyInboundReply,
  classifyReply,
  getReplyHistory,
  triggerClassification,
} from './ai-reply.service';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findLeadById } from '../leads/leads.repository';
import {
  findAiProfileByLeadId,
  insertDecisionLog,
  listDecisionLogs,
} from '../ai-intelligence/ai-intelligence.repository';
import type { AiDecisionLogRow } from '../ai-intelligence/ai-intelligence.types';
import { invalidateProfileCache } from '../ai-intelligence/ai-intelligence.service';
import { incAiTokens, incAiReplyClassified } from '../../shared/utils/metrics';
import {
  cancelPendingOutreachJobs,
  enqueueAiClassifyReply,
  enqueueAiCreateInboxItem,
} from '../../workers/queue';
import {
  upsertConversationSummary,
  appendObjectionToProfile,
  appendBuyingSignalToProfile,
  updateProfileNextAction,
  getLeadCampaignContext,
} from './ai-reply.repository';
import { findUserById } from '../users/users.repository';
import { findStageByName } from '../pipeline/pipeline.repository';
import { proposeAgentAction } from '../agent/agent.service';
import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import type { ClassifyReplyInput, ReplyClassification } from './ai-reply.types';

jest.mock('openai');
jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../ai-settings/ai-settings.service');
jest.mock('../leads/leads.repository');
jest.mock('../ai-intelligence/ai-intelligence.repository');
jest.mock('../ai-intelligence/ai-intelligence.service');
jest.mock('../../shared/utils/metrics');
jest.mock('../../workers/queue', () => ({
  cancelPendingOutreachJobs: jest.fn(),
  enqueueAiClassifyReply: jest.fn(),
  enqueueAiCreateInboxItem: jest.fn(),
}));
jest.mock('./ai-reply.repository');
jest.mock('../users/users.repository');
jest.mock('../pipeline/pipeline.repository');
jest.mock('../agent/agent.service');

const mockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const mockedLogger = logger as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};
const mockedGetAiConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockedFindLeadById = findLeadById as jest.MockedFunction<typeof findLeadById>;
const mockedFindAiProfileByLeadId = findAiProfileByLeadId as jest.MockedFunction<typeof findAiProfileByLeadId>;
const mockedInsertDecisionLog = insertDecisionLog as jest.MockedFunction<typeof insertDecisionLog>;
const mockedListDecisionLogs = listDecisionLogs as jest.MockedFunction<typeof listDecisionLogs>;
const mockedInvalidateProfileCache = invalidateProfileCache as jest.MockedFunction<typeof invalidateProfileCache>;
const mockedIncAiTokens = incAiTokens as jest.MockedFunction<typeof incAiTokens>;
const mockedIncAiReplyClassified = incAiReplyClassified as jest.MockedFunction<typeof incAiReplyClassified>;
const mockedCancelPendingOutreachJobs = cancelPendingOutreachJobs as jest.MockedFunction<typeof cancelPendingOutreachJobs>;
const mockedEnqueueAiClassifyReply = enqueueAiClassifyReply as jest.MockedFunction<typeof enqueueAiClassifyReply>;
const mockedEnqueueAiCreateInboxItem = enqueueAiCreateInboxItem as jest.MockedFunction<typeof enqueueAiCreateInboxItem>;
const mockedUpsertConversationSummary = upsertConversationSummary as jest.MockedFunction<typeof upsertConversationSummary>;
const mockedAppendObjectionToProfile = appendObjectionToProfile as jest.MockedFunction<typeof appendObjectionToProfile>;
const mockedAppendBuyingSignalToProfile = appendBuyingSignalToProfile as jest.MockedFunction<typeof appendBuyingSignalToProfile>;
const mockedUpdateProfileNextAction = updateProfileNextAction as jest.MockedFunction<typeof updateProfileNextAction>;
const mockedGetLeadCampaignContext = getLeadCampaignContext as jest.MockedFunction<typeof getLeadCampaignContext>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedFindStageByName = findStageByName as jest.MockedFunction<typeof findStageByName>;
const mockedProposeAgentAction = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;

const leadId = '019f079c-f429-762a-89ab-d143218efd4e';
const campaignId = '019f079c-f429-762a-89ab-d143218efd4f';

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: leadId,
    business_name: 'Acme Inc',
    pipeline_stage_id: 'stage-1',
    ...overrides,
  } as NonNullable<Awaited<ReturnType<typeof findLeadById>>>;
}

function makeAiProfile(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: leadId,
    buying_intent: 'high',
    offer_angle: 'save time',
    objection_log: [],
    conversation_summary: 'previous summary',
    ...overrides,
  } as unknown as NonNullable<Awaited<ReturnType<typeof findAiProfileByLeadId>>>;
}

function makeAiOutput(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function mockOpenAICompletion(output: Record<string, unknown>) {
  const create = jest.fn().mockResolvedValue({
    usage: { total_tokens: 42 },
    choices: [{ message: { content: JSON.stringify(output) } }],
  });
  mockedOpenAI.mockImplementation(
    () =>
      ({
        chat: { completions: { create } },
      }) as unknown as OpenAI,
  );
  return create;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetAiConfig.mockResolvedValue({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4o-mini',
    maxTokens: 300,
    temperature: 0.2,
    systemPromptOverride: null,
    cacheTtlSeconds: 300,
  });
  mockedFindLeadById.mockResolvedValue(makeLead());
  mockedFindAiProfileByLeadId.mockResolvedValue(makeAiProfile());
  mockedGetLeadCampaignContext.mockResolvedValue({
    assignedTo: 'user-1',
    campaignId,
    autonomyLevel: 'autopilot',
    aiMinConfidence: 70,
  });
  mockedInsertDecisionLog.mockResolvedValue({ id: 'log-1' } as unknown as Awaited<ReturnType<typeof insertDecisionLog>>);
  mockedListDecisionLogs.mockResolvedValue({ rows: [], total: 0 });
  mockedUpsertConversationSummary.mockResolvedValue(undefined);
  mockedAppendObjectionToProfile.mockResolvedValue(undefined);
  mockedAppendBuyingSignalToProfile.mockResolvedValue(undefined);
  mockedUpdateProfileNextAction.mockResolvedValue(undefined);
  mockedFindUserById.mockResolvedValue({
    id: 'user-1',
    name: 'Sales Rep',
    email: 'rep@example.com',
    role: 'sales',
    is_active: true,
    created_at: new Date('2026-06-25T00:00:00Z'),
  });
  mockedFindStageByName.mockResolvedValue({
    id: 'stage-qualified',
    pipeline_id: 'pipeline-1',
    name: 'Qualified',
    position: 2,
    is_terminal_won: false,
    is_terminal_lost: false,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T00:00:00Z',
  });
  mockedProposeAgentAction.mockResolvedValue({
    policy: { outcome: 'require_approval', reason: 'Action requires human approval', assignTo: 'user-1' },
    action: null,
  });
  mockedInvalidateProfileCache.mockResolvedValue(undefined);
  mockedCancelPendingOutreachJobs.mockResolvedValue(0);
  mockedEnqueueAiCreateInboxItem.mockResolvedValue(undefined);
  mockedEnqueueAiClassifyReply.mockResolvedValue(undefined);
});

describe('classifyInboundReply', () => {
  it('returns classification on the happy path', async () => {
    const output = makeAiOutput();
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'I am interested.',
    });

    expect(result.intent_class).toBe('interested');
    expect(result.confidence).toBe(92);
    expect(result.requires_human_review).toBe(false);
    expect(mockedIncAiTokens).toHaveBeenCalledWith('reply_classify', 42);
    expect(mockedIncAiReplyClassified).toHaveBeenCalledWith('interested');
    expect(mockedUpsertConversationSummary).toHaveBeenCalled();
    expect(mockedInsertDecisionLog).toHaveBeenCalled();
  });

  it('throws when lead is not found', async () => {
    mockedFindLeadById.mockResolvedValue(null);

    await expect(
      classifyInboundReply({
        leadId,
        channel: 'email',
        messageText: 'Hello.',
      }),
    ).rejects.toThrow(`Lead not found: ${leadId}`);
  });

  it('returns fallback classification when OpenAI fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('OpenAI timeout'));
    mockedOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create } },
        }) as unknown as OpenAI,
    );

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'stop contacting me',
    });

    expect(result.intent_class).toBe('opt_out');
    expect(result.requires_human_review).toBe(true);
    expect(result.should_stop_sequence).toBe(true);
    expect(mockedInsertDecisionLog).toHaveBeenCalled();
  });

  it('continues when the failure decision log write also fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('OpenAI timeout'));
    mockedOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create } },
        }) as unknown as OpenAI,
    );
    mockedInsertDecisionLog.mockRejectedValue(new Error('db down'));

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'stop contacting me',
    });

    expect(result.intent_class).toBe('opt_out');
    expect(mockedInsertDecisionLog).toHaveBeenCalled();
  });

  it('returns fallback neutral classification when non-opt-out message fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('OpenAI timeout'));
    mockedOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create } },
        }) as unknown as OpenAI,
    );

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Just checking in.',
    });

    expect(result.intent_class).toBe('neutral');
    expect(result.next_best_action).toBe('request_review');
    expect(result.should_stop_sequence).toBe(false);
  });

  it('logs and returns fallback when OpenAI fails with a non-Error value', async () => {
    const create = jest.fn().mockRejectedValue('OpenAI timeout');
    mockedOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create } },
        }) as unknown as OpenAI,
    );

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Just checking in.',
    });

    expect(result.intent_class).toBe('neutral');
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'ai reply: OpenAI call failed',
      expect.objectContaining({ leadId, error: 'OpenAI timeout' }),
    );
  });

  it('returns fallback when AI config is missing', async () => {
    mockedGetAiConfig.mockResolvedValue(null);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Hello.',
    });

    expect(result.intent_class).toBe('neutral');
    expect(mockedOpenAI).not.toHaveBeenCalled();
  });

  it('stops outreach and routes opt_out to inbox', async () => {
    const output = makeAiOutput({
      intent_class: 'opt_out',
      should_stop_sequence: true,
      confidence: 95,
    });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Unsubscribe me.',
    });

    expect(result.intent_class).toBe('opt_out');
    expect(result.requires_human_review).toBe(true);
    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledWith({ leadId });
    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalled();
  });

  it('routes meeting_request to inbox with urgent_reply type', async () => {
    const output = makeAiOutput({
      intent_class: 'meeting_request',
      confidence: 95,
    });
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Can we meet tomorrow?',
    });

    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: 'urgent_reply', expiresInHours: 1 }),
    );
  });

  it('routes pricing_question to inbox with pricing_inquiry type', async () => {
    const output = makeAiOutput({
      intent_class: 'pricing_question',
      confidence: 80,
    });
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'What is the price?',
    });

    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: 'pricing_inquiry', expiresInHours: 2 }),
    );
  });

  it('does not route to inbox when confidence is high in autopilot mode', async () => {
    const output = makeAiOutput({ confidence: 95 });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'I am interested.',
    });

    expect(result.requires_human_review).toBe(false);
    expect(mockedEnqueueAiCreateInboxItem).not.toHaveBeenCalled();
  });

  it('routes to inbox under confidence threshold', async () => {
    const output = makeAiOutput({ confidence: 50 });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Maybe.',
    });

    expect(result.requires_human_review).toBe(true);
    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalled();
  });

  it('routes to inbox in supervised mode', async () => {
    mockedGetLeadCampaignContext.mockResolvedValue({
      assignedTo: 'user-1',
      campaignId,
      autonomyLevel: 'supervised',
      aiMinConfidence: 70,
    });
    const output = makeAiOutput({ confidence: 95 });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'I am interested.',
    });

    expect(result.requires_human_review).toBe(true);
    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalled();
  });

  it('does not move lead stage when update_stage_to is null', async () => {
    const output = makeAiOutput({ update_stage_to: null });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Just saying hi.',
    });

    expect(result.update_stage_to).toBeNull();
    expect(mockedProposeAgentAction).not.toHaveBeenCalled();
  });

  it('proposes a typed stage movement action when update_stage_to is present', async () => {
    const output = makeAiOutput({ update_stage_to: 'Qualified' });
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Yes, qualify me.',
    });

    expect(mockedFindStageByName).toHaveBeenCalledWith('Qualified');
    expect(mockedProposeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ai_reply',
        actionName: 'pipeline.move_lead',
        actor: expect.objectContaining({ id: 'user-1', role: 'sales' }),
        assignTo: 'user-1',
        confidence: 92,
        autonomyLevel: 'autopilot',
        aiMinConfidence: 70,
        args: { leadId, stageId: 'stage-qualified' },
      }),
    );
  });

  it('continues when stage movement proposal fails', async () => {
    const output = makeAiOutput({ update_stage_to: 'Qualified' });
    mockOpenAICompletion(output);
    mockedProposeAgentAction.mockRejectedValue(new Error('policy unavailable'));

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Yes.',
    });

    expect(result.intent_class).toBe('interested');
    expect(mockedProposeAgentAction).toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'ai reply: stage move proposal failed',
      expect.objectContaining({ leadId, stage: 'Qualified', error: 'policy unavailable' }),
    );
  });

  it('persists objection and buying signal when provided', async () => {
    const output = makeAiOutput({
      intent_class: 'objection',
      objection_type: 'price',
      buying_signal: 'budget confirmed',
      confidence: 50,
    });
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'It is too expensive.',
    });

    expect(mockedAppendObjectionToProfile).toHaveBeenCalledWith(leadId, 'price', 'It is too expensive.');
    expect(mockedAppendBuyingSignalToProfile).toHaveBeenCalledWith(leadId, 'budget confirmed');
    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: 'objection_review' }),
    );
  });

  it('does not route to inbox when assigned user is missing', async () => {
    mockedGetLeadCampaignContext.mockResolvedValue({
      assignedTo: null,
      campaignId,
      autonomyLevel: 'autopilot',
      aiMinConfidence: 70,
    });
    const output = makeAiOutput({
      intent_class: 'meeting_request',
      confidence: 95,
    });
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Can we meet?',
    });

    expect(result.requires_human_review).toBe(true);
    expect(mockedEnqueueAiCreateInboxItem).not.toHaveBeenCalled();
  });

  it('continues when final decision log write fails', async () => {
    mockedInsertDecisionLog.mockRejectedValue(new Error('db down'));
    const output = makeAiOutput();
    mockOpenAICompletion(output);

    const result = await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'I am interested.',
    });

    expect(result.intent_class).toBe('interested');
  });

  it('uses baseUrl from AI config when provided', async () => {
    mockedGetAiConfig.mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://custom.openai.example.com/v1',
      model: 'gpt-4o-mini',
      maxTokens: 300,
      temperature: 0.2,
      systemPromptOverride: null,
      cacheTtlSeconds: 300,
    });
    const output = makeAiOutput();
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Hello.',
    });

    expect(mockedOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://custom.openai.example.com/v1' }),
    );
  });

  it('uses environment API key when config key is empty', async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-key';
    mockedGetAiConfig.mockResolvedValue({
      apiKey: '',
      baseUrl: null,
      model: 'gpt-4o-mini',
      maxTokens: 300,
      temperature: 0.2,
      systemPromptOverride: null,
      cacheTtlSeconds: 300,
    });
    const output = makeAiOutput();
    mockOpenAICompletion(output);

    await classifyInboundReply({
      leadId,
      channel: 'email',
      messageText: 'Hello.',
    });

    expect(mockedOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'env-key' }));
    process.env.OPENAI_API_KEY = originalKey;
  });

});

describe('getReplyHistory', () => {
  it('returns items and total from repository', async () => {
    const rows = [
      { id: 'd1', lead_id: leadId, decision: 'interested', confidence: 90 },
      { id: 'd2', lead_id: leadId, decision: 'objection', confidence: 70 },
    ] as unknown as AiDecisionLogRow[];
    mockedListDecisionLogs.mockResolvedValue({ rows, total: 2 });

    const result = await getReplyHistory({ limit: 10, offset: 0 });

    expect(result).toEqual({ items: rows, total: 2 });
    expect(mockedListDecisionLogs).toHaveBeenCalledWith({
      decisionType: 'reply_classify',
      limit: 10,
      offset: 0,
    });
  });

  it('passes leadId, campaignId, and classification through to the repository as SQL filters', async () => {
    const rows = [
      { id: 'd1', lead_id: leadId, campaign_id: campaignId, decision: 'interested' },
    ] as unknown as AiDecisionLogRow[];
    mockedListDecisionLogs.mockResolvedValue({ rows, total: 1 });

    const result = await getReplyHistory({
      leadId,
      campaignId,
      classification: 'interested',
      limit: 10,
      offset: 0,
    });

    expect(mockedListDecisionLogs).toHaveBeenCalledWith({
      decisionType: 'reply_classify',
      leadId,
      campaignId,
      decision: 'interested',
      limit: 10,
      offset: 0,
    });
    expect(result).toEqual({ items: rows, total: 1 });
  });

  it('returns empty items when repository has no rows', async () => {
    mockedListDecisionLogs.mockResolvedValue({ rows: [], total: 0 });

    const result = await getReplyHistory({ limit: 10, offset: 0 });

    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe('triggerClassification', () => {
  it('enqueues a classify reply job', async () => {
    const input: ClassifyReplyInput = {
      leadId,
      channel: 'whatsapp',
      messageText: 'Call me.',
      externalMessageId: 'msg-123',
    };

    await triggerClassification(input);

    expect(mockedEnqueueAiClassifyReply).toHaveBeenCalledWith({
      leadId,
      channel: 'whatsapp',
      messageText: 'Call me.',
      externalMessageId: 'msg-123',
    });
  });
});

describe('classifyReply', () => {
  it('classifies an inbound reply directly', async () => {
    const output = makeAiOutput();
    mockOpenAICompletion(output);

    const result = await classifyReply({
      leadId,
      channel: 'sms',
      messageText: 'Yes please.',
    });

    expect(result.intent_class).toBe('interested');
    expect(result.confidence).toBe(92);
  });
});
