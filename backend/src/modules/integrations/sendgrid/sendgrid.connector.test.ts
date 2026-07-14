/**
 * Unit tests for the SendGrid v3 Mail Send connector.
 * Covers loadCredentials() error/success branches and sendEmail() success +
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
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

import { loadCredentials, sendEmail } from './sendgrid.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { loggedFetch } from '../connector.base';
import { readFile } from 'fs/promises';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;
const mockLoggedFetch = loggedFetch as jest.Mock;

const VALID = {
  apiKey: 'SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(22),
  fromEmail: 'a@b.com',
  fromName: 'X',
};

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => jest.clearAllMocks());

describe('sendgrid loadCredentials', () => {
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
    mockDecrypt.mockReturnValue({ apiKey: 'not-valid', fromEmail: 'not-an-email' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ fromEmail: 'a@b.com' });
  });
});

describe('sendgrid sendEmail', () => {
  it('sends an email and returns the external id on success', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'x', latencyMs: 10 });

    const res = await sendEmail({
      leadId: 'l1',
      to: 'recipient@example.com',
      subject: 'Hello',
      htmlBody: '<p>hi</p>',
    });

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

    const res = await sendEmail({
      leadId: 'l1',
      to: 'recipient@example.com',
      subject: 'Hello',
      htmlBody: '<p>hi</p>',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('HTTP 500');
  });

  it('base64-encodes attachments read from disk and includes them in the request body', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'x', latencyMs: 10 });
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('fake-bytes'));

    await sendEmail({
      leadId: 'l1',
      to: 'recipient@example.com',
      subject: 'Hello',
      htmlBody: '<p>hi</p>',
      attachments: [{ filename: 'flyer.png', mimeType: 'image/png', storagePath: '/x/flyer.png' }],
    });

    expect(readFile).toHaveBeenCalledWith('/x/flyer.png');
    const [, options] = mockLoggedFetch.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.attachments).toEqual([
      {
        content: Buffer.from('fake-bytes').toString('base64'),
        filename: 'flyer.png',
        type: 'image/png',
        disposition: 'attachment',
      },
    ]);
  });

  it('skips an attachment that fails to read from disk instead of failing the whole send', async () => {
    primeValidCreds();
    mockLoggedFetch.mockResolvedValue({ ok: true, status: 200, externalId: 'x', latencyMs: 10 });
    (readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    const res = await sendEmail({
      leadId: 'l1',
      to: 'recipient@example.com',
      subject: 'Hello',
      htmlBody: '<p>hi</p>',
      attachments: [{ filename: 'flyer.png', mimeType: 'image/png', storagePath: '/x/flyer.png' }],
    });

    expect(res.ok).toBe(true);
    const [, options] = mockLoggedFetch.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.attachments).toBeUndefined();
  });
});
