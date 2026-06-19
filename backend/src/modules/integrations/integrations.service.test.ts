import {
  getIntegration,
  listIntegrations,
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
});