import {
  getIntegration,
  listIntegrations,
  testAllIntegrations,
  testIntegration,
  updateIntegration,
} from './integrations.service';
import { Integration } from './integrations.types';

jest.mock('./integrations.repository', () => ({
  findAllPublic: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
  updateIntegration: jest.fn(),
  recordTestResult: jest.fn(),
  pool: { query: jest.fn() },
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

// Mock all connector modules so loadCredentials() / testConnection() don't hit
// the DB / env / network. testConnection defaults to a successful live ping.
jest.mock('./whatsapp/whatsapp.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./twilio/twilio.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./sendgrid/sendgrid.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./smtp/smtp.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./google-sheets/google-sheets.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./google-calendar/google-calendar.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./outlook/outlook.connector', () => ({ loadCredentials: jest.fn(), testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) }));
jest.mock('./openwa/openwa.connector', () => ({ loadCredentials: jest.fn(), healthCheck: jest.fn() }));

jest.mock('../../shared/utils/encryption', () => ({
  encryptJson: jest.fn((v: unknown) => `enc(${JSON.stringify(v)})`),
  decrypt: jest.fn((s: string) => {
    if (!s.startsWith('enc(')) throw new Error('bad ciphertext');
    return s.slice(4, -1);
  }),
  encrypt: jest.fn(),
  decryptJson: jest.fn(),
  isEncryptedPayload: jest.fn(),
}));

import {
  findAllPublic,
  findById,
  findCredentialsById,
  recordTestResult,
  updateIntegration as updateIntegrationRepo,
} from './integrations.repository';
import * as openwaConnector from './openwa/openwa.connector';
import { writeAuditLog } from '../../shared/utils/audit';

const baseRow: Integration = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'whatsapp',
  display_name: 'WhatsApp Cloud API',
  is_enabled: false,
  encrypted_credentials: null,
  last_tested_at: null,
  last_test_status: null,
  updated_by: null,
  updated_at: '2026-06-19T00:00:00Z',
};

describe('listIntegrations / getIntegration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns rows stripped of encrypted_credentials', async () => {
    (findAllPublic as jest.Mock).mockResolvedValue([baseRow]);
    const result = await listIntegrations();
    expect(result).toHaveLength(1);
    expect((result[0] as Integration).encrypted_credentials).toBeUndefined();
    expect(result[0].name).toBe('whatsapp');
  });

  it('throws 404 when integration id does not exist', async () => {
    (findById as jest.Mock).mockResolvedValue(null);
    await expect(getIntegration(baseRow.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns public projection when integration exists', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    const result = await getIntegration(baseRow.id);
    expect(result.id).toBe(baseRow.id);
    expect((result as Integration).encrypted_credentials).toBeUndefined();
  });
});

describe('updateIntegration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when integration does not exist', async () => {
    (findById as jest.Mock).mockResolvedValue(null);
    await expect(
      updateIntegration(baseRow.id, { is_enabled: true }, { id: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates is_enabled without touching credentials, audits with credentials_changed=false', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (updateIntegrationRepo as jest.Mock).mockResolvedValue({ ...baseRow, is_enabled: true });
    const result = await updateIntegration(
      baseRow.id,
      { is_enabled: true },
      { id: 'u1', ipAddress: '127.0.0.1' },
    );
    expect(result.is_enabled).toBe(true);
    expect(updateIntegrationRepo).toHaveBeenCalledWith(
      baseRow.id,
      expect.objectContaining({ isEnabled: true, encryptedCredentials: undefined, updatedBy: 'u1' }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.updated',
        newValue: expect.objectContaining({ credentials_changed: false }),
      }),
    );
  });

  it('encrypts credentials before persisting and marks credentials_changed=true', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (updateIntegrationRepo as jest.Mock).mockResolvedValue({
      ...baseRow,
      is_enabled: true,
      encrypted_credentials: 'enc({"token":"abc"})',
    });
    await updateIntegration(
      baseRow.id,
      { credentials: { token: 'abc' } },
      { id: 'u1' },
    );
    expect(updateIntegrationRepo).toHaveBeenCalledWith(
      baseRow.id,
      expect.objectContaining({
        encryptedCredentials: 'enc({"token":"abc"})',
        updatedBy: 'u1',
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.updated',
        newValue: expect.objectContaining({ credentials_changed: true }),
      }),
    );
  });

  it('passes null through when credentials explicitly nulled out', async () => {
    (findById as jest.Mock).mockResolvedValue({
      ...baseRow,
      encrypted_credentials: 'enc({"token":"abc"})',
    });
    (updateIntegrationRepo as jest.Mock).mockResolvedValue({
      ...baseRow,
      encrypted_credentials: null,
    });
    await updateIntegration(baseRow.id, { credentials: null }, { id: 'u1' });
    expect(updateIntegrationRepo).toHaveBeenCalledWith(
      baseRow.id,
      expect.objectContaining({ encryptedCredentials: null }),
    );
  });

  it('NEVER includes encrypted_credentials in the audit log', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (updateIntegrationRepo as jest.Mock).mockResolvedValue({
      ...baseRow,
      is_enabled: true,
      encrypted_credentials: 'enc(secret)',
    });
    await updateIntegration(baseRow.id, { is_enabled: true }, { id: 'u1' });
    const call = (writeAuditLog as jest.Mock).mock.calls[0][0];
    const allAuditStrings = JSON.stringify(call);
    expect(allAuditStrings).not.toContain('encrypted_credentials');
    expect(allAuditStrings).not.toContain('enc(secret)');
  });
});

