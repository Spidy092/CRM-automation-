jest.mock('./whatsapp/whatsapp.connector', () => ({
  sendMessage: jest.fn(),
}));
jest.mock('./twilio/twilio.connector', () => ({
  sendSms: jest.fn(),
}));
jest.mock('./sendgrid/sendgrid.connector', () => ({
  sendEmail: jest.fn(),
}));
jest.mock('./smtp/smtp.connector', () => ({
  sendEmail: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { dispatchOutbound } from './dispatch';
import * as whatsapp from './whatsapp/whatsapp.connector';
import * as twilio from './twilio/twilio.connector';
import * as sendgrid from './sendgrid/sendgrid.connector';
import * as smtp from './smtp/smtp.connector';

const baseInput = {
  leadId: 'l1',
  campaignId: 'c1',
  templateId: 't1',
  body: 'Hello',
  destination: '+1234567890',
  mockMode: false,
};

beforeEach(() => jest.clearAllMocks());

describe('dispatchOutbound — mockMode', () => {
  it('returns mock result when mockMode is true', async () => {
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp', mockMode: true });
    expect(result.ok).toBe(true);
    expect(result.externalId).toContain('mock-whatsapp');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound — whatsapp', () => {
  it('calls whatsapp connector', async () => {
    (whatsapp.sendMessage as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'wam-1',
      latencyMs: 100,
    });
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-1');
  });

  it('handles whatsapp failure', async () => {
    (whatsapp.sendMessage as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'API error',
      latencyMs: 50,
    });
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('API error');
  });
});

describe('dispatchOutbound — sms', () => {
  it('calls twilio connector', async () => {
    (twilio.sendSms as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'SM-1',
      latencyMs: 80,
    });
    const result = await dispatchOutbound({ ...baseInput, channel: 'sms' });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('SM-1');
  });
});

describe('dispatchOutbound — email', () => {
  it('calls sendgrid when configured', async () => {
    (sendgrid.sendEmail as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'sg-1',
      latencyMs: 120,
    });
    const result = await dispatchOutbound({
      ...baseInput,
      channel: 'email',
      destination: 'test@example.com',
    });
    expect(result.ok).toBe(true);
    expect(smtp.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to SMTP when sendgrid not configured', async () => {
    (sendgrid.sendEmail as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'SendGrid integration not configured',
      latencyMs: 5,
    });
    (smtp.sendEmail as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'smtp-1',
      latencyMs: 80,
    });
    const result = await dispatchOutbound({
      ...baseInput,
      channel: 'email',
      destination: 'test@example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('smtp-1');
  });

  it('does not fall back when sendgrid fails for non-config reason', async () => {
    (sendgrid.sendEmail as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'Rate limit exceeded',
      latencyMs: 10,
    });
    const result = await dispatchOutbound({
      ...baseInput,
      channel: 'email',
      destination: 'test@example.com',
    });
    expect(result.ok).toBe(false);
    expect(smtp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound — phone_call', () => {
  it('returns no-op success for phone_call', async () => {
    const result = await dispatchOutbound({ ...baseInput, channel: 'phone_call' });
    expect(result.ok).toBe(true);
    expect(result.externalId).toContain('phone-task');
  });
});

describe('dispatchOutbound — error handling', () => {
  it('catches connector throws and returns retryable false for config errors', async () => {
    (whatsapp.sendMessage as jest.Mock).mockRejectedValue(new Error('WhatsApp integration not configured'));
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('marks transient errors as retryable', async () => {
    (whatsapp.sendMessage as jest.Mock).mockRejectedValue(new Error('Connection timeout'));
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
  });
});
