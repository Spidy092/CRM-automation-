/**
 * Unit tests for the Twilio Programmable Messaging connector.
 * Covers loadCredentials() error/success branches and sendSms() success +
 * failure paths. Network is stubbed via loggedFetch.
 */

jest.mock('../integrations.repository', () => ({
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
}));
jest.mock('../../../shared/utils/encryption', () => ({
  decryptJson: jest.fn(),
}));
jest.mock('../connector.base', () => ({
  ...jest.requireActual('../connector.base'),
  loggedFetch: jest.fn(),
}));

import { loadCredentials, sendSms } from './twilio.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const VALID = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'tok', fromNumber: '+12025551234' };

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => jest.clearAllMocks());

describe('twilio loadCredentials', () => {
  it('throws 404 when integration row is missing', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 when credentials are not set', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws an AppError when decryption fails', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('bad');
    mockDecrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    await expect(loadCredentials()).rejects.toBeInstanceOf(AppError);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws 422 when stored credentials fail schema validation', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('blob');
    mockDecrypt.mockReturnValue({ accountSid: 'not-valid', authToken: '', fromNumber: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ fromNumber: '+12025551234' });
  });
});

describe('twilio sendSms', () => {
  it('sends an SMS and returns the external id on success', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'x', latencyMs: 10 });

    const res = await sendSms({ leadId: 'l1', to: '+12025550000', body: 'hi' });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalId).toBe('x');
  });

  it('propagates a failure result', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'HTTP 500',
      latencyMs: 5,
      retryable: true,
    });

    const res = await sendSms({ leadId: 'l1', to: '+12025550000', body: 'hi' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('HTTP 500');
  });
});