describe('testIntegration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when integration does not exist', async () => {
    (findById as jest.Mock).mockResolvedValue(null);
    await expect(testIntegration(baseRow.id, { id: 'u1' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('returns no_credentials when credentials are null', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockResolvedValue(null);
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'no_credentials' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('no_credentials');
    expect(recordTestResult).toHaveBeenCalledWith(baseRow.id, 'no_credentials');
  });

  it('returns ok when credentials decrypt cleanly', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"abc"})');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'ok' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(recordTestResult).toHaveBeenCalledWith(baseRow.id, 'ok');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.tested' }),
    );
  });

  it('returns failed when decryption throws, logs reason', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc(broken)');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'failed' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(recordTestResult).toHaveBeenCalledWith(baseRow.id, 'failed');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.test_failed',
        newValue: expect.objectContaining({ reason: 'decryption_failed' }),
      }),
    );
  });

  it('NEVER logs or returns decrypted credentials', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"SUPER_SECRET"})');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'ok' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    const resultStr = JSON.stringify(result);
    const allAuditCalls = (writeAuditLog as jest.Mock).mock.calls.map((c) => JSON.stringify(c[0]));
    expect(resultStr).not.toContain('SUPER_SECRET');
    expect(allAuditCalls.every((s) => !s.includes('SUPER_SECRET'))).toBe(true);
  });

  it('returns ok when OpenWA health check succeeds', async () => {
    const openwaRow = { ...baseRow, name: 'openwa', display_name: 'OpenWA' };
    (findById as jest.Mock).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock).mockResolvedValue(
      'enc({"baseUrl":"https://openwa.example","apiKey":"key","sessionId":"session","numbers":["+1234567890"]})',
    );
    (openwaConnector.loadCredentials as jest.Mock).mockResolvedValue({
      baseUrl: 'https://openwa.example',
      apiKey: 'key',
      sessionId: 'session',
      numbers: ['+1234567890'],
    });
    (openwaConnector.healthCheck as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 42,
    });
    (recordTestResult as jest.Mock).mockResolvedValue({ ...openwaRow, last_test_status: 'ok' });
    const result = await testIntegration(openwaRow.id, { id: 'u1' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(openwaConnector.loadCredentials).toHaveBeenCalled();
    expect(openwaConnector.healthCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ baseUrl: 'https://openwa.example' }),
      }),
    );
    expect(recordTestResult).toHaveBeenCalledWith(openwaRow.id, 'ok');
  });

  it('returns failed when OpenWA health check fails', async () => {
    const openwaRow = { ...baseRow, name: 'openwa', display_name: 'OpenWA' };
    (findById as jest.Mock).mockResolvedValue(openwaRow);
    (findCredentialsById as jest.Mock).mockResolvedValue(
      'enc({"baseUrl":"https://openwa.example","apiKey":"key","sessionId":"session","numbers":["+1234567890"]})',
    );
    (openwaConnector.loadCredentials as jest.Mock).mockResolvedValue({
      baseUrl: 'https://openwa.example',
      apiKey: 'key',
      sessionId: 'session',
      numbers: ['+1234567890'],
    });
    (openwaConnector.healthCheck as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      latencyMs: 120,
      error: 'OpenWA session unreachable',
    });
    (recordTestResult as jest.Mock).mockResolvedValue({
      ...openwaRow,
      last_test_status: 'failed',
    });
    const result = await testIntegration(openwaRow.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toBe('OpenWA session unreachable');
    expect(recordTestResult).toHaveBeenCalledWith(openwaRow.id, 'failed');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.test_failed',
        newValue: expect.objectContaining({ reason: 'openwa_health_check_failed' }),
      }),
    );
  });

  it('returns failed when reading credentials throws', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockRejectedValue(new Error('db offline'));
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'failed' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Failed to read credentials');
    expect(recordTestResult).toHaveBeenCalledWith(baseRow.id, 'failed');
  });

  it('returns failed with a generic message when the thrown value is not an Error', async () => {
    (findById as jest.Mock).mockResolvedValue(baseRow);
    (findCredentialsById as jest.Mock).mockRejectedValue('plain string');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...baseRow, last_test_status: 'failed' });
    const result = await testIntegration(baseRow.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('unknown error');
  });

  it.each([
    ['twilio', './twilio/twilio.connector'],
    ['sendgrid', './sendgrid/sendgrid.connector'],
    ['smtp', './smtp/smtp.connector'],
    ['google_sheets', './google-sheets/google-sheets.connector'],
    ['google_calendar', './google-calendar/google-calendar.connector'],
    ['outlook', './outlook/outlook.connector'],
  ])('validates %s credentials via its connector and returns ok', async (name, modPath) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const connector = require(modPath) as { loadCredentials: jest.Mock };
    connector.loadCredentials.mockResolvedValue(undefined);
    const row = { ...baseRow, name, display_name: name };
    (findById as jest.Mock).mockResolvedValue(row);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"abc"})');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...row, last_test_status: 'ok' });
    const result = await testIntegration(row.id, { id: 'u1' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(connector.loadCredentials).toHaveBeenCalled();
    expect(recordTestResult).toHaveBeenCalledWith(row.id, 'ok');
  });

  it('uses the default branch for an unknown connector name', async () => {
    const row = { ...baseRow, name: 'some_unknown_provider', display_name: 'Mystery Provider' };
    (findById as jest.Mock).mockResolvedValue(row);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"abc"})');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...row, last_test_status: 'ok' });
    const result = await testIntegration(row.id, { id: 'u1' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Mystery Provider');
  });

  it('returns failed when a connector loadCredentials throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const twilio = require('./twilio/twilio.connector') as { loadCredentials: jest.Mock };
    twilio.loadCredentials.mockRejectedValue(new Error('invalid shape'));
    const row = { ...baseRow, name: 'twilio', display_name: 'Twilio' };
    (findById as jest.Mock).mockResolvedValue(row);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"abc"})');
    (recordTestResult as jest.Mock).mockResolvedValue({ ...row, last_test_status: 'failed' });
    const result = await testIntegration(row.id, { id: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Connector credential validation failed');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.test_failed',
        newValue: expect.objectContaining({ reason: 'connector_validation_failed' }),
      }),
    );
  });
});

