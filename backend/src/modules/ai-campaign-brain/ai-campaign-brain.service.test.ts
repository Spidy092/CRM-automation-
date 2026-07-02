import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { incAiTokens } from '../../shared/utils/metrics';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { enqueueAiCreateInboxItem } from '../../workers/queue';
import {
  generateCampaignBrief,
  getCampaignBrief,
  approveCampaignBrief,
  rejectCampaignBrief,
} from './ai-campaign-brain.service';
import {
  upsertCampaignBrief,
  getCampaignLeadStats,
  findBriefByCampaignId,
  approveBrief,
  rejectBrief,
} from './ai-campaign-brain.repository';
import type { CampaignBrief, AiCampaignBriefOutput } from './ai-campaign-brain.types';

jest.mock('./ai-campaign-brain.repository');
jest.mock('../ai-settings/ai-settings.service');
jest.mock('../ai-intelligence/ai-intelligence.repository');
jest.mock('../../shared/utils/logger');
jest.mock('../../shared/utils/metrics');
jest.mock('../../workers/queue', () => ({
  enqueueAiCreateInboxItem: jest.fn(),
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedRepo = {
  upsertCampaignBrief: upsertCampaignBrief as jest.MockedFunction<typeof upsertCampaignBrief>,
  getCampaignLeadStats: getCampaignLeadStats as jest.MockedFunction<typeof getCampaignLeadStats>,
  findBriefByCampaignId: findBriefByCampaignId as jest.MockedFunction<typeof findBriefByCampaignId>,
  approveBrief: approveBrief as jest.MockedFunction<typeof approveBrief>,
  rejectBrief: rejectBrief as jest.MockedFunction<typeof rejectBrief>,
};

const mockedGetAiConfig = getAiConfig as jest.MockedFunction<typeof getAiConfig>;
const mockedInsertDecisionLog = insertDecisionLog as jest.MockedFunction<typeof insertDecisionLog>;
const mockedEnqueueAiCreateInboxItem = enqueueAiCreateInboxItem as jest.MockedFunction<
  typeof enqueueAiCreateInboxItem
>;
const mockedIncAiTokens = incAiTokens as jest.MockedFunction<typeof incAiTokens>;
const mockedLogger = logger as unknown as {
  info: jest.Mock;
  error: jest.Mock;
};

const CAMPAIGN_ID = '019f079c-f429-762a-89ab-d143218efd4e';
const USER_ID = 'user-019f079c-f429-762a-89ab-d143218efd4e';

const baseBrief: CampaignBrief = {
  id: 'brief-1',
  campaign_id: CAMPAIGN_ID,
  total_leads_evaluated: 100,
  eligible_leads: 80,
  high_fit_leads: 30,
  segment_summary: 'SMBs in logistics',
  recommended_offer_angle: 'Save 20% on fleet insurance',
  expected_objections: ['Too expensive'],
  risk_warnings: ['Seasonal demand'],
  recommended_sequence: [
    { step_number: 1, channel: 'email', delay_hours: 0, goal: 'Introduce offer' },
  ],
  template_suggestions: [
    { channel: 'email', subject: 'Fleet insurance offer', body_preview: 'Hi...' },
  ],
  recommended_autonomy_level: 'guarded',
  confidence_score: 85,
  status: 'draft',
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

const campaignStats = {
  campaign: {
    id: CAMPAIGN_ID,
    name: 'Fleet Insurance Q3',
    target_industries: ['logistics'],
    tone: 'professional',
  },
  totalLeads: 100,
  eligibleLeads: 80,
  highFitLeads: 30,
  topPainPoints: ['high premiums', 'slow claims'],
};

const aiConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'http://localhost:1234',
  model: 'gpt-4o-mini',
  maxTokens: 500,
  temperature: 0.3,
  systemPromptOverride: null,
  cacheTtlSeconds: 0,
};

const rawOpenAiOutput: AiCampaignBriefOutput = {
  segment_summary: 'SMBs in logistics paying too much for fleet insurance.',
  recommended_offer_angle: 'Save 20% on fleet insurance with a 5-minute quote.',
  expected_objections: ['Too expensive', 'Switching is a hassle'],
  risk_warnings: ['Seasonal demand swings'],
  recommended_sequence: [
    { step_number: 1, channel: 'email', delay_hours: 0, goal: 'Introduce offer' },
    { step_number: 2, channel: 'sms', delay_hours: 48, goal: 'Remind to book call' },
  ],
  template_suggestions: [
    { channel: 'email', subject: 'Fleet insurance offer', body_preview: 'Hi...' },
  ],
  recommended_autonomy_level: 'guarded',
  confidence_score: 85,
  chain_of_thought: 'Segment is price-sensitive → lead with savings → guarded autonomy.',
};

const openAiCreateMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (OpenAI as unknown as jest.Mock).mockImplementation(
    () =>
      ({
        chat: {
          completions: {
            create: openAiCreateMock,
          },
        },
      } as unknown as OpenAI),
  );
});

describe('getCampaignBrief', () => {
  it('returns the brief from the repository', async () => {
    mockedRepo.findBriefByCampaignId.mockResolvedValue(baseBrief);

    const result = await getCampaignBrief(CAMPAIGN_ID);

    expect(mockedRepo.findBriefByCampaignId).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(result).toEqual(baseBrief);
  });

  it('returns null when no brief exists', async () => {
    mockedRepo.findBriefByCampaignId.mockResolvedValue(null);

    const result = await getCampaignBrief(CAMPAIGN_ID);

    expect(result).toBeNull();
  });
});

describe('approveCampaignBrief', () => {
  it('approves an existing brief and returns the updated row', async () => {
    const approved: CampaignBrief = { ...baseBrief, status: 'approved', approved_by: USER_ID };
    mockedRepo.findBriefByCampaignId
      .mockResolvedValueOnce(baseBrief)
      .mockResolvedValueOnce(approved);
    mockedRepo.approveBrief.mockResolvedValue(undefined);

    const result = await approveCampaignBrief(CAMPAIGN_ID, USER_ID);

    expect(mockedRepo.findBriefByCampaignId).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(mockedRepo.approveBrief).toHaveBeenCalledWith(CAMPAIGN_ID, USER_ID);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'ai campaign brain: brief approved',
      expect.objectContaining({ campaignId: CAMPAIGN_ID, approvedBy: USER_ID }),
    );
    expect(result).toEqual(approved);
  });

  it('throws when the brief does not exist', async () => {
    mockedRepo.findBriefByCampaignId.mockResolvedValue(null);

    await expect(approveCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow(
      `Campaign brief not found: ${CAMPAIGN_ID}`,
    );
    expect(mockedRepo.approveBrief).not.toHaveBeenCalled();
  });
});

describe('rejectCampaignBrief', () => {
  it('rejects an existing brief and returns the updated row', async () => {
    const rejected: CampaignBrief = { ...baseBrief, status: 'rejected' };
    mockedRepo.findBriefByCampaignId
      .mockResolvedValueOnce(baseBrief)
      .mockResolvedValueOnce(rejected);
    mockedRepo.rejectBrief.mockResolvedValue(undefined);

    const result = await rejectCampaignBrief(CAMPAIGN_ID);

    expect(mockedRepo.findBriefByCampaignId).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(mockedRepo.rejectBrief).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'ai campaign brain: brief rejected',
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
    );
    expect(result).toEqual(rejected);
  });

  it('throws when the brief does not exist', async () => {
    mockedRepo.findBriefByCampaignId.mockResolvedValue(null);

    await expect(rejectCampaignBrief(CAMPAIGN_ID)).rejects.toThrow(
      `Campaign brief not found: ${CAMPAIGN_ID}`,
    );
    expect(mockedRepo.rejectBrief).not.toHaveBeenCalled();
  });
});

