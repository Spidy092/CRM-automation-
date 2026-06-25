import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { incAiTokens } from '../../shared/utils/metrics';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findLeadById } from '../leads/leads.repository';
import {
  findAiProfileByLeadId,
  upsertAiProfile,
  setEnrichmentStatus,
  insertDecisionLog,
} from './ai-intelligence.repository';
import { getAiProfile, researchLead, invalidateProfileCache } from './ai-intelligence.service';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../shared/utils/metrics', () => ({
  incAiTokens: jest.fn(),
}));

jest.mock('../ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn(),
}));

jest.mock('../leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

jest.mock('./ai-intelligence.repository', () => ({
  findAiProfileByLeadId: jest.fn(),
  upsertAiProfile: jest.fn(),
  setEnrichmentStatus: jest.fn(),
  insertDecisionLog: jest.fn(),
}));

const MockedOpenAI = OpenAI as unknown as jest.Mock;

const lead = {
  id: 'l1',
  business_name: 'Acme',
  contact_name: 'Alice',
  phone: '+1234567890',
  email: 'alice@acme.com',
  website: 'https://acme.com',
  industry: 'Software',
  location: 'NYC',
  country: 'US',
  google_rating: '4.5',
  review_count: 120,
  social_links: null,
  source_platform: 'manual',
  lead_score: 85,
  classification: 'hot',
  status: 'active',
  assigned_to: null,
  pipeline_stage_id: null,
  custom_fields: {},
  tags: ['enterprise'],
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
};

const profile = {
  id: 'p1',
  lead_id: 'l1',
  website_quality_score: 80,
  pain_points: ['price'],
  offer_angle: 'Save money',
  inferred_budget_range: 'medium',
  buying_intent: 'high',
  reachability_score: 90,
  buying_signals: [],
  objection_log: [],
  do_not_say: [],
  preferred_channel: 'email',
  preferred_time_of_day: null,
  conversation_summary: null,
  ai_notes: 'notes',
  next_best_action: 'send_email',
  next_best_action_reason: 'reason',
  next_best_action_confidence: 85,
  enrichment_status: 'done',
  last_enriched_at: '2026-06-25T00:00:00Z',
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
};

const aiConfig = {
  apiKey: 'sk-test',
  baseUrl: null,
  model: 'gpt-4o',
  maxTokens: 500,
  temperature: 0.7,
  systemPromptOverride: null,
  cacheTtlSeconds: 3600,
};

function validOpenAIResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            pain_points: ['price'],
            offer_angle: 'Save money',
            buying_intent: 'high',
            reachability_score: 90,
            website_quality_score: 80,
            inferred_budget_range: 'medium',
            preferred_channel: 'email',
            ai_notes: 'notes',
            next_best_action: 'send_email',
            next_best_action_reason: 'reason',
            next_best_action_confidence: 85,
            chain_of_thought: 'thought',
          }),
        },
      },
    ],
    usage: { total_tokens: 100 },
  };
}