describe('testAllIntegrations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips disabled integrations and tests only enabled ones', async () => {
    const enabledRow = { ...baseRow, id: 'a', name: 'twilio', display_name: 'Twilio', is_enabled: true };
    const disabledRow = { ...baseRow, id: 'b', name: 'smtp', display_name: 'SMTP', is_enabled: false };
    (findAllPublic as jest.Mock).mockResolvedValue([enabledRow, disabledRow]);
    // testIntegration internals for the enabled one
    (findById as jest.Mock).mockResolvedValue(enabledRow);
    (findCredentialsById as jest.Mock).mockResolvedValue('enc({"token":"abc"})');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const twilio = require('./twilio/twilio.connector') as { loadCredentials: jest.Mock };
    twilio.loadCredentials.mockResolvedValue(undefined);
    (recordTestResult as jest.Mock).mockResolvedValue({ ...enabledRow, last_test_status: 'ok' });

    const result = await testAllIntegrations({ id: 'u1' });
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('a');
    expect(result.results[0].ok).toBe(true);
  });

  it('counts failures when an enabled integration fails the test', async () => {
    const enabledRow = { ...baseRow, id: 'a', name: 'twilio', display_name: 'Twilio', is_enabled: true };
    (findAllPublic as jest.Mock).mockResolvedValue([enabledRow]);
    (findById as jest.Mock).mockResolvedValue(enabledRow);
    (findCredentialsById as jest.Mock).mockResolvedValue(null);
    (recordTestResult as jest.Mock).mockResolvedValue({ ...enabledRow, last_test_status: 'no_credentials' });

    const result = await testAllIntegrations({ id: 'u1' });
    expect(result.total).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(false);
  });

  it('falls back gracefully when testIntegration itself throws (404)', async () => {
    const enabledRow = { ...baseRow, id: 'a', name: 'twilio', display_name: 'Twilio', is_enabled: true };
    (findAllPublic as jest.Mock).mockResolvedValue([enabledRow]);
    // findById returns null inside testIntegration -> throws AppError 404
    (findById as jest.Mock).mockResolvedValue(null);

    const result = await testAllIntegrations({ id: 'u1' });
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].message).toContain('Integration not found');
  });

  it('returns all-zero counts when there are no integrations', async () => {
    (findAllPublic as jest.Mock).mockResolvedValue([]);
    const result = await testAllIntegrations({ id: 'u1' });
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});