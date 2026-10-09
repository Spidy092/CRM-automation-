import { createHash } from 'crypto';
import { createOutreachUnsubscribeUrl, unsubscribeOutreachRecipient } from './unsubscribe.service';
import { redis } from '../../shared/utils/redis';
import { optOutLeadByEmail } from '../leads/leads.service';

jest.mock('../../shared/utils/redis', () => ({ redis: { set: jest.fn(), get: jest.fn() } }));
jest.mock('../leads/leads.service', () => ({ optOutLeadByEmail: jest.fn() }));
const leadId = '123e4567-e89b-42d3-a456-426614174000';

describe('recipient outreach unsubscribe tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('issues an opaque link and stores only its digest with an email-bound payload', async () => {
    const url = new URL(await createOutreachUnsubscribeUrl(leadId, 'Recipient@example.com'));
    const token = url.searchParams.get('token') ?? '';
    expect(url.pathname).toBe('/outreach/unsubscribe');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const [key, stored, expiryMode, ttl] = (redis.set as jest.Mock).mock.calls[0];
    expect(key).toBe(`outreach:unsubscribe:${createHash('sha256').update(token).digest('hex')}`);
    expect(stored).not.toContain('Recipient@example.com');
    expect(JSON.parse(stored)).toMatchObject({
      leadId,
      emailHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(expiryMode).toBe('EX');
    expect(ttl).toBeGreaterThan(0);
  });

  it('rejects unknown tokens without changing a lead', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    await expect(unsubscribeOutreachRecipient('a'.repeat(64))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(optOutLeadByEmail).not.toHaveBeenCalled();
  });

  it('uses the stored lead and address hash rather than a client-supplied identifier', async () => {
    const emailHash = 'b'.repeat(64);
    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify({ leadId, emailHash }));
    await unsubscribeOutreachRecipient('a'.repeat(64));
    expect(optOutLeadByEmail).toHaveBeenCalledWith(leadId, emailHash);
  });
});
