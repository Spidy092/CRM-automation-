/**
 * Unit tests for the WhatsApp Cloud API connector.
 * Covers loadCredentials() error/success branches and sendMessage() text +
 * template + failure paths. Network is stubbed via loggedFetch.
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

import { loadCredentials, sendMessage } from './whatsapp.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const VALID = { phoneNumberId: '12345678901234', apiToken: 'EAAtoken', apiVersion: 'v20.0' };

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => jest.clearAllMocks());

describe('whatsapp loadCredentials', () => {
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
  });

  it('throws 422 when stored credentials fail schema validation', async () => {
    mockFindByName.mockResolvedValue({ id: 'int-1' });
    mockFindCreds.mockResolvedValue('blob');
    mockDecrypt.mockReturnValue({ phoneNumberId: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ phoneNumberId: '12345678901234' });
  });
});

describe('whatsapp sendMessage', () => {
  it('sends a text message and returns the external id on success', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'wamid.1', latencyMs: 12 });

    const res = await sendMessage({ leadId: 'l1', to: '+12025550000', body: 'hi' });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalId).toBe('wamid.1');
    const [, init] = mockLoggedFetch.mock.calls[0];
    expect(JSON.parse(init.body as string).type).toBe('text');
  });

  it('builds a template payload when templateName is provided', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'wamid.2', latencyMs: 8 });

    await sendMessage({
      leadId: 'l1',
      to: '+12025550000',
      body: 'ignored',
      templateName: 'welcome',
      templateVariables: ['Alice'],
    });

    const [, init] = mockLoggedFetch.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload.type).toBe('template');
    expect(payload.template.name).toBe('welcome');
  });

  it('propagates a failure result', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: false, status: 500, error: 'HTTP 500', latencyMs: 5, retryable: true });

    const res = await sendMessage({ leadId: 'l1', to: '+12025550000', body: 'hi' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('HTTP 500');
  });
});
