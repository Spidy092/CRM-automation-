/**
 * Unit tests for webhook-handlers.ts
 *
 * Covers:
 *   - handleWhatsAppMessage: reply recorded, new lead created
 *   - handleWhatsAppStatus: status mapped to outreach_log
 *   - handleTwilioMessage: reply recorded, new lead created
 *   - handleTwilioStatus: delivery status update
 *   - handleSendGridEvents: delivered, open, bounce, unsubscribe
 *   - handleGoogleAdsLeadForm: new lead, duplicate skipped
 */

import {
  handleWhatsAppMessage,
  handleWhatsAppStatus,
  handleTwilioMessage,
  handleTwilioStatus,
  handleSendGridEvents,
  handleGoogleAdsLeadForm,
} from './webhook-handlers';
import { publishAIDomainEvent } from '../shared/events/eventBus';
import { cancelPendingOutreachJobs } from '../workers/queue';

const mockQueryOne = jest.fn();
const mockQuery = jest.fn();

jest.mock('../workers/queue', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  enqueueAiClassifyReply: jest.fn().mockResolvedValue(undefined),
}));

const mockedCancelPendingOutreachJobs = cancelPendingOutreachJobs as jest.Mock;
jest.mock('../shared/utils/db', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../shared/events/eventBus', () => ({
  publishAIDomainEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockedPublishAIDomainEvent = publishAIDomainEvent as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: pool.query returns empty rowCount
  mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
});

// ── WhatsApp message ──────────────────────────────────────────────────────

describe('handleWhatsAppMessage', () => {
  const buildPayload = (from: string, msgId = 'wam123') => ({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id: msgId, from, type: 'text', text: { body: 'Hello' } }],
              metadata: { phone_number_id: 'ph1' },
            },
          },
        ],
      },
    ],
  });

  it('records a reply for an existing lead', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lead-1' }); // SELECT existing lead
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE outreach_logs

    const result = await handleWhatsAppMessage(buildPayload('+12025551234'));

    expect(result.action).toBe('reply_recorded');
    expect(result.leadId).toBe('lead-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE outreach_logs'),
      expect.arrayContaining(['lead-1']),
    );
    expect(mockedPublishAIDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lead.reply.received',
        payload: expect.objectContaining({
          lead_id: 'lead-1',
          channel: 'whatsapp',
          message_id: 'wam:wam123',
          message_text: 'Hello',
          received_at: expect.any(String),
        }),
      }),
    );
  });

  it('does not publish AI event when persistence fails', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lead-1' });
    mockQuery.mockRejectedValueOnce(new Error('DB down'));

    await expect(handleWhatsAppMessage(buildPayload('+12025551234'))).rejects.toThrow('DB down');
    expect(mockedPublishAIDomainEvent).not.toHaveBeenCalled();
  });

  it('creates a new lead when phone is unknown', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing lead
      .mockResolvedValueOnce({ id: 'lead-new' }); // INSERT lead

    const result = await handleWhatsAppMessage(buildPayload('+19995551234'));

    expect(result.action).toBe('lead_created');
    expect(result.leadId).toBe('lead-new');
    expect(mockedPublishAIDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lead.reply.received',
        payload: expect.objectContaining({
          lead_id: 'lead-new',
          channel: 'whatsapp',
          message_id: 'wam:wam123',
          message_text: 'Hello',
        }),
      }),
    );
  });

  it('returns noop when payload has no messages', async () => {
    const result = await handleWhatsAppMessage({ entry: [{ changes: [{ value: {} }] }] });
    expect(result.action).toBe('noop');
  });

  it('cancels pending jobs only for campaigns with an in-flight message on this channel', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lead-1' }); // SELECT existing lead
    // Two outreach_logs rows moved to 'replied' — one per campaign the lead
    // was mid-sequence on for this channel.
    mockQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [{ campaign_id: 'campaign-a' }, { campaign_id: 'campaign-b' }],
    });

    await handleWhatsAppMessage(buildPayload('+12025551234'));

    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledTimes(2);
    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledWith({
      leadId: 'lead-1',
      campaignId: 'campaign-a',
    });
    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledWith({
      leadId: 'lead-1',
      campaignId: 'campaign-b',
    });
    // Must never fall back to a lead-wide cancel (no campaignId) — that
    // would also cancel unrelated campaigns' sequences for this lead.
    expect(mockedCancelPendingOutreachJobs).not.toHaveBeenCalledWith({ leadId: 'lead-1' });
  });
});

// ── WhatsApp status ───────────────────────────────────────────────────────

describe('handleWhatsAppStatus', () => {
  const buildPayload = (status: string, wamId = 'wam456') => ({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: wamId, status }],
            },
          },
        ],
      },
    ],
  });

  it.each([
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['read', 'opened'],
    ['failed', 'failed'],
  ])('maps WhatsApp status %s → log status %s', async (waStatus, logStatus) => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await handleWhatsAppStatus(buildPayload(waStatus));

    expect(result.action).toBe('status_updated');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE outreach_logs'),
      expect.arrayContaining([logStatus, `wam:wam456`]),
    );
  });

  it('returns noop when no statuses in payload', async () => {
    const result = await handleWhatsAppStatus({ entry: [{ changes: [{ value: {} }] }] });
    expect(result.action).toBe('noop');
  });
});

