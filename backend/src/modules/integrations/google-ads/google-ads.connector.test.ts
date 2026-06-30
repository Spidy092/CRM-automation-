/**
 * Unit tests for the Google Ads connector.
 * Covers loadCredentials() error/success branches, getAccessToken()
 * fresh/refresh/failure paths, and callRest() success.
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

import { loadCredentials, getAccessToken, callRest } from './google-ads.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

const FRESH = {
  developerToken: 'd',
  clientId: 'c',
  clientSecret: 's',
  refreshToken: 'r',
  accessToken: 'at',
  accessTokenExpiresAt: FUTURE,
};

const NEEDS_REFRESH = {
  developerToken: 'd',
  clientId: 'c',
  clientSecret: 's',
  refreshToken: 'r',
};

function prime(creds: Record<string, unknown>) {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(creds);
}

beforeEach(() => jest.clearAllMocks());

describe('google-ads loadCredentials', () => {
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
    mockDecrypt.mockReturnValue({ developerToken: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    prime(FRESH);
    await expect(loadCredentials()).resolves.toMatchObject({ developerToken: 'd' });
  });
});

describe('google-ads getAccessToken', () => {
  it('returns the existing token without refreshing when fresh', async () => {
    prime(FRESH);
    const res = await getAccessToken('int-1');
    expect(res.accessToken).toBe('at');
    expect(mockLoggedFetch).not.toHaveBeenCalled();
  });

  it('refreshes and persists when the token is expiring/absent', async () => {
    prime(NEEDS_REFRESH);
    mockLoggedFetch.mockResolvedValue({
      ok: true,
      data: { access_token: 'new', expires_in: 3600 },
    });
    const res = await getAccessToken('int-1');
    expect(res.accessToken).toBe('new');
    expect(mockLoggedFetch).toHaveBeenCalledTimes(1);
  });

  it('throws 502 when the refresh call fails', async () => {
    prime(NEEDS_REFRESH);
    mockLoggedFetch.mockResolvedValue({ ok: false, error: 'no' });
    await expect(getAccessToken('int-1')).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe('google-ads callRest', () => {
  it('performs the REST call with a fresh token and returns ok', async () => {
    prime(FRESH); // fresh token → getAccessToken won't call loggedFetch
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, data: {} });

    const res = await callRest('int-1', '/customers:listAccessibleCustomers', {
      method: 'GET',
    });

    expect(res.ok).toBe(true);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(1);
  });
});
