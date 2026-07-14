import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./integrations.repository', () => ({
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
}));
jest.mock('../../shared/utils/encryption', () => ({
  decryptJson: jest.fn((payload: string) => JSON.parse(payload)),
}));
jest.mock('./whatsapp/whatsapp.connector', () => ({
  sendMessage: jest.fn(),
}));
jest.mock('./openwa/openwa.connector', () => ({
  loadCredentials: jest.fn(),
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
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { dispatchOutbound } from './dispatch';
import { findByName, findCredentialsById } from './integrations.repository';
import { decryptJson } from '../../shared/utils/encryption';
import * as whatsapp from './whatsapp/whatsapp.connector';
import * as openwa from './openwa/openwa.connector';
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

const openwaRow = {
  id: 'ow-1',
  name: 'openwa',
  display_name: 'OpenWA',
  is_enabled: true,
  encrypted_credentials: JSON.stringify({
    baseUrl: 'https://openwa.example.com',
    apiKey: 'key',
    sessionId: 'session',
    numbers: ['+1111111111'],
  }),
  last_tested_at: null,
  last_test_status: null,
  updated_by: null,
  updated_at: '2026-06-27T00:00:00Z',
};

const openwaCredentials = {
  baseUrl: 'https://openwa.example.com',
  apiKey: 'key',
  sessionId: 'session',
  numbers: ['+1111111111'],
  antiBan: {},
};

beforeEach(() => { jest.clearAllMocks(); });

describe('dispatchOutbound — mockMode', () => {
  it('returns mock result when mockMode is true', async () => {
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp', mockMode: true });
    expect(result.ok).toBe(true);
    expect(result.externalId).toContain('mock-whatsapp');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(openwa.sendMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound — whatsapp with OpenWA fallback', () => {
  it('uses openwa connector when openwa is enabled and credentials are valid', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(openwaRow.encrypted_credentials);
    (openwa.loadCredentials as jest.Mock<any>).mockResolvedValue(openwaCredentials);
    (openwa.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      status: 200,
      data: { messageId: 'openwa-msg-1', numberUsed: '+1111111111' },
      externalId: 'openwa-msg-1',
      latencyMs: 120,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(findByName).toHaveBeenCalledWith('openwa');
    expect(findCredentialsById).toHaveBeenCalledWith(openwaRow.id);
    expect(decryptJson).toHaveBeenCalledWith(openwaRow.encrypted_credentials);
    expect(openwa.loadCredentials).toHaveBeenCalledWith(JSON.parse(openwaRow.encrypted_credentials));
    expect(openwa.sendMessage).toHaveBeenCalledWith({
      credentials: openwaCredentials,
      leadId: baseInput.leadId,
      campaignId: baseInput.campaignId,
      to: baseInput.destination,
      body: baseInput.body,
      integrationId: openwaRow.id,
    });
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('openwa-msg-1');
    expect(result.channel).toBe('openwa');
    expect(result.retryable).toBe(false);
  });

  it('falls back to whatsapp cloud api when openwa is disabled', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue({ ...openwaRow, is_enabled: false });
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'wam-1',
      latencyMs: 100,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).toHaveBeenCalledWith({
      leadId: baseInput.leadId,
      campaignId: baseInput.campaignId,
      to: baseInput.destination,
      body: baseInput.body,
    });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-1');
    expect(result.channel).toBe('whatsapp');
  });

  it('falls back to whatsapp cloud api when openwa is not found', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(null);
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'wam-2',
      latencyMs: 100,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(findCredentialsById).not.toHaveBeenCalled();
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-2');
    expect(result.channel).toBe('whatsapp');
  });

  it('falls back to whatsapp cloud api when openwa has no credentials', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(null);
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'wam-3',
      latencyMs: 100,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(openwa.loadCredentials).not.toHaveBeenCalled();
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-3');
    expect(result.channel).toBe('whatsapp');
  });

  it('returns retryable failure when openwa is enabled but sendMessage fails retryably', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(openwaRow.encrypted_credentials);
    (openwa.loadCredentials as jest.Mock<any>).mockResolvedValue(openwaCredentials);
    (openwa.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: false,
      status: 503,
      error: 'OpenWA service unavailable',
      latencyMs: 80,
      retryable: true,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('OpenWA service unavailable');
    expect(result.retryable).toBe(true);
    expect(result.channel).toBe('openwa');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('returns non-retryable failure when openwa is enabled but sendMessage fails non-retryably', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(openwaRow.encrypted_credentials);
    (openwa.loadCredentials as jest.Mock<any>).mockResolvedValue(openwaCredentials);
    (openwa.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'OpenWA invalid credentials',
      latencyMs: 60,
      retryable: false,
    });

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('OpenWA invalid credentials');
    expect(result.retryable).toBe(false);
    expect(result.channel).toBe('openwa');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('returns non-retryable failure when openwa credentials fail validation', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(openwaRow.encrypted_credentials);
    (openwa.loadCredentials as jest.Mock<any>).mockRejectedValue(
      new Error('OpenWA credentials invalid: baseUrl must start with http:// or https://'),
    );

    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('OpenWA credentials invalid');
    expect(result.retryable).toBe(false);
    expect(result.channel).toBe('openwa');
    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchOutbound — whatsapp with attachments', () => {
  const attachment = {
    filename: 'flyer.png',
    mimeType: 'image/png',
    url: 'http://x/flyer.png',
    storagePath: '/x/flyer.png',
  };

  it('skips OpenWA entirely and sends via the cloud API as a media message when attachments are present', async () => {
    (findByName as jest.Mock<any>).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock<any>).mockResolvedValue(openwaRow.encrypted_credentials);
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'wam-media-1',
      latencyMs: 90,
    });

    const result = await dispatchOutbound({
      ...baseInput,
      channel: 'whatsapp',
      attachments: [attachment],
    });

    expect(openwa.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).toHaveBeenCalledWith({
      leadId: baseInput.leadId,
      campaignId: baseInput.campaignId,
      to: baseInput.destination,
      body: baseInput.body,
      media: { url: attachment.url, mimeType: attachment.mimeType, filename: attachment.filename },
    });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-media-1');
  });
});

describe('dispatchOutbound — whatsapp (cloud api only)', () => {
  beforeEach(() => {
    (findByName as jest.Mock<any>).mockResolvedValue(null);
  });

  it('calls whatsapp connector', async () => {
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'wam-1',
      latencyMs: 100,
    });
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('wam-1');
  });

  it('handles whatsapp failure', async () => {
    (whatsapp.sendMessage as jest.Mock<any>).mockResolvedValue({
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
  beforeEach(() => {
    (findByName as jest.Mock<any>).mockResolvedValue(null);
  });

  it('calls twilio connector', async () => {
    (twilio.sendSms as jest.Mock<any>).mockResolvedValue({
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
  beforeEach(() => {
    (findByName as jest.Mock<any>).mockResolvedValue(null);
  });

  it('calls sendgrid when configured', async () => {
    (sendgrid.sendEmail as jest.Mock<any>).mockResolvedValue({
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
    (sendgrid.sendEmail as jest.Mock<any>).mockResolvedValue({
      ok: false,
      error: 'SendGrid integration not configured',
      latencyMs: 5,
    });
    (smtp.sendEmail as jest.Mock<any>).mockResolvedValue({
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
    (sendgrid.sendEmail as jest.Mock<any>).mockResolvedValue({
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

  const attachment = {
    filename: 'flyer.png',
    mimeType: 'image/png',
    url: 'http://x/flyer.png',
    storagePath: '/x/flyer.png',
  };

  it('passes attachments through to sendgrid', async () => {
    (sendgrid.sendEmail as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'sg-1',
      latencyMs: 120,
    });
    await dispatchOutbound({
      ...baseInput,
      channel: 'email',
      destination: 'test@example.com',
      attachments: [attachment],
    });
    expect(sendgrid.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [attachment] }),
    );
  });

  it('passes attachments through to the SMTP fallback', async () => {
    (sendgrid.sendEmail as jest.Mock<any>).mockResolvedValue({
      ok: false,
      error: 'SendGrid integration not configured',
      latencyMs: 5,
    });
    (smtp.sendEmail as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'smtp-1',
      latencyMs: 80,
    });
    await dispatchOutbound({
      ...baseInput,
      channel: 'email',
      destination: 'test@example.com',
      attachments: [attachment],
    });
    expect(smtp.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [attachment] }),
    );
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
  beforeEach(() => {
    (findByName as jest.Mock<any>).mockResolvedValue(null);
  });

  it('catches connector throws and returns retryable false for config errors', async () => {
    (whatsapp.sendMessage as jest.Mock<any>).mockRejectedValue(
      new Error('WhatsApp integration not configured'),
    );
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('marks transient errors as retryable', async () => {
    (whatsapp.sendMessage as jest.Mock<any>).mockRejectedValue(new Error('Connection timeout'));
    const result = await dispatchOutbound({ ...baseInput, channel: 'whatsapp' });
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
  });
});
