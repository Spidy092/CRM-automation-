jest.mock('./newsletter.repository', () => ({
  findSubscriberByEmail: jest.fn(),
  findSubscriberById: jest.fn(),
  findSubscriberByUnsubscribeTokenHash: jest.fn(),
  insertSubscriber: jest.fn(),
  resetToPending: jest.fn(),
  markConfirmed: jest.fn(),
  markUnsubscribed: jest.fn(),
  updatePreferences: jest.fn(),
  findSubscribers: jest.fn(),
  countSubscribers: jest.fn(),
}));
jest.mock('../../shared/utils/redis', () => ({
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('../integrations/sendgrid/sendgrid.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../integrations/smtp/smtp.connector', () => ({ sendEmail: jest.fn() }));

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
  DEFAULT_DIGEST_CONFIG,
} from './newsletter.service';

const mockedRepo = repo as jest.Mocked<typeof repo>;
const mockedRedis = redis as unknown as { get: jest.Mock; set: jest.Mock; del: jest.Mock };
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
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue({ ...baseRow, status: 'confirmed' });
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(true);
      expect(mockedRepo.markUnsubscribed).toHaveBeenCalledWith('sub-1');
    });

    it('is idempotent for an already unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue({ ...baseRow, status: 'unsubscribed' });
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(true);
      expect(mockedRepo.markUnsubscribed).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue(null);
      const result = await unsubscribe('raw-token');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });
  });

  describe('getPreferences', () => {
    it('returns topics/frequency/status for a known token', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue({ ...baseRow });
      const result = await getPreferences('raw-token');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ topics: ['promotions'], frequency: 'weekly', status: 'pending' });
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue(null);
      const result = await getPreferences('raw-token');
      expect(result.ok).toBe(false);
    });
  });

  describe('updateSubscriberPreferences', () => {
    it('updates preferences for a non-unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue({ ...baseRow, status: 'confirmed' });
      mockedRepo.updatePreferences.mockResolvedValue({ ...baseRow, frequency: 'monthly' });
      const result = await updateSubscriberPreferences('raw-token', { frequency: 'monthly' });
      expect(result.ok).toBe(true);
      expect(mockedRepo.updatePreferences).toHaveBeenCalledWith('sub-1', { frequency: 'monthly' });
    });

    it('rejects updates for an unsubscribed subscriber', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue({ ...baseRow, status: 'unsubscribed' });
      const result = await updateSubscriberPreferences('raw-token', { frequency: 'monthly' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(400);
      expect(mockedRepo.updatePreferences).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown token', async () => {
      mockedRepo.findSubscriberByUnsubscribeTokenHash.mockResolvedValue(null);
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
});
