/**
 * Unit tests for the SMTP (Nodemailer) email connector.
 * Covers loadCredentials() error/success branches and sendEmail() success +
 * failure + credential-load-failure paths. Nodemailer is fully mocked.
 */

const mockSendMail = jest.fn();

jest.mock('../integrations.repository', () => ({
  findByName: jest.fn(),
  findCredentialsById: jest.fn(),
}));
jest.mock('../../../shared/utils/encryption', () => ({
  decryptJson: jest.fn(),
}));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));
jest.mock('../../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { loadCredentials, sendEmail } from './smtp.connector';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';

const mockFindByName = findByName as jest.Mock;
const mockFindCreds = findCredentialsById as jest.Mock;
const mockDecrypt = decryptJson as jest.Mock;

const VALID = {
  host: 'smtp.x.com',
  port: 587,
  secure: false,
  user: 'u',
  pass: 'p',
  fromEmail: 'a@b.com',
  fromName: 'X',
};

function primeValidCreds() {
  mockFindByName.mockResolvedValue({ id: 'int-1' });
  mockFindCreds.mockResolvedValue('encrypted-blob');
  mockDecrypt.mockReturnValue(VALID);
}

beforeEach(() => jest.clearAllMocks());

describe('smtp loadCredentials', () => {
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
    mockDecrypt.mockReturnValue({ host: '' });
    await expect(loadCredentials()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns parsed credentials on success', async () => {
    primeValidCreds();
    await expect(loadCredentials()).resolves.toMatchObject({ host: 'smtp.x.com', port: 587 });
  });
});

describe('smtp sendEmail', () => {
  it('sends an email and returns the cleaned external id on success', async () => {
    primeValidCreds();
    mockSendMail.mockResolvedValue({ messageId: '<id@host>' });

    const res = await sendEmail({
      leadId: 'l1',
      to: 'dest@x.com',
      subject: 'Hi',
      htmlBody: '<p>Hello</p>',
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalId).toBe('id@host');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('returns a retryable failure when sendMail rejects', async () => {
    primeValidCreds();
    mockSendMail.mockRejectedValue(new Error('smtp down'));

    const res = await sendEmail({
      leadId: 'l1',
      to: 'dest@x.com',
      subject: 'Hi',
      htmlBody: '<p>Hello</p>',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('smtp down');
      expect(res.retryable).toBe(true);
    }
  });

  it('returns a non-retryable failure when loadCredentials fails', async () => {
    mockFindByName.mockResolvedValue(null);

    const res = await sendEmail({
      leadId: 'l1',
      to: 'dest@x.com',
      subject: 'Hi',
      htmlBody: '<p>Hello</p>',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryable).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
