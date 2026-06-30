/**
 * Unit tests for the Google Calendar connector.
 * Covers loadCredentials() error/success branches and createEvent() success,
 * failure, 401-refresh-retry, and loadCredentials-failure paths.
 * Network is stubbed via loggedFetch; token refresh via global.fetch.
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

import { loadCredentials, createEvent } from './google-calendar.connector';
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
  calendarId: 'primary',
};

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

const INPUT = { summary: 'Follow up', startAt: '2026-06-25T09:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('google-calendar loadCredentials', () => {
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

describe('google-calendar createEvent', () => {
  it('creates an event and returns the event id on success', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'evt1', htmlLink: 'http://cal/evt1' },
    });

    const res = await createEvent(INPUT, 'l1', null);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.eventId).toBe('evt1');
      expect(res.htmlLink).toBe('http://cal/evt1');
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

    const res = await createEvent(INPUT, 'l1', null);

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
        data: { id: 'evt1', htmlLink: 'http://cal/evt1' },
      });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh' }),
    });

    const res = await createEvent(INPUT, 'l1', null);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.eventId).toBe('evt1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockLoggedFetch).toHaveBeenCalledTimes(2);
  });

  it('returns a non-retryable failure when loadCredentials fails', async () => {
    mockFindByName.mockResolvedValue(null);

    const res = await createEvent(INPUT, 'l1', null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryable).toBe(false);
  });
});
