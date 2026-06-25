/**
 * Unit tests for Sprint 3 connector modules.
 *
 * Tests credential schema validation for:
 *   - WhatsApp connector      (loadCredentials shape check)
 *   - Twilio connector        (loadCredentials shape check)
 *   - SendGrid connector      (loadCredentials shape check)
 *   - SMTP connector          (loadCredentials shape check)
 *   - Google Sheets connector (loadCredentials shape check)
 *   - Google Calendar connector (loadCredentials shape check)
 *   - Outlook connector       (loadCredentials shape check)
 *
 * Live API calls are NOT made — connectors are tested against mock
 * credential payloads and the underlying DB / encryption utilities
 * are stubbed.
 */

import { whatsappCredentialsSchema } from '../whatsapp/whatsapp.connector';
import { twilioCredentialsSchema } from '../twilio/twilio.connector';
import { sendgridCredentialsSchema } from '../sendgrid/sendgrid.connector';
import { smtpCredentialsSchema } from '../smtp/smtp.connector';
import { googleSheetsCredentialsSchema } from '../google-sheets/google-sheets.connector';
import { googleCalendarCredentialsSchema } from '../google-calendar/google-calendar.connector';
import { outlookCredentialsSchema } from '../outlook/outlook.connector';

// ── WhatsApp credential schema ────────────────────────────────────────────

