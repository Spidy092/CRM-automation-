jest.mock('bullmq', () => {
  const actual = jest.requireActual('bullmq');
  return {
    ...actual,
    Worker: jest.fn().mockImplementation((_queue: unknown, processor: unknown, _opts: unknown) => {
      (global as unknown as Record<string, unknown>).__lastProcessor = processor;
      const instance: Record<string, unknown> = {
        on: jest.fn((event: string, handler: unknown) => {
          instance[`__on_${event}`] = handler;
          return instance;
        }),
      };
      (global as unknown as Record<string, unknown>).__lastWorkerInstance = instance;
      return instance;
    }),
  };
});
jest.mock('../modules/newsletter/newsletter.repository', () => ({
  findEligibleSubscribers: jest.fn(),
  findSubscriberById: jest.fn(),
  findSubscribers: jest.fn(),
  updateBroadcastStatus: jest.fn(),
  upsertRecipientOutcome: jest.fn(),
  isMissingRelationError: jest.fn(() => false),
}));
jest.mock('../modules/newsletter/newsletter.service', () => {
  const actual = jest.requireActual('../modules/newsletter/newsletter.service');
  return {
    ...actual,
    mintBroadcastToken: jest.fn().mockResolvedValue({ raw: 'raw-token' }),
    recordDigestOutcome: jest.fn().mockResolvedValue(undefined),
    saveDigestDraft: jest.fn(),
    generateDigestContent: jest.fn(),
    getDigestDraft: jest.fn(),
    getDigestConfig: jest.fn(),
    triggerBroadcast: jest.fn(),
  };
});
jest.mock('../modules/ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn(),
}));
jest.mock('../modules/integrations/sendgrid/sendgrid.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../modules/integrations/smtp/smtp.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../shared/utils/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));
jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('./queue', () => ({
  NEWSLETTER_QUEUE: 'newsletter',
  getBullConnection: jest.fn(),
  enqueueNewsletterBroadcast: jest.fn(),
}));

import type { Job } from 'bullmq';
import { processBroadcast, startNewsletterWorker, isStillEligible } from './newsletter.worker';
import * as repo from '../modules/newsletter/newsletter.repository';
import * as sendgrid from '../modules/integrations/sendgrid/sendgrid.connector';
import * as smtp from '../modules/integrations/smtp/smtp.connector';
import { enqueueNewsletterBroadcast } from './queue';
import { getAiConfig } from '../modules/ai-settings/ai-settings.service';
import * as newsletterService from '../modules/newsletter/newsletter.service';
import { logger } from '../shared/utils/logger';
import { redis } from '../shared/utils/redis';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedSendgrid = sendgrid as jest.Mocked<typeof sendgrid>;
const mockedSmtp = smtp as jest.Mocked<typeof smtp>;
const mockedRedis = redis as unknown as { get: jest.Mock; set: jest.Mock; del: jest.Mock };

const confirmedRow = (id: string) => ({
  id,
  email: `${id}@example.com`,
  status: 'confirmed' as const,
  topics: ['promotions'],
  frequency: 'weekly' as const,
  unsubscribe_token_hash: `hash-${id}`,
  source: 'website',
  confirmed_at: '2026-01-01T00:00:00.000Z',
  unsubscribed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

function job(data: Record<string, unknown>, id = 'job-1'): any {
  return { id, data };
}

describe('newsletter worker delivery accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Hermetic mocks: `clearAllMocks` does NOT drain `mockResolvedValueOnce`
    // queues, so reset the queue-sensitive mocks and re-establish defaults.
    // Otherwise a test that throws mid-page leaves a trailing `[]` that
    // silently shifts every later test's pagination.
    mockedRepo.findEligibleSubscribers.mockReset();
    mockedSendgrid.sendEmail.mockReset();
    mockedSmtp.sendEmail.mockReset();
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.set.mockResolvedValue('OK');
    mockedRedis.del.mockResolvedValue(1);
    (newsletterService.mintBroadcastToken as jest.Mock).mockResolvedValue({ raw: 'raw-token' });
  });

  it('counts provider-accepted sends and inspects the SMTP fallback Result', async () => {
    mockedRepo.findEligibleSubscribers
      .mockResolvedValueOnce([confirmedRow('a'), confirmedRow('b')])
      .mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }));
    expect(result).toEqual({ attempted: 2, accepted: 2, failed: 0, skipped: 0, uncertain: 0 });
    expect(mockedSmtp.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to SMTP when SendGrid returns ok:false and surfaces SMTP failure', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: false, status: 500, error: 'sg down', latencyMs: 1, retryable: true } as any);
    mockedSmtp.sendEmail.mockResolvedValue({ ok: false, error: 'smtp refused', retryable: true, latencyMs: 1 });
    await expect(processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }))).rejects.toThrow(
      /broadcast failed/,
    );
  });

  it('throws on total failure (retryable) but returns partial failure without duplicating sends', async () => {
    // Partial: one accepted, one failed -> resolves (no throw) so BullMQ does
    // not retry the already-accepted recipient.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a'), confirmedRow('b')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail
      .mockResolvedValueOnce({ ok: true, status: 202, data: {}, latencyMs: 1 } as any)
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'sg down', latencyMs: 1 } as any);
    mockedSmtp.sendEmail.mockResolvedValue({ ok: false, error: 'smtp down', retryable: true, latencyMs: 1 });
    const partial = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-partial'));
    expect(partial.accepted).toBe(1);
    expect(partial.failed).toBe(1);
  });

  it('rechecks eligibility before dispatch and skips pending/unsubscribed', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a'), confirmedRow('b')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) =>
      id === 'b' ? { ...confirmedRow(id), status: 'unsubscribed' as const } : confirmedRow(id),
    );
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }));
    expect(result).toEqual({ attempted: 1, accepted: 1, failed: 0, skipped: 1, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips recipients whose topics changed after audience selection', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    // Snapshot said promotions; current preferences say company_news only.
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => ({
      ...confirmedRow(id),
      topics: ['company_news'],
    }));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', topics: ['promotions'] }),
    );
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 1, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
  });

  it('skips recipients whose frequency changed after audience selection', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => ({
      ...confirmedRow(id),
      frequency: 'monthly' as const,
    }));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', frequencies: ['daily', 'weekly'] }),
    );
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 1, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
  });

  it('applies the full preference recheck to targeted retries with stale allow-lists', async () => {
    // Allow-list built when 'a' wanted promotions weekly; now monthly.
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => ({
      ...confirmedRow(id),
      frequency: 'monthly' as const,
    }));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(
      job(
        {
          subject: 'S',
          htmlBody: '<p>B</p>',
          topics: ['promotions'],
          frequency: 'weekly',
          broadcastRecordId: 'rec-stale',
          recipientIds: ['a'],
          retryOf: 'job-orig',
        },
        'job-retry-stale',
      ),
    );
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 1, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    expect(mockedRepo.upsertRecipientOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber_id: 'a',
        status: 'skipped',
        error: 'preferences changed after audience selection',
      }),
    );
  });

  it('skips claim-held recipients with an accepted receipt without resending', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    // Claim already held elsewhere, but the receipt proves a certain prior send.
    mockedRedis.set.mockImplementation(async (key: string) =>
      String(key).includes('claim:') ? null : 'OK',
    );
    mockedRedis.get.mockImplementation(async (key: string) =>
      String(key).includes('receipt:') ? 'accepted:sendgrid' : null,
    );
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-retry'));
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 1, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
  });

  it('marks claim-held recipients without a receipt uncertain and never resends them', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    // Orphaned claim (previous attempt died mid-send): no receipt exists.
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('claim:')) return null;
      return 'OK';
    });
    mockedRedis.get.mockResolvedValue(null);
    const result = await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', broadcastRecordId: 'rec-u' }, 'job-uncertain'),
    );
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 0, uncertain: 1 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    // The uncertain state is persisted, not just counted.
    expect(mockedRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('receipt:job-uncertain:a'),
      expect.stringMatching(/^uncertain:/),
      'EX',
      expect.any(Number),
    );
    expect(mockedRepo.upsertRecipientOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ broadcast_id: 'rec-u', subscriber_id: 'a', status: 'uncertain' }),
    );
    const outcomeCall = mockedRedis.set.mock.calls.find(([key]) =>
      String(key).includes('outcome:job-uncertain'),
    );
    const outcome = JSON.parse(outcomeCall![1] as string);
    expect(outcome.uncertain).toBe(1);
    expect(outcome.uncertainIds).toEqual(['a']);
  });

  it('reclaims a stale held claim paired with a failed receipt and resends', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    let claimed = true; // stale claim from a lost release
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (!String(key).includes('claim:')) return 'OK';
      if (claimed) {
        claimed = false; // DEL in reclaim path clears it
        return null;
      }
      return 'OK';
    });
    mockedRedis.get.mockImplementation(async (key: string) =>
      String(key).includes('receipt:') ? 'failed:provider rejected' : null,
    );
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-reclaim'));
    expect(result).toEqual({ attempted: 1, accepted: 1, failed: 0, skipped: 0, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('fails closed with zero sends when claim storage is unavailable', async () => {
    // No trailing `[]`: the claim throw ends the job during page 1.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedRedis.set.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    await expect(
      processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-redis-down')),
    ).rejects.toThrow(/dedupe storage unavailable/);
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    expect(mockedSmtp.sendEmail).not.toHaveBeenCalled();
  });

  it('enforces a frequency list so digests exclude monthly subscribers', async () => {
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    // Manual path (single frequency) keeps equality semantics.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>', frequency: 'weekly' }, 'job-f1'));
    expect(mockedRepo.findEligibleSubscribers).toHaveBeenCalledWith(
      100,
      0,
      expect.objectContaining({ frequency: 'weekly' }),
    );
    // Automated path (list) takes precedence and reaches the repository.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', frequencies: ['daily', 'weekly'] }, 'job-f2'),
    );
    expect(mockedRepo.findEligibleSubscribers).toHaveBeenCalledWith(
      100,
      0,
      expect.objectContaining({ frequency: ['daily', 'weekly'] }),
    );
  });

  it('marks the broadcast partially failed while uncertain sends exist', async () => {
    // Page 1: 'a' sends cleanly. Page 2: 'b' has an orphaned claim, no receipt.
    mockedRepo.findEligibleSubscribers
      .mockResolvedValueOnce([confirmedRow('a')])
      .mockResolvedValueOnce([confirmedRow('b')])
      .mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const held = new Set(['newsletter:broadcast:claim:job-mixed:b']);
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('claim:')) return held.has(String(key)) ? null : 'OK';
      return 'OK';
    });
    mockedRedis.get.mockResolvedValue(null);
    const result = await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', broadcastRecordId: 'rec-mixed' }, 'job-mixed'),
    );
    expect(result).toEqual({ attempted: 1, accepted: 1, failed: 0, skipped: 0, uncertain: 1 });
    const outcomeCall = mockedRedis.set.mock.calls.find(([key]) =>
      String(key).includes('outcome:job-mixed'),
    );
    const outcome = JSON.parse(outcomeCall![1] as string);
    expect(outcome.status).toBe('partially_failed');
    expect(outcome.uncertainIds).toEqual(['b']);
    expect(mockedRepo.upsertRecipientOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ subscriber_id: 'b', status: 'uncertain' }),
    );
  });

  it('marks an all-uncertain broadcast partially failed without throwing', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('claim:')) return null;
      return 'OK';
    });
    mockedRedis.get.mockResolvedValue(null);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-all-uncertain'));
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 0, uncertain: 1 });
    const outcomeCall = mockedRedis.set.mock.calls.find(([key]) =>
      String(key).includes('outcome:job-all-uncertain'),
    );
    expect(JSON.parse(outcomeCall![1] as string).status).toBe('partially_failed');
  });

  it('crash before provider dispatch becomes uncertain on retry, never resent', async () => {
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const mint = newsletterService.mintBroadcastToken as jest.Mock;
    // First attempt dies between claim and receipt (mint throws out), so no
    // page-2 fetch happens — no trailing `[]` queued.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]);
    mint.mockRejectedValueOnce(new Error('process crashed'));
    await expect(
      processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-crash-1')),
    ).rejects.toThrow('process crashed');
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    // Second attempt sees the orphaned claim with no receipt: uncertain.
    mockedRepo.findEligibleSubscribers
      .mockResolvedValueOnce([confirmedRow('a')])
      .mockResolvedValueOnce([]);
    mint.mockResolvedValue({ raw: 'raw-token' });
    const claimed = new Set<string>(['newsletter:broadcast:claim:job-crash-1:a']);
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('claim:')) return claimed.has(String(key)) ? null : 'OK';
      return 'OK';
    });
    mockedRedis.get.mockResolvedValue(null);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-crash-1'));
    expect(result.uncertain).toBe(1);
    expect(result.attempted).toBe(0);
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
  });

  it('crash after provider acceptance becomes uncertain on retry (sent exactly once)', async () => {
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    // First attempt: provider accepts, then the process dies writing the receipt.
    // The throw happens during page 1, so no trailing `[]` is queued.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]);
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('receipt:')) throw new Error('process crashed writing receipt');
      return 'OK';
    });
    await expect(
      processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-crash-2')),
    ).rejects.toThrow('process crashed writing receipt');
    // Second attempt: claim held, no receipt — uncertain, NOT resent.
    mockedRepo.findEligibleSubscribers
      .mockResolvedValueOnce([confirmedRow('a')])
      .mockResolvedValueOnce([]);
    const claimed = new Set<string>(['newsletter:broadcast:claim:job-crash-2:a']);
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (String(key).includes('claim:')) return claimed.has(String(key)) ? null : 'OK';
      return 'OK';
    });
    mockedRedis.get.mockResolvedValue(null);
    const result = await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-crash-2'));
    expect(result).toEqual({ attempted: 0, accepted: 0, failed: 0, skipped: 0, uncertain: 1 });
    // Provider was called exactly once across both attempts: no duplicate.
    expect(mockedSendgrid.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('never labels provider acceptance as delivery in the outcome record', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-outcome'));
    const setCalls = mockedRedis.set.mock.calls;
    const outcomeCall = setCalls.find(([key]) => String(key).includes('outcome:job-outcome'));
    expect(outcomeCall).toBeDefined();
    const outcome = JSON.parse(outcomeCall![1] as string);
    expect(outcome.accepted).toBe(1);
    expect(outcome).not.toHaveProperty('delivered');
    expect(outcome).not.toHaveProperty('opened');
    expect(outcome).not.toHaveProperty('clicked');
  });

  it('mints one appended token per recipient without overwriting older links', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a'), confirmedRow('b')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    await processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-tokens'));
    const mint = newsletterService.mintBroadcastToken as jest.Mock;
    expect(mint).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenCalledWith('a', 'job-tokens');
    expect(mint).toHaveBeenCalledWith('b', 'job-tokens');
    const outcomeCall = mockedRedis.set.mock.calls.find(([key]) =>
      String(key).includes('outcome:job-tokens'),
    );
    expect(JSON.parse(outcomeCall![1] as string).uncertain).toBe(0);
  });

  it('fails closed with a setup error when the token table is absent — zero sends, zero rotation', async () => {
    // Mint throws before any send; no page-2 fetch happens.
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    (newsletterService.mintBroadcastToken as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Newsletter token storage is not set up'), { statusCode: 503 }),
    );
    await expect(
      processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-setup-gate')),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    expect(mockedSmtp.sendEmail).not.toHaveBeenCalled();
  });

  it('processes only the allow-list on a targeted retry and rechecks consent', async () => {
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) =>
      id === 'missing'
        ? null
        : id === 'b'
          ? { ...confirmedRow(id), status: 'unsubscribed' as const }
          : confirmedRow(id),
    );
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    const result = await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', recipientIds: ['a', 'b', 'missing'], retryOf: 'job-orig' }, 'job-retry-targeted'),
    );
    // 'a' sent; 'b' rechecked as unsubscribed -> skipped; 'missing' (null row) -> skipped.
    expect(result).toEqual({ attempted: 1, accepted: 1, failed: 0, skipped: 2, uncertain: 0 });
    expect(mockedSendgrid.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockedRepo.findEligibleSubscribers).not.toHaveBeenCalled();
    const outcomeCall = mockedRedis.set.mock.calls.find(([key]) =>
      String(key).includes('outcome:job-retry-targeted'),
    );
    expect(JSON.parse(outcomeCall![1] as string).retryOf).toBe('job-orig');
  });

  it('releases the atomic claim on explicit failure so a later retry can reclaim', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: false, status: 500, error: 'sg down', latencyMs: 1 } as any);
    mockedSmtp.sendEmail.mockResolvedValue({ ok: false, error: 'smtp down', retryable: true, latencyMs: 1 });
    await expect(
      processBroadcast(job({ subject: 'S', htmlBody: '<p>B</p>' }, 'job-release')),
    ).rejects.toThrow(/broadcast failed/);
    expect(mockedRedis.del).toHaveBeenCalledWith(
      expect.stringContaining('claim:job-release:a'),
    );
  });

  it('transitions the durable record and upserts per-recipient outcomes', async () => {
    mockedRepo.findEligibleSubscribers.mockResolvedValueOnce([confirmedRow('a')]).mockResolvedValueOnce([]);
    mockedRepo.findSubscriberById.mockImplementation(async (id: string) => confirmedRow(id));
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, latencyMs: 1 } as any);
    await processBroadcast(
      job({ subject: 'S', htmlBody: '<p>B</p>', broadcastRecordId: 'rec-1' }, 'job-db'),
    );
    expect(mockedRepo.updateBroadcastStatus).toHaveBeenCalledWith('rec-1', 'processing');
    expect(mockedRepo.updateBroadcastStatus).toHaveBeenCalledWith(
      'rec-1',
      'completed',
      { attempted: 1, accepted: 1, failed: 0, skipped: 0 },
    );
    expect(mockedRepo.upsertRecipientOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ broadcast_id: 'rec-1', subscriber_id: 'a', status: 'accepted' }),
    );
  });
});