describe('ai-intelligence.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (findAiProfileByLeadId as jest.Mock).mockReset();
    (findLeadById as jest.Mock).mockReset();
    (getAiConfig as jest.Mock).mockReset();
    (upsertAiProfile as jest.Mock).mockReset();
    (setEnrichmentStatus as jest.Mock).mockResolvedValue(undefined);
    (insertDecisionLog as jest.Mock).mockReset();
    (redis.get as jest.Mock).mockResolvedValue(null);
    (redis.setex as jest.Mock).mockResolvedValue('OK');
    (redis.del as jest.Mock).mockResolvedValue(1);
    MockedOpenAI.mockReset();
  });

  describe('getAiProfile', () => {
    it('returns cached profile on cache hit', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(profile));
      const result = await getAiProfile('l1');
      expect(result).toEqual(profile);
      expect(findAiProfileByLeadId).not.toHaveBeenCalled();
    });

    it('falls back to DB on cache miss and caches result', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      const result = await getAiProfile('l1');
      expect(result).toEqual(profile);
      expect(findAiProfileByLeadId).toHaveBeenCalledWith('l1');
      expect(redis.setex).toHaveBeenCalled();
    });

    it('returns null when cache and DB both miss', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce(null);
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      const result = await getAiProfile('l1');
      expect(result).toBeNull();
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('falls back to DB when cache contains malformed JSON', async () => {
      (redis.get as jest.Mock).mockResolvedValueOnce('not-json');
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      const result = await getAiProfile('l1');
      expect(result).toEqual(profile);
    });
  });

  describe('invalidateProfileCache', () => {
    it('deletes the cache key', async () => {
      (redis.del as jest.Mock).mockResolvedValueOnce(1);
      await invalidateProfileCache('l1');
      expect(redis.del).toHaveBeenCalledWith('ai:profile:l1');
    });
  });

  describe('researchLead', () => {
    it('skips when already done and not forced', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      const result = await researchLead('l1');
      expect(result).toEqual(profile);
      expect(findLeadById).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'ai research: profile already done, skipping',
        expect.any(Object),
      );
    });

    it('forces research when force=true even if already done', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockResolvedValueOnce(validOpenAIResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (upsertAiProfile as jest.Mock).mockResolvedValueOnce(profile);
      (insertDecisionLog as jest.Mock).mockResolvedValueOnce({ id: 'd1' });

      const result = await researchLead('l1', true);
      expect(result).toEqual(profile);
      expect(findLeadById).toHaveBeenCalledWith('l1');
    });

    it('throws and marks failed when lead not found', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(null);
      await expect(researchLead('l1')).rejects.toThrow('Lead not found: l1');
      expect(setEnrichmentStatus).toHaveBeenCalledWith('l1', 'failed');
    });

    it('throws and marks failed when AI config is missing', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(null);
      await expect(researchLead('l1')).rejects.toThrow(
        'AI is disabled or not configured — cannot research lead',
      );
      expect(setEnrichmentStatus).toHaveBeenCalledWith('l1', 'failed');
    });

    it('completes full success path with OpenAI and writes decision log', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockResolvedValueOnce(validOpenAIResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (upsertAiProfile as jest.Mock).mockResolvedValueOnce(profile);
      (insertDecisionLog as jest.Mock).mockResolvedValueOnce({ id: 'd1' });

      const result = await researchLead('l1');
      expect(result).toEqual(profile);
      expect(upsertAiProfile).toHaveBeenCalled();
      expect(insertDecisionLog).toHaveBeenCalled();
      expect(incAiTokens).toHaveBeenCalledWith('research', 100);
      expect(redis.del).toHaveBeenCalledWith('ai:profile:l1');
      expect(logger.info).toHaveBeenCalledWith('ai research: complete', expect.any(Object));
    });

    it('throws when Zod validation fails on OpenAI response', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const badResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                pain_points: 'should-be-array',
              }),
            },
          },
        ],
        usage: { total_tokens: 50 },
      };
      const mockCreate = jest.fn().mockResolvedValueOnce(badResponse);
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (insertDecisionLog as jest.Mock).mockResolvedValueOnce({ id: 'd1' });

      await expect(researchLead('l1')).rejects.toThrow();
      expect(setEnrichmentStatus).toHaveBeenCalledWith('l1', 'failed');
      expect(incAiTokens).toHaveBeenCalledWith('research', 50);
    });

    it('warns but does not throw when decision log write fails on success path', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockResolvedValueOnce(validOpenAIResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (upsertAiProfile as jest.Mock).mockResolvedValueOnce(profile);
      (insertDecisionLog as jest.Mock).mockRejectedValueOnce(new Error('db down'));

      const result = await researchLead('l1');
      expect(result).toEqual(profile);
      expect(logger.warn).toHaveBeenCalledWith(
        'ai research: failed to write decision log',
        expect.any(Object),
      );
    });

    it('throws and logs on OpenAI API error', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockRejectedValueOnce(new Error('rate limit'));
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (insertDecisionLog as jest.Mock).mockResolvedValueOnce({ id: 'd1' });

      await expect(researchLead('l1')).rejects.toThrow('rate limit');
      expect(setEnrichmentStatus).toHaveBeenCalledWith('l1', 'failed');
      expect(insertDecisionLog).toHaveBeenCalled();
    });
  });
});
