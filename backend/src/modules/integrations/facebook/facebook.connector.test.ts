/**
 * Unit tests for the Facebook Lead Ads connector.
 * Covers loadCredentials() error/success branches, exchangeForLongLivedToken()
 * success/failure/missing-token paths, and fetchFormLeads() (non-expiring creds).
 * Network is stubbed via loggedFetch.
 */

jest.mock('../integrations.repository', () => ({
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
  updateIntegration: jest.fn(),
}));
jest.mock('../../../shared/utils/encryption', () => ({
  decryptJson: jest.fn(),
  encryptJson: jest.fn(() => 'enc'),
}));
jest.mock('../connector.base', () => ({
  ...jest.requireActual('../connector.base'),
  loggedFetch: jest.fn(),
}));

import {
  loadCredentials,
  exchangeForLongLivedToken,
  fetchFormLeads,
} from './facebook.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

// NOTE: no accessTokenExpiresAt → isExpiringSoon() returns false (long-lived).
const VALID = { appId: 'a', appSecret: 's', accessToken: 't' };

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => jest.clearAllMocks());

describe('facebook loadCredentials', () => {
  it('throws 404 when integration row is missing', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 when credentials are not set', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws AppError when decryption fails', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('bad');
    mockDecrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    await expect(loadCredentials()).rejects.toBeInstanceOf(AppError);
  });

  it('throws 422 when stored credentials fail schema validation', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('blob');
    mockDecrypt.mockReturnValue({ appId: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ appId: 'a' });
  });
});

describe('facebook exchangeForLongLivedToken', () => {
  it('returns the long-lived access token on success', async () => {
    mockLoggedFetch.mockResolvedValue({
      ok: true,
      data: { access_token: 'll', expires_in: 5184000 },
    });
    const res = await exchangeForLongLivedToken(VALID as never);
    expect(res.accessToken).toBe('ll');
    expect(mockLoggedFetch).toHaveBeenCalledTimes(1);
  });

  it('throws 502 when the exchange fails', async () => {
    mockLoggedFetch.mockResolvedValue({ ok: false, error: 'bad' });
    await expect(exchangeForLongLivedToken(VALID as never)).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it('throws 502 when the response is missing the access token', async () => {
    mockLoggedFetch.mockResolvedValue({ ok: true, data: {} });
    await expect(exchangeForLongLivedToken(VALID as never)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

describe('facebook fetchFormLeads', () => {
  it('calls loggedFetch once and returns its result for non-expiring creds', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, data: { data: [] } });

    const res = await fetchFormLeads('int-1', 'form-1', new Date('2026-06-01T00:00:00Z'));

    expect(res.ok).toBe(true);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(1);
  });
});