describe('generateCampaignBrief', () => {
  beforeEach(() => {
    mockedRepo.getCampaignLeadStats.mockResolvedValue(campaignStats);
    mockedGetAiConfig.mockResolvedValue(aiConfig);
    mockedRepo.upsertCampaignBrief.mockResolvedValue(baseBrief);
    mockedInsertDecisionLog.mockResolvedValue({ id: 'log-1' } as any);
    mockedEnqueueAiCreateInboxItem.mockResolvedValue(undefined);
  });

  function mockValidOpenAiResponse() {
    openAiCreateMock.mockResolvedValue({
      usage: { total_tokens: 123 },
      choices: [
        {
          message: {
            content: JSON.stringify(rawOpenAiOutput),
          },
        },
      ],
    });
  }

  it('fetches stats, calls OpenAI, persists the brief, and returns it', async () => {
    mockValidOpenAiResponse();

    const result = await generateCampaignBrief(CAMPAIGN_ID, USER_ID);

    expect(mockedRepo.getCampaignLeadStats).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(openAiCreateMock).toHaveBeenCalledTimes(1);
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: aiConfig.model,
        response_format: { type: 'json_object' },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
      }),
    );
    expect(mockedIncAiTokens).toHaveBeenCalledWith('campaign_brief', 123);
    expect(mockedRepo.upsertCampaignBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: CAMPAIGN_ID,
        total_leads_evaluated: campaignStats.totalLeads,
        eligible_leads: campaignStats.eligibleLeads,
        high_fit_leads: campaignStats.highFitLeads,
        segment_summary: rawOpenAiOutput.segment_summary,
        recommended_offer_angle: rawOpenAiOutput.recommended_offer_angle,
        recommended_autonomy_level: rawOpenAiOutput.recommended_autonomy_level,
        confidence_score: rawOpenAiOutput.confidence_score,
      }),
    );
    expect(mockedEnqueueAiCreateInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedTo: USER_ID,
        campaignId: CAMPAIGN_ID,
        itemType: 'campaign_review',
        title: `AI brief ready: ${campaignStats.campaign.name}`,
      }),
    );
    expect(mockedInsertDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: null,
        campaign_id: CAMPAIGN_ID,
        decision_type: 'campaign_brief',
        decision: rawOpenAiOutput.recommended_autonomy_level,
        confidence: rawOpenAiOutput.confidence_score,
        tokens_used: 123,
        model_used: aiConfig.model,
      }),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'ai campaign brain: brief generated',
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
    );
    expect(result).toEqual(baseBrief);
  });

  it('throws when the campaign cannot be found', async () => {
    mockedRepo.getCampaignLeadStats.mockResolvedValue(null);

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow(
      `Campaign not found: ${CAMPAIGN_ID}`,
    );
    expect(openAiCreateMock).not.toHaveBeenCalled();
    expect(mockedRepo.upsertCampaignBrief).not.toHaveBeenCalled();
  });

  it('throws when AI is not configured', async () => {
    mockedGetAiConfig.mockResolvedValue(null);

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow(
      'AI not configured — cannot generate campaign brief',
    );
    expect(openAiCreateMock).not.toHaveBeenCalled();
    expect(mockedRepo.upsertCampaignBrief).not.toHaveBeenCalled();
  });

  it('logs and re-throws when OpenAI fails', async () => {
    const networkError = new Error('OpenAI request timed out');
    openAiCreateMock.mockRejectedValue(networkError);

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow(networkError);

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'ai campaign brain: OpenAI call failed',
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
    );
    expect(mockedInsertDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: CAMPAIGN_ID,
        decision_type: 'campaign_brief',
        decision: 'failed',
        model_used: aiConfig.model,
      }),
    );
    expect(mockedRepo.upsertCampaignBrief).not.toHaveBeenCalled();
    expect(mockedEnqueueAiCreateInboxItem).not.toHaveBeenCalled();
  });

  it('logs and re-throws when OpenAI returns invalid JSON', async () => {
    openAiCreateMock.mockResolvedValue({
      usage: { total_tokens: 50 },
      choices: [{ message: { content: 'not-json' } }],
    });

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'ai campaign brain: OpenAI call failed',
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
    );
    expect(mockedInsertDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: CAMPAIGN_ID,
        decision_type: 'campaign_brief',
        decision: 'failed',
      }),
    );
    expect(mockedRepo.upsertCampaignBrief).not.toHaveBeenCalled();
  });

  it('logs and re-throws when OpenAI returns content that fails schema validation', async () => {
    const invalidOutput = { ...rawOpenAiOutput, confidence_score: 101 };
    openAiCreateMock.mockResolvedValue({
      usage: { total_tokens: 50 },
      choices: [{ message: { content: JSON.stringify(invalidOutput) } }],
    });

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toThrow();

    expect(mockedInsertDecisionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: CAMPAIGN_ID,
        decision_type: 'campaign_brief',
        decision: 'failed',
      }),
    );
    expect(mockedRepo.upsertCampaignBrief).not.toHaveBeenCalled();
  });

  it('uses environment API key when config key is empty and undefined baseURL when baseUrl is missing', async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-api-key';
    mockedGetAiConfig.mockResolvedValue({
      ...aiConfig,
      apiKey: '',
      baseUrl: null,
    });
    mockValidOpenAiResponse();

    await generateCampaignBrief(CAMPAIGN_ID, USER_ID);

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'env-api-key', baseURL: undefined }),
    );

    process.env.OPENAI_API_KEY = originalKey;
  });

  it('logs and re-throws when OpenAI fails with a non-Error value', async () => {
    openAiCreateMock.mockRejectedValue('network failure');

    await expect(generateCampaignBrief(CAMPAIGN_ID, USER_ID)).rejects.toBe('network failure');

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'ai campaign brain: OpenAI call failed',
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        error: 'network failure',
      }),
    );
  });
});
