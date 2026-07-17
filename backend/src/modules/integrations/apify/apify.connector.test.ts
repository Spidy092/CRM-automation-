/**
 * Unit tests for the Apify connector.
 * Covers loadCredentials() error/success branches, testConnection() success/failure,
 * listActors() success/failure-fallback, and runActorSync() success/failure/timeout paths.
 * Network is stubbed via global.fetch.
 */

jest.mock('../integrations.repository', () => ({
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
}));
jest.mock('../../../shared/utils/encryption', () => ({
  decrypt: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { loadCredentials, testConnection, listActors, runActorSync } from './apify.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decrypt as jest.Mock;

const VALID = { apiToken: 'apify_api_token123' };

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(JSON.stringify(VALID));
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('apify loadCredentials', () => {
  it('throws 404 when integration row is missing', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 when credentials are not set', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws 422 when stored credentials fail schema validation', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('blob');
    mockDecrypt.mockReturnValue(JSON.stringify({ apiToken: '' }));
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject(VALID);
  });

  it('propagates the error when decryption fails', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('bad');
    mockDecrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    await expect(loadCredentials()).rejects.toThrow('bad key');
  });
});

describe('apify testConnection', () => {
  it('returns ok with username on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { username: 'chethan' } }),
    });
    const res = await testConnection(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.username).toBe('chethan');
  });

  it('returns a clear error on 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    const res = await testConnection(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/token/i);
  });

  it('returns a network failure result', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const res = await testConnection(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('network down');
  });
});

describe('apify listActors', () => {
  it('returns mapped actors on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { items: [{ id: 'abc123', name: 'crawler-google-places', username: 'compass', title: 'Google Maps Scraper' }] },
      }),
    });
    const actors = await listActors(VALID);
    expect(actors).toHaveLength(1);
    expect(actors[0].fullName).toBe('compass~crawler-google-places');
  });

  it('returns an empty list on failure instead of throwing', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(listActors(VALID)).resolves.toEqual([]);
  });

  it('returns an empty list when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(listActors(VALID)).resolves.toEqual([]);
  });
});

describe('apify runActorSync', () => {
  it('returns dataset items on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ title: 'Acme Cafe', phone: '+1234567890' }],
    });
    const res = await runActorSync(VALID, 'compass~crawler-google-places', { query: 'cafes' });
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
  });

  it('rejects an empty actor id without calling fetch', async () => {
    const res = await runActorSync(VALID, '  ', {});
    expect(res.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns a descriptive error on 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const res = await runActorSync(VALID, 'nope~missing', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/i);
  });

  it('returns a descriptive error on 408 timeout', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 408, json: async () => ({}) });
    const res = await runActorSync(VALID, 'slow~actor', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/300s/);
  });

  it('caps items via the limit query param when maxItems is set', async () => {
    const fetchMock = (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    await runActorSync(VALID, 'a~b', {}, 5);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=5');
  });
});