describe('isStillEligible preference recheck', () => {
  const sub = (overrides: Partial<{ topics: string[]; frequency: 'daily' | 'weekly' | 'monthly' }>) => ({
    topics: ['promotions'],
    frequency: 'weekly' as const,
    ...overrides,
  });

  it('passes untargeted sends regardless of preferences', () => {
    expect(isStillEligible(sub({ topics: [], frequency: 'monthly' }), {})).toBe(true);
  });

  it('requires overlap with targeted topics', () => {
    expect(isStillEligible(sub({}), { topics: ['promotions'] })).toBe(true);
    expect(isStillEligible(sub({ topics: ['company_news'] }), { topics: ['promotions'] })).toBe(false);
    expect(isStillEligible(sub({ topics: [] }), { topics: ['promotions'] })).toBe(false);
  });

  it('matches single frequencies by equality and lists by membership', () => {
    expect(isStillEligible(sub({}), { frequency: 'weekly' })).toBe(true);
    expect(isStillEligible(sub({}), { frequency: 'monthly' })).toBe(false);
    expect(isStillEligible(sub({}), { frequency: ['daily', 'weekly'] })).toBe(true);
    expect(isStillEligible(sub({ frequency: 'monthly' }), { frequency: ['daily', 'weekly'] })).toBe(false);
    expect(isStillEligible(sub({}), { frequency: [] })).toBe(false);
  });

  it('requires both dimensions when both are targeted', () => {
    expect(
      isStillEligible(sub({}), { topics: ['promotions'], frequency: ['daily', 'weekly'] }),
    ).toBe(true);
    expect(
      isStillEligible(sub({ topics: ['company_news'] }), { topics: ['promotions'], frequency: 'weekly' }),
    ).toBe(false);
  });
});

