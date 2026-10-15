jest.mock('../leads/leads.service', () => ({ getLeadById: jest.fn() }));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
import { getLeadById } from '../leads/leads.service';
import { addNewsletterContacts } from './newsletter.service';
jest.mock('./newsletter.repository', () => ({
  findSubscriberByEmail: jest.fn(),
  findSubscriberById: jest.fn(),
  findSubscriberByUnsubscribeTokenHash: jest.fn(),
  findSubscriberByUnsubscribeToken: jest.fn(),
  addConfirmedContact: jest.fn(),
  insertSubscriber: jest.fn(),
  resetToPending: jest.fn(),
  markConfirmed: jest.fn(),
  markUnsubscribed: jest.fn(),
  updatePreferences: jest.fn(),
  updateUnsubscribeTokenHash: jest.fn(),
  createSubscriberToken: jest.fn(),
  isMissingRelationError: jest.fn((err: unknown) => (err as { code?: string })?.code === '42P01'),
  isTokenTableAvailable: jest.fn(),
  createBroadcast: jest.fn(),
  findBroadcastById: jest.fn(),
  findBroadcastByIdempotencyKey: jest.fn(),
  setBroadcastContent: jest.fn(),
  updateBroadcastStatus: jest.fn(),
  listBroadcasts: jest.fn(),
  listBroadcastHistoryRows: jest.fn(),
  upsertRecipientOutcome: jest.fn(),
  listFailedRecipientIds: jest.fn(),
  listUncertainRecipientIds: jest.fn(),
  listUncertainRecipientIdsForBroadcasts: jest.fn(),
  findBroadcastFrequencies: jest.fn(),
  findBroadcastContent: jest.fn(),
  hasRecipientOutcomes: jest.fn(),
  findSubscribers: jest.fn(),
  countSubscribers: jest.fn(),
  countSubscribersByStatus: jest.fn(),
  findEligibleSubscribers: jest.fn(),
  countEligibleSubscribers: jest.fn(),
}));
jest.mock('../../shared/utils/redis', () => ({
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn(), scan: jest.fn() },
}));
jest.mock('../integrations/sendgrid/sendgrid.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../integrations/smtp/smtp.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../../workers/queue', () => ({
  enqueueNewsletterBroadcast: jest.fn(),
  toggleNewsletterAutomatedDigest: jest.fn(),
  newsletterQueue: {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
  },
  NEWSLETTER_AUTOMATED_DIGEST: 'newsletter:automated-digest',
}));

import { redis } from '../../shared/utils/redis';
import * as sendgrid from '../integrations/sendgrid/sendgrid.connector';
import * as smtp from '../integrations/smtp/smtp.connector';
import * as repo from './newsletter.repository';
import {
  subscribe,
  confirmSubscription,
  unsubscribe,
  getPreferences,
  updateSubscriberPreferences,
  listSubscribers,
  getSubscriberById,
  getDigestConfig,
  updateDigestConfig,
  getSubscriberCounts,
  getEligibleRecipientCount,
  triggerBroadcast,
  retryFailedRecipients,
  listBroadcastHistory,
  listUncertainRecipients,
  sendNewsletterTest,
  exportSubscribersCsv,
  escapeCsvCell,
  getDigestStatus,
  saveDigestDraft,
  approveDigestDraft,
  buildBroadcastHtml,
  escapeHtmlFragment,
  hashToken,
  mintUnsubscribeToken,
  mintBroadcastToken,
  DEFAULT_DIGEST_CONFIG,
} from './newsletter.service';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedRedis = redis as unknown as { get: jest.Mock; set: jest.Mock; del: jest.Mock; scan: jest.Mock };
const mockedSendgrid = sendgrid as jest.Mocked<typeof sendgrid>;
const mockedSmtp = smtp as jest.Mocked<typeof smtp>;