// ── Twilio message ────────────────────────────────────────────────────────

describe('handleTwilioMessage', () => {
  it('records reply for known phone number', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lead-2' });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await handleTwilioMessage({
      From: '+12025559999',
      Body: 'Yes I am interested',
      SmsSid: 'SM123',
    });

    expect(result.action).toBe('reply_recorded');
    expect(result.leadId).toBe('lead-2');
    expect(mockedPublishAIDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lead.reply.received',
        payload: expect.objectContaining({
          lead_id: 'lead-2',
          channel: 'sms',
          message_id: 'tw:SM123',
          message_text: 'Yes I am interested',
          received_at: expect.any(String),
        }),
      }),
    );
  });

  it('creates lead for unknown number', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'lead-sms-new' });

    const result = await handleTwilioMessage({
      From: '+19991112222',
      Body: 'Hi',
      SmsSid: 'SM999',
    });

    expect(result.action).toBe('lead_created');
    expect(result.leadId).toBe('lead-sms-new');
  });

  it('returns noop when From is missing', async () => {
    const result = await handleTwilioMessage({ Body: 'test' });
    expect(result.action).toBe('noop');
  });

  it('cancels pending jobs only for campaigns with an in-flight SMS on this lead', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lead-2' });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ campaign_id: 'campaign-c' }],
    });

    await handleTwilioMessage({
      From: '+12025559999',
      Body: 'Stop texting me',
      SmsSid: 'SM123',
    });

    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledTimes(1);
    expect(mockedCancelPendingOutreachJobs).toHaveBeenCalledWith({
      leadId: 'lead-2',
      campaignId: 'campaign-c',
    });
  });
});

// ── Twilio status ─────────────────────────────────────────────────────────

describe('handleTwilioStatus', () => {
  it.each([
    ['delivered', 'delivered'],
    ['failed', 'failed'],
    ['undelivered', 'failed'],
    ['sent', 'sent'],
  ])('maps Twilio status %s → log status %s', async (twStatus, logStatus) => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await handleTwilioStatus({ MessageSid: 'SM001', MessageStatus: twStatus });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE outreach_logs'),
      expect.arrayContaining([logStatus, 'tw:SM001']),
    );
  });

  it('returns noop when MessageSid is missing', async () => {
    const result = await handleTwilioStatus({ MessageStatus: 'delivered' });
    expect(result.action).toBe('noop');
  });
});

// ── SendGrid events ───────────────────────────────────────────────────────

describe('handleSendGridEvents', () => {
  it('updates log status for delivered event', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await handleSendGridEvents([
      { event: 'delivered', sg_message_id: 'abc123.filter001' },
    ]);

    expect(result.action).toBe('events_processed');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE outreach_logs'),
      expect.arrayContaining(['delivered', 'sg:abc123']),
    );
  });

  it('maps open → opened', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await handleSendGridEvents([{ event: 'open', sg_message_id: 'msg1' }]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['opened']),
    );
  });

  it('marks lead opted_out on unsubscribe event', async () => {
    // First query: UPDATE outreach_logs, second query: UPDATE leads
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE leads (unsubscribe path runs UPDATE leads first)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE outreach_logs

    await handleSendGridEvents([{ event: 'unsubscribe', sg_message_id: 'msg2' }]);

    // At least one UPDATE call should hit the leads table
    const leadUpdateCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes("opted_out"),
    );
    expect(leadUpdateCall).toBeDefined();
  });

  it('maps bounce → failed', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await handleSendGridEvents([{ event: 'bounce', sg_message_id: 'msg3' }]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['failed']),
    );
  });

  it('returns noop for empty array', async () => {
    const result = await handleSendGridEvents([]);
    expect(result.action).toBe('noop');
  });

  it('processes multiple events and counts updates', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await handleSendGridEvents([
      { event: 'delivered', sg_message_id: 'a1' },
      { event: 'open', sg_message_id: 'a2' },
    ]);

    expect(result.details).toContain('2 events');
    expect(result.details).toContain('updated 2');
  });
});

// ── Google Ads lead form ──────────────────────────────────────────────────

describe('handleGoogleAdsLeadForm', () => {
  const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    lead_id: 'gl-001',
    form_id: 'form-1',
    user_column_data: [
      { column_name: 'FULL_NAME', string_value: 'Jane Smith' },
      { column_name: 'EMAIL', string_value: 'jane@example.com' },
      { column_name: 'PHONE_NUMBER', string_value: '+12025551234' },
      { column_name: 'COMPANY_NAME', string_value: 'Acme Corp' },
    ],
    ...overrides,
  });

  it('creates a new lead from Google Ads payload', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing lead by email
      .mockResolvedValueOnce({ id: 'lead-ga-1' }); // INSERT

    const result = await handleGoogleAdsLeadForm(buildPayload());

    expect(result.action).toBe('lead_created');
    expect(result.leadId).toBe('lead-ga-1');
  });

  it('returns lead_updated when email already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing-lead' });

    const result = await handleGoogleAdsLeadForm(buildPayload());

    expect(result.action).toBe('lead_updated');
    expect(result.leadId).toBe('existing-lead');
  });

  it('handles payload with no user_column_data gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'lead-ga-2' });

    const result = await handleGoogleAdsLeadForm({ lead_id: 'gl-002' });

    expect(result.action).toBe('lead_created');
  });
});
