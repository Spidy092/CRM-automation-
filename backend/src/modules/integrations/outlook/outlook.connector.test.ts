/**
 * Unit tests for the Microsoft Outlook / Graph API email connector.
 * Covers loadCredentials() branches and sendEmail() success / failure /
 * 401-refresh-retry paths. The main send uses loggedFetch (mocked); the
 * token refresh uses raw global fetch (mocked).
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
jest.mock('../../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { loadCredentials, sendEmail } from './outlook.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const VALID = {
  tenantId: 't',
  clientId: 'c',
  clientSecret: 's',
  accessToken: 'a',
  refreshToken: 'r',
  fromAddress: 'crm@x.com',
};

const INPUT = {
  leadId: 'l1',
  to: 'dest@x.com',
  subject: 'Hi',
  htmlBody: '<p>Hello</p>',
};

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('outlook loadCredentials', () => {
  it('throws 404 when integration row is missing', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 when credentials are not set', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws 422 when decryption fails', async () => {
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
    mockDecrypt.mockReturnValue({ tenantId: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ tenantId: 't', fromAddress: 'crm@x.com' });
  });
});

describe('outlook sendEmail', () => {
  it('returns ok on a successful send', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 202, latencyMs: 10 });

    const res = await sendEmail(INPUT);

    expect(res.ok).toBe(true);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns a failure when loggedFetch reports a non-401 error', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: false, status: 500, error: 'HTTP 500', retryable: true, latencyMs: 5 });

    const res = await sendEmail(INPUT);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('HTTP 500');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes the token and retries on a 401, then succeeds', async () => {
    primeValidCreds();
    mockLoggedFetch
      .mockResolvedValueOnce({ ok: false, status: 401, error: 'HTTP 401', latencyMs: 4 })
      .mockResolvedValueOnce({ ok: true, status: 202, latencyMs: 9 });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh' }),
    });

    const res = await sendEmail(INPUT);

    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(2);
    // Second send must carry the refreshed token.
    const [, secondInit] = mockLoggedFetch.mock.calls[1];
    expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });
});