const baseRow = {
  id: 'sub-1',
  email: 'lead@example.com',
  status: 'pending' as const,
  topics: ['promotions'],
  frequency: 'weekly' as const,
  unsubscribe_token_hash: 'hash123',
  source: 'website',
  confirmed_at: null,
  unsubscribed_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

describe('newsletter.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 200, data: { externalId: 'x', latencyMs: 1 }, externalId: 'x', latencyMs: 1 } as any);
    // Durable-path defaults (migrations applied). Degraded-path tests
    // override createBroadcast with a 42P01 rejection.
    mockedRepo.isTokenTableAvailable.mockResolvedValue(true);
    mockedRepo.findBroadcastFrequencies.mockResolvedValue({});
    mockedRepo.hasRecipientOutcomes.mockResolvedValue(false);
    mockedRepo.findBroadcastContent.mockResolvedValue(null);
    mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue(null);
    mockedRepo.createBroadcast.mockResolvedValue({
      id: 'b-1',
      subject: 'Subject',
      preview_text: null,
      topics: [],
      frequency: null,
      timezone: 'UTC',
      scheduled_at: null,
      status: 'scheduled',
      attempted: 0,
      accepted: 0,
      failed: 0,
      skipped: 0,
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    mockedRepo.setBroadcastContent.mockResolvedValue(undefined);
  });

  describe('subscribe', () => {
    it('creates a new subscriber and sends a confirmation email', async () => {
      mockedRepo.findSubscriberByEmail.mockResolvedValue(null);
      mockedRepo.insertSubscriber.mockResolvedValue({ ...baseRow });

      const result = await subscribe('Lead@Example.com', ['promotions'], 'weekly', 'website');

      expect(result.ok).toBe(true);
      expect(mockedRepo.insertSubscriber).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'lead@example.com', topics: ['promotions'], frequency: 'weekly' }),
      );
      expect(mockedRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('newsletter:confirm_token:'),
        'sub-1',
        'EX',
        60 * 60 * 48,
      );
      expect(mockedSendgrid.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'lead@example.com', leadId: 'sub-1' }),
      );
    });

    it('resets an unsubscribed subscriber back to pending and resends confirmation', async () => {
      mockedRepo.findSubscriberByEmail.mockResolvedValue({ ...baseRow, status: 'unsubscribed' });
      mockedRepo.resetToPending.mockResolvedValue({ ...baseRow, status: 'pending' });

      const result = await subscribe('lead@example.com', [], 'daily', 'website');

      expect(result.ok).toBe(true);
      expect(mockedRepo.resetToPending).toHaveBeenCalledWith('sub-1', [], 'daily');
      expect(mockedRepo.insertSubscriber).not.toHaveBeenCalled();
      expect(mockedSendgrid.sendEmail).toHaveBeenCalled();
    });

    it('no-ops without sending an email for an already confirmed subscriber', async () => {
      mockedRepo.findSubscriberByEmail.mockResolvedValue({ ...baseRow, status: 'confirmed' });

      const result = await subscribe('lead@example.com', [], 'weekly', 'website');

      expect(result.ok).toBe(true);
      expect(mockedRepo.resetToPending).not.toHaveBeenCalled();
      expect(mockedRepo.insertSubscriber).not.toHaveBeenCalled();
      expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    });

    it('falls back to SMTP when SendGrid fails', async () => {
      mockedRepo.findSubscriberByEmail.mockResolvedValue(null);
      mockedRepo.insertSubscriber.mockResolvedValue({ ...baseRow });
      mockedSendgrid.sendEmail.mockRejectedValue(new Error('sendgrid down'));

      const result = await subscribe('lead@example.com', [], 'weekly', 'website');

      expect(result.ok).toBe(true);
      expect(mockedSmtp.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'lead@example.com' }),
      );
    });

    it('returns an error Result when the repository throws', async () => {
      mockedRepo.findSubscriberByEmail.mockRejectedValue(new Error('DB down'));
      const result = await subscribe('lead@example.com', [], 'weekly', 'website');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('DB down');
    });
  });

  describe('confirmSubscription', () => {
    it('confirms and deletes the single-use token on success', async () => {
      mockedRedis.get.mockResolvedValue('sub-1');
      const result = await confirmSubscription('raw-token');
      expect(result.ok).toBe(true);
      expect(mockedRepo.markConfirmed).toHaveBeenCalledWith('sub-1');
      expect(mockedRedis.del).toHaveBeenCalled();
    });

    it('returns 400 for an invalid or expired token', async () => {
      mockedRedis.get.mockResolvedValue(null);
      const result = await confirmSubscription('bad-token');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(400);
      expect(mockedRepo.markConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('marks a subscriber unsubscribed', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({ ...baseRow, status: 'confirmed' });
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(true);
      expect(mockedRepo.markUnsubscribed).toHaveBeenCalledWith('sub-1');
    });

    it('is idempotent for an already unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({ ...baseRow, status: 'unsubscribed' });
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(true);
      expect(mockedRepo.markUnsubscribed).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue(null);
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });
  });

  describe('getPreferences', () => {
    it('returns topics/frequency/status for a known token', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({ ...baseRow });
      const result = await getPreferences('raw-token');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ topics: ['promotions'], frequency: 'weekly', status: 'pending' });
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue(null);
      const result = await getPreferences('raw-token');
      expect(result.ok).toBe(false);
    });
  });

  describe('updateSubscriberPreferences', () => {
    it('updates preferences for a non-unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({ ...baseRow, status: 'confirmed' });
      mockedRepo.updatePreferences.mockResolvedValue({ ...baseRow, frequency: 'monthly' });
      const result = await updateSubscriberPreferences('raw-token', { frequency: 'monthly' });
      expect(result.ok).toBe(true);
      expect(mockedRepo.updatePreferences).toHaveBeenCalledWith('sub-1', { frequency: 'monthly' });
    });

    it('rejects updates for an unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({ ...baseRow, status: 'unsubscribed' });
      const result = await updateSubscriberPreferences('raw-token', { frequency: 'monthly' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(400);
      expect(mockedRepo.updatePreferences).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue(null);
      const result = await updateSubscriberPreferences('raw-token', { topics: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });
  });

  describe('listSubscribers', () => {
    it('returns items and pagination meta', async () => {
      mockedRepo.findSubscribers.mockResolvedValue([baseRow]);
      mockedRepo.countSubscribers.mockResolvedValue(1);
      const result = await listSubscribers(10, 0, 'pending');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
      expect(result.value.meta).toEqual({ limit: 10, offset: 0, total: 1 });
    });
  });

  describe('exportSubscribersCsv', () => {
    const rowFor = (i: number) => ({
      ...baseRow,
      id: `sub-${i}`,
      email: `user${i}@example.com`,
    });

    it('exports every matching row across batches (250 rows, no truncation)', async () => {
      const all = Array.from({ length: 250 }, (_, i) => rowFor(i));
      mockedRepo.findSubscribers.mockImplementation(async (limit: number, offset: number) =>
        all.slice(offset, offset + limit),
      );
      const result = await exportSubscribersCsv({ status: 'confirmed' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.value.csv.split('\n');
      expect(lines).toHaveLength(251); // header + 250 rows
      expect(result.value.total).toBe(250);
      expect(lines[0]).toBe(
        'email,status,topics,frequency,source,confirmed_at,unsubscribed_at,created_at',
      );
      expect(lines[1]).toContain('user0@example.com');
      expect(lines[250]).toContain('user249@example.com');
      // Batches of 1000: first call offset 0, second call only if full page.
      expect(mockedRepo.findSubscribers.mock.calls[0][1]).toBe(0);
      mockedRepo.findSubscribers.mockReset();
    });

    it('neutralizes CSV formula injection and quotes correctly', async () => {
      mockedRepo.findSubscribers.mockResolvedValue([
        { ...baseRow, email: '=cmd|evil', source: '+ plus', topics: ['@at;topic'] },
        { ...baseRow, id: 'sub-2', email: 'plain@example.com', source: 'a"b,c' },
      ]);
      const result = await exportSubscribersCsv();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [, evil, quoted] = result.value.csv.split('\n');
      expect(evil).toContain("'=cmd|evil");
      expect(evil).toContain("'+ plus");
      expect(evil).toContain("'@at;topic");
      expect(quoted).toContain('"a""b,c"');
      expect(quoted).toContain('plain@example.com');
      mockedRepo.findSubscribers.mockReset();
    });

    it('escapeCsvCell leaves ordinary values untouched', async () => {
      expect(escapeCsvCell('user@example.com')).toBe('user@example.com');
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell('-2')).toBe("\"'-2\"");
      expect(escapeCsvCell('a\tb')).toBe('a\tb');
    });
  });

  describe('getSubscriberById', () => {
    it('returns 404 when the subscriber does not exist', async () => {
      mockedRepo.findSubscriberById.mockResolvedValue(null);
      const result = await getSubscriberById('missing');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });

    it('returns the subscriber when found', async () => {
      mockedRepo.findSubscriberById.mockResolvedValue(baseRow);
      const result = await getSubscriberById('sub-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('sub-1');
    });
  });

  describe('getDigestConfig & updateDigestConfig', () => {
    it('returns default config when redis returns null', async () => {
      mockedRedis.get.mockResolvedValue(null);
      const result = await getDigestConfig();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(DEFAULT_DIGEST_CONFIG);
    });

    it('returns parsed config from redis when present', async () => {
      const customConfig = {
        topic: 'Custom Growth Hacks',
        tone: 'casual',
        customPrompt: 'Focus on growth.',
        targetAudience: 'Startups',
      };
      mockedRedis.get.mockResolvedValue(JSON.stringify(customConfig));
      const result = await getDigestConfig();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.topic).toBe('Custom Growth Hacks');
    });

    it('updates digest config in redis', async () => {
      const newConfig = {
        topic: 'New Topic',
        tone: 'motivational' as const,
        customPrompt: 'Prompt here',
        targetAudience: 'Audience',
      };
      mockedRedis.set.mockResolvedValue('OK');
      const result = await updateDigestConfig(newConfig);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(newConfig);
    });
  });

  describe('unsubscribe/preferences token handling (security-sensitive)', () => {
    it('resolves a raw token via the dual lookup without logging it', async () => {
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({
        ...baseRow,
        status: 'confirmed',
      });
      const result = await unsubscribe('raw-token-value');
      expect(result.ok).toBe(true);
      expect(mockedRepo.findSubscriberByUnsubscribeToken).toHaveBeenCalledWith(
        'raw-token-value',
        expect.any(Function),
      );
      expect(mockedRepo.markUnsubscribed).toHaveBeenCalledWith('sub-1');
    });

    it('accepts legacy links that embed the stored hash directly', async () => {
      // Repository-level dual lookup is unit-tested in repository tests; here
      // we assert the service delegates to it (single call site) so legacy
      // subscribers are not locked out after the rotation fix.
      mockedRepo.findSubscriberByUnsubscribeToken.mockResolvedValue({
        ...baseRow,
        status: 'confirmed',
      });
      const result = await getPreferences('hash123-legacy-link-value');
      expect(result.ok).toBe(true);
      expect(mockedRepo.findSubscriberByUnsubscribeToken).toHaveBeenCalledWith(
        'hash123-legacy-link-value',
        expect.any(Function),
      );
    });

    it('hashToken is sha256 hex and mint rotates the persisted hash', async () => {
      expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
      expect(hashToken('abc')).not.toBe(hashToken('abd'));
      mockedRepo.updateUnsubscribeTokenHash.mockResolvedValue(undefined);
      const raw = await mintUnsubscribeToken('sub-1');
      expect(raw).toMatch(/^[0-9a-f]{64}$/);
      expect(mockedRepo.updateUnsubscribeTokenHash).toHaveBeenCalledWith(
        'sub-1',
        hashToken(raw),
      );
    });

    it('mintBroadcastToken appends a token row and never overwrites the column', async () => {
      mockedRepo.createSubscriberToken.mockResolvedValue(undefined);
      const first = await mintBroadcastToken('sub-1', 'broadcast-A');
      const second = await mintBroadcastToken('sub-1', 'broadcast-B');
      expect(first.raw).not.toBe(second.raw);
      expect(mockedRepo.createSubscriberToken).toHaveBeenCalledWith(
        'sub-1',
        hashToken(first.raw),
        'broadcast-A',
      );
      expect(mockedRepo.createSubscriberToken).toHaveBeenCalledWith(
        'sub-1',
        hashToken(second.raw),
        'broadcast-B',
      );
      // Older links stay valid: nothing was overwritten.
      expect(mockedRepo.updateUnsubscribeTokenHash).not.toHaveBeenCalled();
    });

    it('mintBroadcastToken fails closed with a setup error when migration 0081 is absent', async () => {
      mockedRepo.createSubscriberToken.mockRejectedValue(
        Object.assign(new Error('relation "newsletter_subscriber_tokens" does not exist'), {
          code: '42P01',
        }),
      );
      await expect(mintBroadcastToken('sub-1', 'broadcast-A')).rejects.toMatchObject({
        statusCode: 503,
      });
      // No rotation: older links are untouched.
      expect(mockedRepo.updateUnsubscribeTokenHash).not.toHaveBeenCalled();
      mockedRepo.createSubscriberToken.mockReset();
    });

    it('links minted by two successive broadcasts both resolve', async () => {
      // Lifecycle seam test: mint twice (append-only), then resolve both
      // raws. The valid-set emulates the token table holding every appended
      // hash; the point under test is that the second mint never revokes
      // the first (no overwrite call) and both raws verify.
      mockedRepo.createSubscriberToken.mockResolvedValue(undefined);
      const a = await mintBroadcastToken('sub-1', 'broadcast-A');
      const b = await mintBroadcastToken('sub-1', 'broadcast-B');
      const valid = new Set([hashToken(a.raw), hashToken(b.raw)]);
      mockedRepo.findSubscriberByUnsubscribeToken.mockImplementation(async (supplied: string) => {
        if (valid.has(hashToken(supplied))) return { ...baseRow, status: 'confirmed' as const };
        return null;
      });
      expect((await unsubscribe(a.raw)).ok).toBe(true);
      expect((await unsubscribe(b.raw)).ok).toBe(true);
      // The second send did not invalidate the first send's link.
      expect(mockedRepo.updateUnsubscribeTokenHash).not.toHaveBeenCalled();
      mockedRepo.findSubscriberByUnsubscribeToken.mockReset();
    });

    it('buildBroadcastHtml escapes preview text and appends footer links', async () => {
      const { html, text } = buildBroadcastHtml('<p>Hello</p>', {
        previewText: '<script>alert(1)</script>',
        prefsUrl: 'https://x/prefs?token=abc',
        unsubUrl: 'https://x/unsub?token=abc',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('Update Preferences');
      expect(html).toContain('Unsubscribe');
      expect(text).not.toContain('<p>');
      expect(escapeHtmlFragment('a&b<"c\'>')).toBe('a&amp;b&lt;&quot;c&#39;&gt;');
    });
  });

  describe('subscriber counts & eligibility', () => {
    it('returns audience-wide counts independent of filters', async () => {
      mockedRepo.countSubscribersByStatus.mockResolvedValue({
        pending: 2,
        confirmed: 5,
        unsubscribed: 1,
        total: 8,
      });
      const result = await getSubscriberCounts();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ pending: 2, confirmed: 5, unsubscribed: 1, total: 8 });
    });

    it('counts eligible recipients with topic/frequency targeting', async () => {
      mockedRepo.countEligibleSubscribers.mockResolvedValue(4);
      const result = await getEligibleRecipientCount({ topics: ['promotions'], frequency: 'weekly' });
      expect(result.ok).toBe(true);
      expect(mockedRepo.countEligibleSubscribers).toHaveBeenCalledWith({
        topics: ['promotions'],
        frequency: 'weekly',
      });
    });

    it('passes list filters (search/topic/source/frequency) through to the repository', async () => {
      mockedRepo.findSubscribers.mockResolvedValue([baseRow]);
      mockedRepo.countSubscribers.mockResolvedValue(1);
      const result = await listSubscribers(10, 0, undefined, {
        search: 'lead@',
        topic: 'promotions',
        source: 'website',
        frequency: 'weekly',
      });
      expect(result.ok).toBe(true);
      expect(mockedRepo.findSubscribers).toHaveBeenCalledWith(
        10,
        0,
        undefined,
        expect.objectContaining({ search: 'lead@', topic: 'promotions' }),
      );
    });
  });

  describe('broadcast & test-send', () => {
    it('enqueues with targeting and preserves backwards-compatible response shape', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
      mockedRepo.countEligibleSubscribers.mockResolvedValue(7);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        previewText: 'Preview',
        topics: ['promotions'],
        frequency: 'weekly',
        timezone: 'UTC',
        idempotencyKey: 'key-1',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enqueued).toBe(true);
      expect(result.value.eligible).toBe(7);
    });

    it('converts scheduledAtLocal in the selected timezone to the UTC instant', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
      mockedRepo.countEligibleSubscribers.mockResolvedValue(3);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        scheduledAtLocal: '2026-05-01T09:00',
        timezone: 'Asia/Kolkata',
        idempotencyKey: 'key-tz',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.scheduledAt).toBe('2026-05-01T03:30:00.000Z');
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledAt: '2026-05-01T03:30:00.000Z',
          scheduledAtLocal: '2026-05-01T09:00',
          timezone: 'Asia/Kolkata',
        }),
      );
    });

    it('rejects a DST-gap local time with 422 instead of silently shifting it', async () => {
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        scheduledAtLocal: '2026-03-08T02:30',
        timezone: 'America/New_York',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(422);
    });

    it('records the durable row with creator/audience/schedule and links the job', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-9');
      mockedRepo.countEligibleSubscribers.mockResolvedValue(5);
      const result = await triggerBroadcast(
        'Subject',
        '<p>Hi</p>',
        {
          subject: 'Subject',
          htmlBody: '<p>Hi</p>',
          previewText: 'Prev',
          topics: ['promotions'],
          frequency: 'weekly',
          scheduledAtLocal: '2026-05-01T09:00',
          timezone: 'Asia/Kolkata',
          idempotencyKey: 'key-2',
        },
        { id: 'admin-1' },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockedRepo.createBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Subject',
          previewText: 'Prev',
          topics: ['promotions'],
          frequency: 'weekly',
          timezone: 'Asia/Kolkata',
          scheduledAtUtc: '2026-05-01T03:30:00.000Z',
          createdBy: 'admin-1',
          idempotencyKey: 'key-2',
          status: 'scheduled',
        }),
      );
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ broadcastRecordId: 'b-1' }),
      );
      expect(mockedRepo.setBroadcastContent).toHaveBeenCalledWith('b-1', { jobId: 'job-9' });
      expect(result.value.broadcastId).toBe('b-1');
      expect(result.value.persistence).toBe('database');
    });

    it('passes frequency lists through counting, storage, and enqueue', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-10');
      mockedRepo.countEligibleSubscribers.mockResolvedValue(9);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        frequencies: ['daily', 'weekly'],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockedRepo.countEligibleSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: ['daily', 'weekly'] }),
      );
      expect(mockedRepo.createBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ frequencies: ['daily', 'weekly'] }),
      );
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ frequencies: ['daily', 'weekly'] }),
      );
    });

    it('deduplicates a double submit on the idempotency key without re-enqueueing', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'completed',
      } as never);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-dup',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ enqueued: false, broadcastId: 'b-old', deduplicated: true });
      expect(result.value.recovered).toBeUndefined();
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
      expect(mockedRepo.createBroadcast).not.toHaveBeenCalled();
    });

    it('does not claim a duplicate while its job is still pending', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'scheduled',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue({ getState: async () => 'delayed' });
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-dup',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ enqueued: false, deduplicated: true });
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
    });

    it('recovers a stranded broadcast whose job never enqueued', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-new');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'scheduled',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      mockedRepo.countEligibleSubscribers.mockResolvedValue(4);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-stranded',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Same row, same job id — no duplicate row, no duplicate namespace.
      expect(result.value).toMatchObject({ enqueued: true, broadcastId: 'b-old', recovered: true });
      expect(mockedRepo.createBroadcast).not.toHaveBeenCalled();
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ broadcastRecordId: 'b-old' }),
      );
      const payload = (enqueueNewsletterBroadcast as jest.Mock).mock.calls[0][0];
      expect(payload.idempotencyKey).toBe('key-stranded');
    });

    it('recovers a failed job via retry under the same id instead of re-adding', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      const retry = jest.fn().mockResolvedValue(undefined);
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'processing',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue({
        getState: async () => 'failed',
        retry,
        remove: jest.fn(),
      });
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-failed',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ enqueued: true, recovered: true });
      expect(retry).toHaveBeenCalled();
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
    });

    it('never resends a terminal broadcast even when its job record is gone', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'partially_failed',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-done',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ enqueued: false, deduplicated: true });
      expect(result.value.recovered).toBeUndefined();
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
    });

    it('fails closed when the queue cannot be verified during dedupe', async () => {
      const { newsletterQueue } = jest.requireMock('../../workers/queue');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Subject',
        status: 'scheduled',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }),
      );
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
        idempotencyKey: 'key-down',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(503);
    });

    it('queue outage before enqueue recovers exactly one broadcast on retry', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      // Attempt 1: row created, then the queue dies before enqueue.
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue(null);
      (enqueueNewsletterBroadcast as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }),
      );
      mockedRepo.countEligibleSubscribers.mockResolvedValue(3);
      const first = await triggerBroadcast('Attempt 1 subject', '<p>A1</p>', {
        subject: 'Attempt 1 subject',
        htmlBody: '<p>A1</p>',
        idempotencyKey: 'key-outage',
      });
      expect(first.ok).toBe(false);
      // Attempt 2 (same identity): row scheduled, no job, no outcomes →
      // requeue under the same id; exactly one row and one job total.
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-1',
        subject: 'Attempt 1 subject',
        topics: [],
        frequency: null,
        timezone: 'UTC',
        scheduled_at: null,
        status: 'scheduled',
        preview_text: null,
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-new');
      const second = await triggerBroadcast('Attempt 2 subject', '<p>A2</p>', {
        subject: 'Attempt 2 subject',
        htmlBody: '<p>A2</p>',
        idempotencyKey: 'key-outage',
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value).toMatchObject({ enqueued: true, broadcastId: 'b-1', recovered: true });
      expect(mockedRepo.createBroadcast).toHaveBeenCalledTimes(1);
      const enqueues = (enqueueNewsletterBroadcast as jest.Mock).mock.calls;
      expect(enqueues).toHaveLength(2); // attempt 1 threw, attempt 2 succeeded
      expect(enqueues[1][0].broadcastRecordId).toBe('b-1');
      // Nothing was ever sent: the row is synced to the latest call.
      expect(mockedRepo.setBroadcastContent).toHaveBeenCalledWith(
        'b-1',
        expect.objectContaining({ subject: 'Attempt 2 subject', htmlBody: '<p>A2</p>' }),
      );
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
    });

    it('requeue reuses original content when sends already happened', async () => {
      const { enqueueNewsletterBroadcast, newsletterQueue } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-new');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Original subject',
        topics: ['promotions'],
        frequency: null,
        timezone: 'UTC',
        scheduled_at: null,
        status: 'scheduled',
        preview_text: 'Original preview',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      mockedRepo.hasRecipientOutcomes.mockResolvedValue(true);
      mockedRepo.findBroadcastContent.mockResolvedValue({ htmlBody: '<p>Original</p>' });
      mockedRepo.findBroadcastFrequencies.mockResolvedValue({ 'b-old': ['daily'] });
      mockedRepo.countEligibleSubscribers.mockResolvedValue(2);
      const result = await triggerBroadcast('Regenerated subject', '<p>Regenerated</p>', {
        subject: 'Regenerated subject',
        htmlBody: '<p>Regenerated</p>',
        topics: ['promotions'],
        idempotencyKey: 'key-regen',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ enqueued: true, recovered: true });
      const payload = (enqueueNewsletterBroadcast as jest.Mock).mock.calls[0][0];
      // Original identity content wins over the regenerated call.
      expect(payload.subject).toBe('Original subject');
      expect(payload.htmlBody).toBe('<p>Original</p>');
      expect(payload.previewText).toBe('Original preview');
      expect(payload.frequencies).toEqual(['daily']);
    });

    it('requeue refuses when sends happened but original content is unavailable', async () => {
      const { newsletterQueue } = jest.requireMock('../../workers/queue');
      mockedRepo.findBroadcastByIdempotencyKey.mockResolvedValue({
        id: 'b-old',
        subject: 'Original subject',
        status: 'scheduled',
      } as never);
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      mockedRepo.hasRecipientOutcomes.mockResolvedValue(true);
      mockedRepo.findBroadcastContent.mockResolvedValue(null);
      const result = await triggerBroadcast('Regenerated subject', '<p>Regenerated</p>', {
        subject: 'Regenerated subject',
        htmlBody: '<p>Regenerated</p>',
        idempotencyKey: 'key-nocontent',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(409);
      expect(result.error.message).toMatch(/create a new broadcast instead/);
    });

    it('degrades to Redis-only history when migrations are not run', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
      mockedRepo.createBroadcast.mockRejectedValue(
        Object.assign(new Error('relation "newsletter_broadcasts" does not exist'), { code: '42P01' }),
      );
      mockedRepo.countEligibleSubscribers.mockResolvedValue(2);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enqueued).toBe(true);
      expect(result.value.persistence).toBe('redis');
      expect(result.value.broadcastId).toBeUndefined();
    });

    it('refuses to enqueue with an actionable setup error when the token table is absent', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      mockedRepo.isTokenTableAvailable.mockResolvedValue(false);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(503);
      expect(result.error.message).toMatch(/migration 0081/);
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
      expect(mockedRepo.createBroadcast).not.toHaveBeenCalled();
    });

    it('reports 503 (not 500) when the queue/Redis is unreachable', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }),
      );
      mockedRepo.countEligibleSubscribers.mockResolvedValue(2);
      const result = await triggerBroadcast('Subject', '<p>Hi</p>', {
        subject: 'Subject',
        htmlBody: '<p>Hi</p>',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(503);
      expect(result.error.message).toMatch(/nothing was enqueued/i);
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
    });

    it('surfaces provider failure instead of misleading success on test-send', async () => {
      mockedSendgrid.sendEmail.mockRejectedValue(new Error('sendgrid down'));
      mockedSmtp.sendEmail.mockResolvedValue({ ok: false, error: 'smtp refused', retryable: true, latencyMs: 1 });
      const result = await sendNewsletterTest('admin@example.com', 'S', '<p>B</p>');
      expect(result.ok).toBe(false);
    });

    it('prefers SendGrid when accepted and never treats acceptance as delivery', async () => {
      mockedSendgrid.sendEmail.mockResolvedValue({ ok: true, status: 202, data: {}, externalId: 'sg-1', latencyMs: 5 } as any);
      const result = await sendNewsletterTest('admin@example.com', 'S', '<p>B</p>');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.sent).toBe(true);
      expect(result.value.channel).toBe('sendgrid');
      expect(mockedSmtp.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('durable history & targeted retry', () => {
    it('lists database history first with source labelled database', async () => {
      mockedRepo.listBroadcastHistoryRows.mockResolvedValue([
        {
          id: 'b-1',
          subject: 'S',
          preview_text: null,
          topics: ['promotions'],
          frequency: 'weekly' as const,
          timezone: 'UTC',
          scheduled_at: null,
          status: 'completed' as const,
          attempted: 2,
          accepted: 2,
          failed: 0,
          skipped: 0,
          uncertain: 1,
          created_by: 'admin-1',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ]);
      mockedRepo.listUncertainRecipientIdsForBroadcasts.mockResolvedValue({ 'b-1': ['sub-u1'] });
      mockedRepo.findBroadcastFrequencies.mockResolvedValue({ 'b-1': ['daily', 'weekly'] });
      const result = await listBroadcastHistory(50);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]).toMatchObject({
        id: 'b-1',
        source: 'database',
        createdBy: 'admin-1',
        uncertain: 1,
        uncertainIds: ['sub-u1'],
        frequencies: ['daily', 'weekly'],
      });
    });

    it('falls back to Redis history with source redis when tables are missing', async () => {
      mockedRepo.listBroadcastHistoryRows.mockRejectedValue(
        Object.assign(new Error('relation "newsletter_broadcasts" does not exist'), { code: '42P01' }),
      );
      mockedRedis.scan.mockResolvedValue(['0', ['newsletter:broadcast:outcome:job-1']]);
      mockedRedis.get.mockResolvedValue(
        JSON.stringify({
          subject: 'S',
          status: 'partially_failed',
          topics: [],
          frequency: null,
          timezone: 'UTC',
          attempted: 2,
          accepted: 1,
          failed: 1,
          skipped: 0,
          uncertain: 1,
          uncertainIds: ['sub-u1'],
          failures: [{ subscriberId: 'sub-9', error: 'nope' }],
          finishedAt: '2026-01-02T00:00:00.000Z',
        }),
      );
      const result = await listBroadcastHistory(50);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]).toMatchObject({
        id: 'job-1',
        source: 'redis',
        createdBy: null,
        failureCount: 1,
        uncertain: 1,
        uncertainIds: ['sub-u1'],
      });
    });

    it('retries only failed recipients from the durable record', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-r1');
      mockedRepo.findBroadcastFrequencies.mockResolvedValue({});
      mockedRepo.findBroadcastById.mockResolvedValue({
        id: 'b-1',
        subject: 'S',
        preview_text: null,
        topics: ['promotions'],
        frequency: null,
        timezone: 'UTC',
        scheduled_at: null,
        status: 'partially_failed',
        attempted: 3,
        accepted: 2,
        failed: 1,
        skipped: 0,
        created_by: 'admin-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        html_body: '<p>Hi</p>',
      } as never);
      mockedRepo.listFailedRecipientIds.mockResolvedValue(['sub-9']);
      const result = await retryFailedRecipients('b-1', { id: 'admin-2' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.retrying).toBe(1);
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ recipientIds: ['sub-9'], retryOf: 'b-1' }),
      );
      // Successful recipients are not in the allow-list.
      const payload = (enqueueNewsletterBroadcast as jest.Mock).mock.calls[0][0];
      expect(payload.recipientIds).not.toContain('sub-ok-1');
      expect(mockedRepo.createBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'admin-2', status: 'scheduled' }),
      );
    });

    it('carries digest frequency lists through the durable retry path', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-r2');
      mockedRepo.findBroadcastById.mockResolvedValue({
        id: 'b-digest',
        subject: 'Sales Tips',
        preview_text: null,
        topics: [],
        frequency: null,
        timezone: 'UTC',
        scheduled_at: null,
        status: 'partially_failed',
        attempted: 5,
        accepted: 4,
        failed: 1,
        skipped: 0,
        created_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        html_body: '<p>Tips</p>',
      } as never);
      mockedRepo.findBroadcastFrequencies.mockResolvedValue({ 'b-digest': ['daily', 'weekly'] });
      mockedRepo.listFailedRecipientIds.mockResolvedValue(['sub-9']);
      const result = await retryFailedRecipients('b-digest');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Audience survives the durable round-trip: monthly stays excluded.
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ frequencies: ['daily', 'weekly'] }),
      );
    });

    it('returns 409 when there are no failed recipients to retry', async () => {
      mockedRepo.findBroadcastById.mockResolvedValue({
        id: 'b-1',
        subject: 'S',
        html_body: '<p>Hi</p>',
      } as never);
      mockedRepo.listFailedRecipientIds.mockResolvedValue([]);
      const result = await retryFailedRecipients('b-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(409);
    });

    it('returns 404 when original content is unavailable for retry', async () => {
      mockedRepo.findBroadcastById.mockResolvedValue(null);
      mockedRedis.get.mockResolvedValue(null);
      const { newsletterQueue } = jest.requireMock('../../workers/queue');
      (newsletterQueue.getJob as jest.Mock).mockResolvedValue(null);
      const result = await retryFailedRecipients('gone');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });

    it('excludes uncertain recipients unless the operator explicitly opts in', async () => {
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue('job-r2');
      mockedRepo.findBroadcastById.mockResolvedValue({
        id: 'b-1',
        subject: 'S',
        topics: [],
        timezone: 'UTC',
        status: 'partially_failed',
        html_body: '<p>Hi</p>',
      } as never);
      mockedRepo.listFailedRecipientIds.mockResolvedValue(['sub-9']);
      mockedRepo.listUncertainRecipientIds.mockResolvedValue(['sub-u1']);
      // Default: uncertain never auto-resent.
      const def = await retryFailedRecipients('b-1', { id: 'admin-2' });
      expect(def.ok).toBe(true);
      if (!def.ok) return;
      expect(def.value.retrying).toBe(1);
      expect(def.value.retryingUncertain).toBe(0);
      expect(enqueueNewsletterBroadcast).toHaveBeenLastCalledWith(
        expect.objectContaining({ recipientIds: ['sub-9'] }),
      );
      expect(mockedRepo.listUncertainRecipientIds).not.toHaveBeenCalled();
      // Explicit opt-in: uncertain ids join the allow-list.
      const opt = await retryFailedRecipients('b-1', { id: 'admin-2' }, { includeUncertain: true });
      expect(opt.ok).toBe(true);
      if (!opt.ok) return;
      expect(opt.value.retrying).toBe(1);
      expect(opt.value.retryingUncertain).toBe(1);
      expect(enqueueNewsletterBroadcast).toHaveBeenLastCalledWith(
        expect.objectContaining({ recipientIds: ['sub-9', 'sub-u1'] }),
      );
    });

    it('returns 409 mentioning uncertain only when opted in with nothing to retry', async () => {
      mockedRepo.findBroadcastById.mockResolvedValue({
        id: 'b-1',
        subject: 'S',
        html_body: '<p>Hi</p>',
      } as never);
      mockedRepo.listFailedRecipientIds.mockResolvedValue([]);
      mockedRepo.listUncertainRecipientIds.mockResolvedValue([]);
      const result = await retryFailedRecipients('b-1', undefined, { includeUncertain: true });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(409);
      expect(result.error.message).toMatch(/uncertain/);
    });
  });

  describe('uncertain recipient review', () => {
    it('lists uncertain recipients with emails on the durable path', async () => {
      mockedRepo.listUncertainRecipientIds.mockResolvedValue(['sub-u1', 'sub-gone']);
      mockedRepo.findSubscriberById.mockImplementation(async (id: string) =>
        id === 'sub-u1' ? { ...baseRow, id, email: 'u1@example.com' } : null,
      );
      const result = await listUncertainRecipients('b-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toEqual([
        { subscriberId: 'sub-u1', email: 'u1@example.com' },
        { subscriberId: 'sub-gone', email: null },
      ]);
      mockedRepo.findSubscriberById.mockReset();
    });

    it('falls back to Redis uncertain ids without emails', async () => {
      mockedRepo.listUncertainRecipientIds.mockRejectedValue(
        Object.assign(new Error('relation "newsletter_broadcast_recipients" does not exist'), {
          code: '42P01',
        }),
      );
      mockedRedis.get.mockResolvedValue(JSON.stringify({ uncertainIds: ['sub-u1'] }));
      const result = await listUncertainRecipients('job-1');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toEqual([{ subscriberId: 'sub-u1', email: null }]);
    });
  });

  describe('digest status & draft approval', () => {
    it('loads persisted enabled status (refresh-safe) with schedule/timezone/last outcome', async () => {
      const { newsletterQueue } = jest.requireMock('../../workers/queue');
      (newsletterQueue.getRepeatableJobs as jest.Mock | undefined)?.mockResolvedValue?.([]);
      mockedRedis.get.mockImplementation((key: string) => {
        if (key === 'newsletter:digest:enabled') return Promise.resolve('1');
        if (key === 'newsletter:digest:auto_send') return Promise.resolve('0');
        if (key === 'newsletter:digest:last_outcome')
          return Promise.resolve(JSON.stringify({ status: 'success', message: 'ok', at: '2026-01-01T00:00:00.000Z' }));
        return Promise.resolve(null);
      });
      const result = await getDigestStatus();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(result.value.timezone).toBe('UTC');
      expect(result.value.schedule).toContain('0 9 * * 5');
      expect(result.value.lastOutcome.status).toBe('success');
    });

    it('does not enqueue an already approved digest', async () => {
      mockedRedis.get.mockResolvedValue(
        JSON.stringify({ subject: 'S', htmlBody: '<p>B</p>', status: 'approved' }),
      );
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      const result = await approveDigestDraft();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.statusCode).toBe(409);
      expect(enqueueNewsletterBroadcast).not.toHaveBeenCalled();
    });

    it('reuses the same approval identity after an approval-status write fails', async () => {
      const draft = {
        id: 'draft-id',
        subject: 'S',
        htmlBody: '<p>B</p>',
        status: 'draft',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      mockedRedis.get.mockResolvedValue(JSON.stringify(draft));
      mockedRedis.set.mockRejectedValueOnce(new Error('interrupted write')).mockResolvedValue('OK');
      const first = await approveDigestDraft();
      const second = await approveDigestDraft();
      expect(first.ok).toBe(false);
      expect(second.ok).toBe(true);
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledTimes(2);
      for (const [payload] of (enqueueNewsletterBroadcast as jest.Mock).mock.calls) {
        expect(payload).toMatchObject({
          idempotencyKey: 'digest-approval-draft-id',
          frequencies: ['daily', 'weekly'],
        });
      }
    });

    it('preserves the setup error status on digest approval', async () => {
      mockedRedis.get.mockResolvedValue(
        JSON.stringify({
          subject: 'S',
          htmlBody: '<p>B</p>',
          status: 'draft',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        }),
      );
      mockedRepo.isTokenTableAvailable.mockResolvedValue(false);
      const result = await approveDigestDraft();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.statusCode).toBe(503);
    });

    it('saves a draft as needs_review and approves it into a broadcast', async () => {
      mockedRedis.get.mockResolvedValue(null);
      mockedRedis.set.mockResolvedValue('OK');
      const saved = await saveDigestDraft({ subject: 'S', htmlBody: '<p>B</p>' });
      expect(saved.ok).toBe(true);
      const { enqueueNewsletterBroadcast } = jest.requireMock('../../workers/queue');
      (enqueueNewsletterBroadcast as jest.Mock).mockResolvedValue(undefined);
      mockedRepo.countEligibleSubscribers.mockResolvedValue(3);
      mockedRedis.get.mockResolvedValue(
        JSON.stringify({ subject: 'S', htmlBody: '<p>B</p>', status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
      );
      const approved = await approveDigestDraft();
      expect(approved.ok).toBe(true);
      expect(enqueueNewsletterBroadcast).toHaveBeenCalledWith(expect.objectContaining({
        frequencies: ['daily', 'weekly'],
        idempotencyKey: expect.stringMatching(/^digest-approval-/),
      }));
    });
  });
});

