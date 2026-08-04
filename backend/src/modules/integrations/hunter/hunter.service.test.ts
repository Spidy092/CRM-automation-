/**
 * Unit tests for the Hunter.io service.
 * Covers getCredentials(), loadCredentials(), testConnection(), and enrichDomain().
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

import {
  getCredentials,
  loadCredentials,
  testConnection,
  enrichDomain,
} from './hunter.service';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decrypt as jest.Mock;

const VALID = { api_key: 'hunter_api_key123' };

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1', is_enabled: true });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(JSON.stringify(VALID));
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('getCredentials', () => {
  it('throws 400 when the integration is not found', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(getCredentials()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when the integration is disabled', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1', is_enabled: false });
    await expect(getCredentials()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when credentials are not configured', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1', is_enabled: true });
    mockFindCreds.mockResolvedValue(null);
    await expect(getCredentials()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when decrypted credentials fail schema validation', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1', is_enabled: true });
    mockFindCreds.mockResolvedValue('encrypted-blob');
    mockDecrypt.mockReturnValue(JSON.stringify({ not_api_key: 'x' }));
    await expect(getCredentials()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(getCredentials()).resolves.toEqual(VALID);
  });
});

describe('loadCredentials', () => {
  it('parses raw credentials directly when provided', async () => {
    await expect(loadCredentials({ api_key: 'raw-key' })).resolves.toEqual({
      api_key: 'raw-key',
    });
    expect(mockFindByName).not.toHaveBeenCalled();
  });

  it('throws when raw credentials fail schema validation', async () => {
    await expect(loadCredentials({ api_key: '' })).rejects.toThrow();
  });

  it('throws when the integration is not found in the DB', async () => {
    mockFindByName.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toThrow('Hunter.io not found in DB');
  });

  it('throws when no credentials are stored', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue(null);
    await expect(loadCredentials()).rejects.toThrow('No credentials');
  });

  it('loads and decrypts credentials from the DB when none are provided', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toEqual(VALID);
  });
});

describe('testConnection', () => {
  it('returns ok:true on a healthy response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const result = await testConnection(VALID);
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns ok:false when the HTTP response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    const result = await testConnection(VALID);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('returns ok:false when the API responds with an errors payload', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ details: 'Invalid API Key' }] }),
    });
    const result = await testConnection(VALID);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid API Key');
  });

  it('returns ok:false when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    const result = await testConnection(VALID);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });
});

describe('enrichDomain', () => {
  beforeEach(() => {
    primeValidCreds();
  });

  it('strips protocol and www from the domain before querying', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { emails: [] } }),
    });
    await enrichDomain('https://www.example.com/path');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('domain=example.com'),
      expect.any(Object),
    );
  });

  it('returns null when the response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    const result = await enrichDomain('example.com');
    expect(result).toBeNull();
  });

  it('returns null when there are no emails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { emails: [] } }),
    });
    const result = await enrichDomain('example.com');
    expect(result).toBeNull();
  });

  it('returns the best email result when emails are found', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          emails: [
            {
              value: 'jane@example.com',
              confidence: 90,
              type: 'personal',
              first_name: 'Jane',
              last_name: 'Doe',
              position: 'CEO',
              linkedin: 'jane-doe',
              twitter: '@jane',
            },
          ],
        },
      }),
    });
    const result = await enrichDomain('example.com');
    expect(result).toEqual({
      email: 'jane@example.com',
      confidence: 90,
      type: 'personal',
      first_name: 'Jane',
      last_name: 'Doe',
      position: 'CEO',
      linkedin: 'jane-doe',
      twitter: '@jane',
    });
  });

  it('returns null when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    const result = await enrichDomain('example.com');
    expect(result).toBeNull();
  });
});