describe('startNewsletterWorker routing (preserved)', () => {  function makeJob(name: string, data: unknown = {}): Job {
    return { id: 'job-1', name, data } as unknown as Job;
  }
  async function getProcessor(): Promise<(job: Job) => Promise<void>> {
    startNewsletterWorker();
    return (global as unknown as Record<string, unknown>).__lastProcessor as (
      job: Job,
    ) => Promise<void>;
  }

  it('logs a warning for an unknown job name', async () => {
    const processor = await getProcessor();
    await processor(makeJob('newsletter:unknown'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown job name'),
      expect.any(Object),
    );
  });

  it('registers a failed-event handler that logs the job failure', async () => {
    startNewsletterWorker();
    const workerInstance = (global as unknown as Record<string, unknown>).__lastWorkerInstance as Record<
      string,
      (job: unknown, err: Error) => void
    >;
    workerInstance.__on_failed({ id: 'job-1', name: 'newsletter:broadcast' }, new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({ jobName: 'newsletter:broadcast', error: 'boom' }),
    );
  });
});

describe('processAutomatedDigest review-by-default (updated behavior)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.set.mockResolvedValue('OK');
  });
  function makeJob(name: string, data: unknown = {}, id = 'job-digest'): Job {
    return { id, name, data } as unknown as Job;
  }
  async function getProcessor(): Promise<(job: Job) => Promise<void>> {
    startNewsletterWorker();
    return (global as unknown as Record<string, unknown>).__lastProcessor as (
      job: Job,
    ) => Promise<void>;
  }

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('records a visible failure and does not enqueue when no OpenAI key is configured', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({});
    (newsletterService.getDigestConfig as jest.Mock).mockResolvedValue({ ok: true, value: {} });
    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY missing'));
    expect(newsletterService.triggerBroadcast as jest.Mock).not.toHaveBeenCalled();
    expect(newsletterService.recordDigestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('saves AI content as a draft for review and does not auto-send by default', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: false },
    });
    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));
    expect(newsletterService.saveDigestDraft).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Sales Tips' }),
      expect.any(String),
    );
    expect(newsletterService.triggerBroadcast as jest.Mock).not.toHaveBeenCalled();
    expect(newsletterService.recordDigestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'needs_review' }),
    );
  });

  it('enqueues only when auto-send is explicitly enabled', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: true,
      value: { enqueued: true, broadcastId: 'b-digest', eligible: 5 },
    });
    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));
    expect(newsletterService.triggerBroadcast).toHaveBeenCalledWith(
      'Sales Tips',
      '<p>Great tip.</p>',
      expect.objectContaining({ subject: 'Sales Tips' }),
    );
    expect(newsletterService.recordDigestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('targets daily + weekly frequencies on auto-send so monthly subscribers are excluded', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: true,
      value: { enqueued: true, broadcastId: 'b-digest' },
    });
    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));
    // Routed through the broadcast service (durable row + outcomes), not a
    // direct enqueue — with the digest audience enforced and a stable
    // execution identity so retries deduplicate.
    expect(newsletterService.triggerBroadcast).toHaveBeenCalledWith(
      'Sales Tips',
      '<p>Great tip.</p>',
      expect.objectContaining({
        frequencies: ['daily', 'weekly'],
        timezone: 'UTC',
        idempotencyKey: 'digest-job-digest',
      }),
    );
    expect(enqueueNewsletterBroadcast as jest.Mock).not.toHaveBeenCalled();
  });

  it('reuses the execution identity on retry so no second broadcast is created', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    // Attempt 1 generates content A, enqueues fine, then dies recording the
    // outcome. Attempt 2 (same BullMQ job id) regenerates content B.
    let n = 0;
    (newsletterService.generateDigestContent as jest.Mock).mockImplementation(async () => {
      n += 1;
      return { subject: `Tips ${n}`, htmlBody: `<p>${n}</p>`, tokensUsed: 10 };
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: true,
      value: { enqueued: true, broadcastId: 'b-1' },
    });
    (newsletterService.recordDigestOutcome as jest.Mock).mockRejectedValueOnce(
      new Error('Redis down'),
    );
    const processor = await getProcessor();
    await expect(processor(makeJob('newsletter:automated-digest'))).rejects.toThrow('Redis down');
    await processor(makeJob('newsletter:automated-digest'));
    const calls = (newsletterService.triggerBroadcast as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    // Same execution → same key (service dedupe yields one broadcast even
    // though the regenerated content differs).
    expect(calls[0][2]).toMatchObject({ idempotencyKey: 'digest-job-digest' });
    expect(calls[1][2]).toMatchObject({ idempotencyKey: 'digest-job-digest' });
    expect(calls[0][1]).toContain('<p>1</p>');
    expect(calls[1][1]).toContain('<p>2</p>');
    expect(newsletterService.recordDigestOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('assigns distinct identities to separate weekly executions', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: true,
      value: { enqueued: true, broadcastId: 'b-x' },
    });
    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest', {}, 'digest-week-1'));
    await processor(makeJob('newsletter:automated-digest', {}, 'digest-week-2'));
    const calls = (newsletterService.triggerBroadcast as jest.Mock).mock.calls;
    const keys = calls.map((c) => c[2].idempotencyKey);
    expect(keys).toEqual(['digest-digest-week-1', 'digest-digest-week-2']);
    expect(new Set(keys).size).toBe(2);
  });

  it('falls back to keyless broadcast when the digest job has no id', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: true,
      value: { enqueued: true },
    });
    const processor = await getProcessor();
    const idless = { name: 'newsletter:automated-digest', data: {} } as unknown as Job;
    await processor(idless);
    expect(newsletterService.triggerBroadcast).toHaveBeenCalledWith(
      'Sales Tips',
      '<p>Great tip.</p>',
      expect.not.objectContaining({ idempotencyKey: expect.anything() }),
    );
  });

  it('surfaces the broadcast setup gate when token storage is missing', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockResolvedValue({
      subject: 'Sales Tips',
      htmlBody: '<p>Great tip.</p>',
      tokensUsed: 10,
    });
    (newsletterService.getDigestDraft as jest.Mock).mockResolvedValue({
      ok: true,
      value: { draft: null, autoSend: true },
    });
    (newsletterService.triggerBroadcast as jest.Mock).mockResolvedValue({
      ok: false,
      error: { statusCode: 503, message: 'Newsletter sending is not set up' },
    });
    const processor = await getProcessor();
    await expect(processor(makeJob('newsletter:automated-digest'))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(newsletterService.recordDigestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('records failure visibly when AI generation throws', async () => {
    (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'sk-test' });
    (newsletterService.generateDigestContent as jest.Mock).mockRejectedValue(
      new Error('empty content'),
    );
    const processor = await getProcessor();
    await expect(processor(makeJob('newsletter:automated-digest'))).rejects.toThrow();
    expect(newsletterService.recordDigestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(enqueueNewsletterBroadcast as jest.Mock).not.toHaveBeenCalled();
  });
});
