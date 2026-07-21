import { type LeadRow } from '../leads/leads.types';
import { type TemplateRow } from '../templates/templates.types';

jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
  },
}));

jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock the AI settings service so tests don't hit the database.
// By default returns a config with empty apiKey so process.env.OPENAI_API_KEY is used.
jest.mock('../ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn(),
}));

import { redis } from '../../shared/utils/redis';
import OpenAI from 'openai';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { personalizeMessage } from './outreach.prompt';

const MockedOpenAI = OpenAI as unknown as jest.Mock;
const mockRedisGet = redis.get as jest.MockedFunction<typeof redis.get>;
const mockRedisSetex = redis.setex as jest.MockedFunction<typeof redis.setex>;

const leadFixture = (): LeadRow => ({
  id: 'lead-1',
  business_name: 'Acme Corp',
  contact_name: 'Alice',
  phone: '+1234567890',
  email: 'alice@acme.com',
  website: 'https://acme.com',
  industry: 'Software',
  location: 'New York',
  country: 'USA',
  google_rating: '4.5',
  review_count: 120,
  social_links: null,
  source_platform: 'Google',
  lead_score: 85,
  classification: 'hot',
  status: 'active',
  assigned_to: null,
  pipeline_stage_id: null,
  custom_fields: {},
  tags: ['enterprise', 'saas'],
  notes: null,
  deal_value: null,
  won_at: null,
  lost_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  scraper_log_id: null,
});

const templateFixture = (): TemplateRow => ({
  id: 'tmpl-1',
  name: 'Intro',
  channel: 'email',
  subject: 'Hello {business_name}',
  body: 'Hi {business_name}, we noticed your {industry} business in {location}.',
  variables: ['business_name', 'industry', 'location'],
  approval_status: 'approved',
  approved_by: 'admin-1',
  approved_at: '2026-01-01T00:00:00Z',
  rejection_reason: null,
  attachments: [],
  created_by: 'admin-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('personalizeMessage', () => {
  // A base AI config with empty apiKey — lets tests control the key via
  // process.env.OPENAI_API_KEY or by overriding getAiConfig per-test.
  const baseAiConfig = {
    apiKey: '',
    baseUrl: null,
    model: 'gpt-4o',
    maxTokens: 500,
    temperature: 0.7,
    systemPromptOverride: null,
    cacheTtlSeconds: 7 * 24 * 60 * 60,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    // Default: AI settings are configured but no embedded key (env var used instead)
    (getAiConfig as jest.Mock).mockResolvedValue(baseAiConfig);
  });

  test('returns cached message on cache hit', async () => {
    mockRedisGet.mockResolvedValue('cached message');

    const result = await personalizeMessage(leadFixture(), templateFixture());

    expect(result.message).toBe('cached message');
    expect(result.cacheHit).toBe(true);
    expect(result.tokensUsed).toBe(0);
    expect(mockRedisGet).toHaveBeenCalledWith('ai:msg:lead-1:tmpl-1');
  });

  test('falls back to template substitution when OPENAI_API_KEY is missing', async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await personalizeMessage(leadFixture(), templateFixture());

    expect(result.cacheHit).toBe(false);
    expect(result.message).toContain('Acme Corp');
    expect(result.message).toContain('Software');
    expect(result.message).toContain('New York');
    expect(mockRedisSetex).not.toHaveBeenCalled();
  });

  test('strips remaining unmatched placeholders in fallback', async () => {
    mockRedisGet.mockResolvedValue(null);

    const tpl: TemplateRow = {
      ...templateFixture(),
      body: 'Hello {unknown_var} from {business_name}',
    };

    const result = await personalizeMessage(leadFixture(), tpl);

    expect(result.message).toContain('Acme Corp');
    expect(result.message).not.toContain('{unknown_var}');
  });

  test('caches OpenAI result for 7 days', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mockRedisGet.mockResolvedValue(null);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '  AI generated text  ' } }],
      usage: { total_tokens: 42 },
    });

    MockedOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));

    const result = await personalizeMessage(leadFixture(), templateFixture());

    expect(result.message).toBe('AI generated text');
    expect(result.tokensUsed).toBe(42);
    expect(result.cacheHit).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        max_tokens: 500,
        temperature: 0.7,
        messages: expect.any(Array),
      }),
    );
    expect(mockRedisSetex).toHaveBeenCalledWith(
      'ai:msg:lead-1:tmpl-1',
      7 * 24 * 60 * 60,
      'AI generated text',
    );
  });

  test('falls back to template substitution on OpenAI error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mockRedisGet.mockResolvedValue(null);

    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('timeout')),
        },
      },
    }));

    const result = await personalizeMessage(leadFixture(), templateFixture());

    expect(result.cacheHit).toBe(false);
    expect(result.message).toContain('Acme Corp');
  });

  test('does not include PII keys in prompt context', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mockRedisGet.mockResolvedValue(null);

    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 1 },
    });

    MockedOpenAI.mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));

    await personalizeMessage(leadFixture(), templateFixture());

    const call = mockCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = call.messages.find((m) => m.role === 'user')!.content;
    expect(userMsg).not.toContain('alice@acme.com');
    expect(userMsg).not.toContain('+1234567890');
    expect(userMsg).not.toContain('Alice');
    expect(userMsg).toContain('Acme Corp');
  });
});