describe('direct contact enrollment', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const actor = { id: 'admin-1', role: 'admin' as const };
  const input = { leadIds: [id], topics: ['promotions' as const], frequency: 'weekly' as const };
  const lead = { id, email: ' Lead@Example.com ', status: 'active' } as Awaited<ReturnType<typeof getLeadById>>;
  beforeEach(() => jest.clearAllMocks());
  it('adds immediately without a confirmation email and reports duplicates as skipped', async () => {
    jest.mocked(getLeadById).mockResolvedValue(lead);
    mockedRepo.addConfirmedContact.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await addNewsletterContacts(input, actor)).toEqual({ ok: true, value: { added: 1, failed: 0, skipped: 0, failedLeadIds: [] } });
    expect(mockedRepo.addConfirmedContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'lead@example.com' }));
    expect(mockedRepo.addConfirmedContact.mock.calls[0][0].unsubscribeTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await addNewsletterContacts(input, actor)).toEqual({ ok: true, value: { added: 0, failed: 0, skipped: 1, failedLeadIds: [] } });
    expect(mockedSendgrid.sendEmail).not.toHaveBeenCalled();
    expect(mockedSmtp.sendEmail).not.toHaveBeenCalled();
  });
  it('skips opted-out, invalid and duplicate lead emails', async () => {
    const ids = [id, '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003'];
    jest.mocked(getLeadById).mockResolvedValueOnce({ ...lead, status: 'opted_out' }).mockResolvedValueOnce({ ...lead, email: 'bad' }).mockResolvedValueOnce(lead).mockResolvedValueOnce(lead);
    mockedRepo.addConfirmedContact.mockResolvedValue(true);
    expect(await addNewsletterContacts({ ...input, leadIds: ids }, actor)).toEqual({ ok: true, value: { added: 1, failed: 0, skipped: 3, failedLeadIds: [] } });
    expect(mockedRepo.addConfirmedContact).toHaveBeenCalledTimes(1);
  });
  it('reports partial repository failures so completed enrollments are not hidden', async () => {
    const secondId = '550e8400-e29b-41d4-a716-446655440001';
    jest.mocked(getLeadById)
      .mockResolvedValueOnce(lead)
      .mockResolvedValueOnce({ ...lead, id: secondId, email: 'second@example.com' });
    mockedRepo.addConfirmedContact.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('database unavailable'));
    expect(await addNewsletterContacts({ ...input, leadIds: [id, secondId] }, actor)).toEqual({
      ok: true,
      value: { added: 1, failed: 1, skipped: 0, failedLeadIds: [secondId] },
    });
  });
  it('continues enrolling available leads when another lead lookup fails', async () => {
    const missingId = '550e8400-e29b-41d4-a716-446655440001';
    jest.mocked(getLeadById)
      .mockRejectedValueOnce(new Error('Lead not found'))
      .mockResolvedValueOnce(lead);
    mockedRepo.addConfirmedContact.mockResolvedValue(true);

    expect(await addNewsletterContacts({ ...input, leadIds: [missingId, id] }, actor)).toEqual({
      ok: true,
      value: { added: 1, failed: 1, skipped: 0, failedLeadIds: [missingId] },
    });
    expect(mockedRepo.addConfirmedContact).toHaveBeenCalledTimes(1);
    expect(mockedRepo.addConfirmedContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'lead@example.com',
    }));
  });
  it('rejects marketing before accessing CRM leads', async () => {
    const result = await addNewsletterContacts(input, { ...actor, role: 'marketing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(403);
    expect(getLeadById).not.toHaveBeenCalled();
  });
});
