import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { Sentry } from '../../shared/utils/sentry';
import { incAiTokens } from '../../shared/utils/metrics';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findLeadById } from '../leads/leads.repository';
import {
  findAiProfileByLeadId,
  upsertAiProfile,
  setEnrichmentStatus,
  insertDecisionLog,
  listDecisionLogsByLead,
  listDecisionLogs,
  updateNextBestAction,
} from './ai-intelligence.repository';
import { NotFoundError } from '../../shared/errors';
import { getAiProfile, researchLead, invalidateProfileCache, getLeadDecisions, getDecisions, computeNextBestAction } from './ai-intelligence.service';

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

jest.mock('../../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
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
  listDecisionLogsByLead: jest.fn(),
  listDecisionLogs: jest.fn(),
  updateNextBestAction: jest.fn(),
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
    (listDecisionLogsByLead as jest.Mock).mockReset();
    (listDecisionLogs as jest.Mock).mockReset();
    (updateNextBestAction as jest.Mock).mockReset();
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

  describe('getLeadDecisions', () => {
    it('returns decision logs and total for a lead', async () => {
      const rows = [{ id: 'd1', decision_type: 'research' }, { id: 'd2', decision_type: 'next_action' }];
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows, total: 2 });

      const result = await getLeadDecisions('l1', 10, 0);

      expect(listDecisionLogsByLead).toHaveBeenCalledWith('l1', 10, 0);
      expect(result).toEqual({ items: rows, total: 2 });
    });
  });

  describe('getDecisions', () => {
    it('returns all decision logs with pagination when no filter', async () => {
      const rows = [{ id: 'd1', decision_type: 'research' }];
      (listDecisionLogs as jest.Mock).mockResolvedValueOnce({ rows, total: 1 });

      const result = await getDecisions({ limit: 5, offset: 0 });

      expect(listDecisionLogs).toHaveBeenCalledWith({ limit: 5, offset: 0 });
      expect(result).toEqual({ items: rows, total: 1 });
    });

    it('passes decisionType filter to repository', async () => {
      const rows = [{ id: 'd3', decision_type: 'campaign_brief' }];
      (listDecisionLogs as jest.Mock).mockResolvedValueOnce({ rows, total: 1 });

      const result = await getDecisions({ decisionType: 'campaign_brief', limit: 5, offset: 10 });

      expect(listDecisionLogs).toHaveBeenCalledWith({ decisionType: 'campaign_brief', limit: 5, offset: 10 });
      expect(result).toEqual({ items: rows, total: 1 });
    });
  });

  describe('computeNextBestAction', () => {
    function validNextActionResponse() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                next_best_action: 'send_whatsapp',
                next_best_action_reason: 'Lead is reachable and prefers WhatsApp.',
                next_best_action_confidence: 92,
              }),
            },
          },
        ],
        usage: { total_tokens: 60 },
      };
    }

    it('returns cached next best action when profile exists and force is false', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      const result = await computeNextBestAction('l1');
      expect(result).toEqual({
        action: 'send_email',
        reason: 'reason',
        confidence: 85,
      });
      expect(findLeadById).not.toHaveBeenCalled();
      expect(updateNextBestAction).not.toHaveBeenCalled();
    });

    it('returns cached next best action with default reason and confidence when profile fields are null', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce({
        ...profile,
        next_best_action: 'send_email',
        next_best_action_reason: null,
        next_best_action_confidence: null,
      });
      const result = await computeNextBestAction('l1');
      expect(result).toEqual({
        action: 'send_email',
        reason: '',
        confidence: 0,
      });
    });

    it('recomputes next best action when force=true even if cached', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(profile);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const mockCreate = jest.fn().mockResolvedValueOnce(validNextActionResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      const updatedProfile = { ...profile, next_best_action: 'send_whatsapp' };
      (updateNextBestAction as jest.Mock).mockResolvedValueOnce(updatedProfile);

      const result = await computeNextBestAction('l1', { force: true });
      expect(result.action).toBe('send_whatsapp');
      expect(updateNextBestAction).toHaveBeenCalledWith(
        'l1',
        'send_whatsapp',
        'Lead is reachable and prefers WhatsApp.',
        92,
      );
      expect(redis.del).toHaveBeenCalledWith('ai:profile:l1');
    });

    it('throws NotFoundError when lead is not found', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(null);
      await expect(computeNextBestAction('l1')).rejects.toThrow(NotFoundError);
      await expect(computeNextBestAction('l1')).rejects.toThrow('Lead not found: l1');
    });

    it('throws when AI config is missing', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(null);
      await expect(computeNextBestAction('l1')).rejects.toThrow('AI not configured');
    });

    it('completes full success path with OpenAI and persists result', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const mockCreate = jest.fn().mockResolvedValueOnce(validNextActionResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      const updatedProfile = {
        ...profile,
        next_best_action: 'send_whatsapp',
        next_best_action_reason: 'Lead is reachable and prefers WhatsApp.',
        next_best_action_confidence: 92,
      };
      (updateNextBestAction as jest.Mock).mockResolvedValueOnce(updatedProfile);

      const result = await computeNextBestAction('l1');
      expect(result).toEqual({
        action: 'send_whatsapp',
        reason: 'Lead is reachable and prefers WhatsApp.',
        confidence: 92,
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
        }),
      );
      expect(updateNextBestAction).toHaveBeenCalledWith(
        'l1',
        'send_whatsapp',
        'Lead is reachable and prefers WhatsApp.',
        92,
      );
      expect(redis.del).toHaveBeenCalledWith('ai:profile:l1');
      expect(logger.info).toHaveBeenCalledWith(
        'ai next action: computed next best action',
        expect.any(Object),
      );
    });

    it('throws when Zod validation fails on OpenAI response', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const badResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                next_best_action: 'invalid_action',
                next_best_action_reason: 'reason',
                next_best_action_confidence: 50,
              }),
            },
          },
        ],
        usage: { total_tokens: 40 },
      };
      const mockCreate = jest.fn().mockResolvedValueOnce(badResponse);
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      await expect(computeNextBestAction('l1')).rejects.toThrow();
    });

    it('logs and re-throws on OpenAI API error', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const mockCreate = jest.fn().mockRejectedValueOnce(new Error('rate limit'));
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      await expect(computeNextBestAction('l1')).rejects.toThrow('rate limit');
      expect(logger.error).toHaveBeenCalledWith(
        'ai next action: failed to compute next best action',
        expect.any(Object),
      );
    });

    it('logs and re-throws when computeNextBestAction fails with a non-Error value', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const mockCreate = jest.fn().mockRejectedValueOnce('rate limit');
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      await expect(computeNextBestAction('l1')).rejects.toBe('rate limit');
      expect(logger.error).toHaveBeenCalledWith(
        'ai next action: failed to compute next best action',
        expect.objectContaining({ leadId: 'l1', error: 'rate limit' }),
      );
    });

    it('logs and re-throws on repository error', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      (listDecisionLogsByLead as jest.Mock).mockResolvedValueOnce({ rows: [], total: 0 });
      const mockCreate = jest.fn().mockResolvedValueOnce(validNextActionResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (updateNextBestAction as jest.Mock).mockRejectedValueOnce(new Error('db down'));

      await expect(computeNextBestAction('l1')).rejects.toThrow('db down');
      expect(logger.error).toHaveBeenCalledWith(
        'ai next action: failed to compute next best action',
        expect.any(Object),
      );
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

    it('logs at error level and forwards to Sentry (no swallow) when decision log write fails on success path', async () => {
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
      expect(logger.warn).not.toHaveBeenCalledWith(
        'ai research: failed to write decision log',
        expect.anything(),
      );
      expect(logger.error).toHaveBeenCalledWith(
        'ai decision log write failed',
        expect.objectContaining({
          lead_id: 'l1',
          decision_type: 'research',
          phase: 'success',
          error: 'db down',
        }),
      );
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            decision_type: 'research',
            decision_log_phase: 'success',
          }),
          extra: expect.objectContaining({ lead_id: 'l1' }),
        }),
      );
    });

    it('handles a non-Error decision-log write failure without throwing', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockResolvedValueOnce(validOpenAIResponse());
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      (upsertAiProfile as jest.Mock).mockResolvedValueOnce(profile);
      (insertDecisionLog as jest.Mock).mockRejectedValueOnce('db down');

      const result = await researchLead('l1');
      expect(result).toEqual(profile);
      expect(logger.error).toHaveBeenCalledWith(
        'ai decision log write failed',
        expect.objectContaining({ lead_id: 'l1', error: 'db down' }),
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

    it('logs at error level and forwards to Sentry (no silent null) when failure-phase decision log write fails', async () => {
      (findAiProfileByLeadId as jest.Mock).mockResolvedValueOnce(null);
      (findLeadById as jest.Mock).mockResolvedValueOnce(lead);
      (getAiConfig as jest.Mock).mockResolvedValueOnce(aiConfig);
      const mockCreate = jest.fn().mockRejectedValueOnce(new Error('rate limit'));
      MockedOpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));
      // Failure-phase decision log write itself rejects
      (insertDecisionLog as jest.Mock).mockRejectedValueOnce(new Error('audit db down'));

      await expect(researchLead('l1')).rejects.toThrow('rate limit');
      expect(logger.error).toHaveBeenCalledWith(
        'ai decision log write failed',
        expect.objectContaining({
          lead_id: 'l1',
          decision_type: 'research',
          phase: 'failure',
          error: 'audit db down',
        }),
      );
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            decision_type: 'research',
            decision_log_phase: 'failure',
          }),
        }),
      );
    });
  });
});