describe('whatsappCredentialsSchema', () => {
  const valid = {
    phoneNumberId: '12345678901234',
    apiToken: 'EAAGXXXXXXXXXXXX',
    apiVersion: 'v20.0',
  };

  it('accepts valid credentials', () => {
    const result = whatsappCredentialsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('defaults apiVersion to v20.0 when omitted', () => {
    const { apiVersion: _v, ...withoutVersion } = valid;
    const result = whatsappCredentialsSchema.safeParse(withoutVersion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiVersion).toBe('v20.0');
    }
  });

  it('rejects when phoneNumberId is empty', () => {
    const result = whatsappCredentialsSchema.safeParse({ ...valid, phoneNumberId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects when apiToken is missing', () => {
    const { apiToken: _t, ...withoutToken } = valid;
    const result = whatsappCredentialsSchema.safeParse(withoutToken);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    const result = whatsappCredentialsSchema.safeParse({ ...valid, unknownField: 'x' });
    expect(result.success).toBe(false);
  });
});

// ── Twilio credential schema ──────────────────────────────────────────────

describe('twilioCredentialsSchema', () => {
  const valid = {
    accountSid: 'AC' + 'a'.repeat(32),
    authToken: 'token123',
    fromNumber: '+12025551234',
  };

  it('accepts valid credentials', () => {
    expect(twilioCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects accountSid not starting with AC', () => {
    const result = twilioCredentialsSchema.safeParse({ ...valid, accountSid: 'XX12345' });
    expect(result.success).toBe(false);
  });

  it('rejects empty authToken', () => {
    const result = twilioCredentialsSchema.safeParse({ ...valid, authToken: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty fromNumber', () => {
    const result = twilioCredentialsSchema.safeParse({ ...valid, fromNumber: '' });
    expect(result.success).toBe(false);
  });
});

// ── SendGrid credential schema ────────────────────────────────────────────

describe('sendgridCredentialsSchema', () => {
  const valid = {
    apiKey: 'SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(22),
    fromEmail: 'sender@example.com',
    fromName: 'My Company',
  };

  it('accepts valid credentials', () => {
    expect(sendgridCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts credentials without fromName', () => {
    const { fromName: _n, ...withoutName } = valid;
    expect(sendgridCredentialsSchema.safeParse(withoutName).success).toBe(true);
  });

  it('rejects apiKey not matching SG.xxx pattern', () => {
    const result = sendgridCredentialsSchema.safeParse({ ...valid, apiKey: 'invalid-key' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid fromEmail', () => {
    const result = sendgridCredentialsSchema.safeParse({ ...valid, fromEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });
});

// ── SMTP credential schema ────────────────────────────────────────────────

describe('smtpCredentialsSchema', () => {
  const valid = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'user@example.com',
    pass: 'secret123',
    fromEmail: 'outreach@example.com',
    fromName: 'Outreach',
  };

  it('accepts valid credentials', () => {
    expect(smtpCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults secure to false when omitted', () => {
    const { secure: _s, ...withoutSecure } = valid;
    const result = smtpCredentialsSchema.safeParse(withoutSecure);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.secure).toBe(false);
    }
  });

  it('rejects when host is empty', () => {
    const result = smtpCredentialsSchema.safeParse({ ...valid, host: '' });
    expect(result.success).toBe(false);
  });

  it('rejects port out of range', () => {
    expect(smtpCredentialsSchema.safeParse({ ...valid, port: 0 }).success).toBe(false);
    expect(smtpCredentialsSchema.safeParse({ ...valid, port: 70000 }).success).toBe(false);
  });

  it('rejects invalid fromEmail', () => {
    const result = smtpCredentialsSchema.safeParse({ ...valid, fromEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });
});

// ── Google Sheets credential schema ──────────────────────────────────────────

describe('googleSheetsCredentialsSchema', () => {
  const valid = {
    clientId: 'client-id-123.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-secret',
    accessToken: 'ya29.accessToken',
    refreshToken: '1//refreshToken',
    spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
  };

  it('accepts valid credentials', () => {
    expect(googleSheetsCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts credentials without spreadsheetId', () => {
    const { spreadsheetId: _s, ...withoutSheet } = valid;
    expect(googleSheetsCredentialsSchema.safeParse(withoutSheet).success).toBe(true);
  });

  it('rejects when clientId is empty', () => {
    expect(googleSheetsCredentialsSchema.safeParse({ ...valid, clientId: '' }).success).toBe(false);
  });

  it('rejects when accessToken is missing', () => {
    const { accessToken: _a, ...withoutToken } = valid;
    expect(googleSheetsCredentialsSchema.safeParse(withoutToken).success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(googleSheetsCredentialsSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false);
  });
});

// ── Google Calendar credential schema ─────────────────────────────────────────

describe('googleCalendarCredentialsSchema', () => {
  const valid = {
    clientId: 'client-id-456.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-cal-secret',
    accessToken: 'ya29.calAccessToken',
    refreshToken: '1//calRefreshToken',
    calendarId: 'primary',
  };

  it('accepts valid credentials', () => {
    expect(googleCalendarCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts credentials without calendarId', () => {
    const { calendarId: _c, ...withoutCal } = valid;
    expect(googleCalendarCredentialsSchema.safeParse(withoutCal).success).toBe(true);
  });

  it('rejects when refreshToken is empty', () => {
    expect(
      googleCalendarCredentialsSchema.safeParse({ ...valid, refreshToken: '' }).success,
    ).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(googleCalendarCredentialsSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false);
  });
});

// ── Outlook credential schema ─────────────────────────────────────────────────

describe('outlookCredentialsSchema', () => {
  const valid = {
    tenantId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    clientId: 'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy',
    clientSecret: 'secret~value',
    accessToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9',
    refreshToken: '0.AQYAxxxxxxx',
    fromAddress: 'crm@contoso.com',
  };

  it('accepts valid credentials', () => {
    expect(outlookCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts credentials with fromName', () => {
    expect(outlookCredentialsSchema.safeParse({ ...valid, fromName: 'CRM Team' }).success).toBe(true);
  });

  it('rejects invalid fromAddress', () => {
    expect(outlookCredentialsSchema.safeParse({ ...valid, fromAddress: 'not-an-email' }).success).toBe(false);
  });

  it('rejects when tenantId is empty', () => {
    expect(outlookCredentialsSchema.safeParse({ ...valid, tenantId: '' }).success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(outlookCredentialsSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false);
  });
});

// ── dispatch.ts: SMTP fallback logic ────────────────────────────────────────
// Tested indirectly via the email case in dispatchOutbound.

jest.mock('../whatsapp/whatsapp.connector', () => ({
  ...jest.requireActual('../whatsapp/whatsapp.connector'),
  sendMessage: jest.fn(),
}));
jest.mock('../twilio/twilio.connector', () => ({
  ...jest.requireActual('../twilio/twilio.connector'),
  sendSms: jest.fn(),
}));
jest.mock('../sendgrid/sendgrid.connector', () => ({
  ...jest.requireActual('../sendgrid/sendgrid.connector'),
  sendEmail: jest.fn(),
}));
jest.mock('../smtp/smtp.connector', () => ({
  ...jest.requireActual('../smtp/smtp.connector'),
  sendEmail: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { dispatchOutbound } from '../dispatch';
import * as sendgridConnector from '../sendgrid/sendgrid.connector';
import * as smtpConnector from '../smtp/smtp.connector';

describe('dispatchOutbound — email channel with SMTP fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseInput = {
    leadId: 'l1',
    campaignId: 'c1',
    channel: 'email' as const,
    templateId: 't1',
    body: '<p>Hello</p>',
    destination: 'lead@example.com',
    subject: 'Outreach',
    mockMode: false,
  };

  it('returns sendgrid result when sendgrid succeeds', async () => {
    (sendgridConnector.sendEmail as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'sg-ext-1',
      latencyMs: 50,
    });

    const outcome = await dispatchOutbound(baseInput);

    expect(outcome.ok).toBe(true);
    expect(outcome.externalId).toBe('sg-ext-1');
    expect(smtpConnector.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to SMTP when sendgrid returns "not configured" error', async () => {
    (sendgridConnector.sendEmail as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'SendGrid integration not configured',
      latencyMs: 5,
    });
    (smtpConnector.sendEmail as jest.Mock).mockResolvedValue({
      ok: true,
      externalId: 'smtp-ext-1',
      latencyMs: 80,
    });

    const outcome = await dispatchOutbound(baseInput);

    expect(outcome.ok).toBe(true);
    expect(outcome.externalId).toBe('smtp-ext-1');
    expect(smtpConnector.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back to SMTP when sendgrid fails for a non-config reason', async () => {
    (sendgridConnector.sendEmail as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'Rate limit exceeded',
      latencyMs: 10,
      retryable: true,
    });

    const outcome = await dispatchOutbound(baseInput);

    expect(outcome.ok).toBe(false);
    expect(smtpConnector.sendEmail).not.toHaveBeenCalled();
  });

  it('returns mock result when mockMode is true', async () => {
    const outcome = await dispatchOutbound({ ...baseInput, mockMode: true });
    expect(outcome.ok).toBe(true);
    expect(outcome.externalId).toContain('mock-email');
    expect(sendgridConnector.sendEmail).not.toHaveBeenCalled();
  });
});
