/**
 * Unit tests for the Google Sheets connector.
 * Covers loadCredentials() error/success branches and appendRows() success,
 * failure, 401-refresh-retry, no-spreadsheetId, and loadCredentials-failure
 * paths. Network is stubbed via loggedFetch; token refresh via global.fetch.
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

import { loadCredentials, appendRows } from './google-sheets.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const VALID = {
  clientId: 'c',
  clientSecret: 's',
  accessToken: 'a',
  refreshToken: 'r',
  spreadsheetId: 'sheet1',
};

function primeValidCreds(overrides: Partial<typeof VALID> = {}) {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue({ ...VALID, ...overrides });
}

const INPUT = { values: [['a', 'b']] };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('google-sheets loadCredentials', () => {
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
    mockDecrypt.mockReturnValue({ clientId: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ clientId: 'c' });
  });
});

describe('google-sheets appendRows', () => {
  it('appends rows and returns the updated range on success', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { updates: { updatedRange: 'Sheet1!A1', updatedRows: 1 } },
    });

    const res = await appendRows(INPUT, 'l1', null);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.updatedRange).toBe('Sheet1!A1');
      expect(res.updatedRows).toBe(1);
    }
  });

  it('propagates a failure result', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'HTTP 500',
      retryable: true,
    });

    const res = await appendRows(INPUT, 'l1', null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('HTTP 500');
  });

  it('refreshes the token and retries once on 401', async () => {
    primeValidCreds();
    mockLoggedFetch
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { updates: { updatedRange: 'Sheet1!A1', updatedRows: 1 } },
      });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh' }),
    });

    const res = await appendRows(INPUT, 'l1', null);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.updatedRange).toBe('Sheet1!A1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(2);
  });

  it('fails when no spreadsheetId is provided in input or credentials', async () => {
    primeValidCreds({ spreadsheetId: undefined });

    const res = await appendRows({ values: [['a']] }, 'l1', null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/spreadsheetId/i);
    expect(mockLoggedFetch).not.toHaveBeenCalled();
  });

  it('returns a non-retryable failure when loadCredentials fails', async () => {
    mockFindByName.mockResolvedValue(null);

    const res = await appendRows(INPUT, 'l1', null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryable).toBe(false);
  });
});
