import crypto from 'crypto';
import { pool, queryOne } from '../../shared/utils/db';
import {
  findUserByEmail,
  findUserById,
  storeRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  updatePasswordHash,
} from './auth.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;
const mockQueryOne = queryOne as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const userRecord = {
  id: 'u1',
  name: 'Test',
  email: 'test@crm.com',
  password_hash: 'hash',
  role: 'admin',
  is_available: true,
  is_active: true,
};

describe('auth.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findUserByEmail', () => {
    it('returns user for case-insensitive match', async () => {
      mockQueryOne.mockResolvedValueOnce(userRecord);
      const result = await findUserByEmail('Test@CRM.COM');
      expect(result).toEqual(userRecord);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('lower(email) = lower($1)'),
        ['Test@CRM.COM'],
      );
    });

    it('returns null when user not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await findUserByEmail('nope@crm.com');
      expect(result).toBeNull();
    });
  });

  describe('findUserById', () => {
    it('returns user by id', async () => {
      mockQueryOne.mockResolvedValueOnce(userRecord);
      const result = await findUserById('u1');
      expect(result).toEqual(userRecord);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['u1'],
      );
    });

    it('returns null when user not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await findUserById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('storeRefreshToken', () => {
    it('inserts token hash into refresh_tokens', async () => {
      mockPoolQuery.mockResolvedValueOnce(undefined);
      const token = 'my-refresh-token';
      const expiresAt = new Date('2026-12-31T23:59:59Z');
      await storeRefreshToken('u1', token, expiresAt);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        ['u1', hashToken(token), expiresAt],
      );
    });
  });

  describe('findValidRefreshToken', () => {
    it('returns valid refresh token record', async () => {
      const record = { id: 't1', user_id: 'u1' };
      mockQueryOne.mockResolvedValueOnce(record);
      const token = 'valid-token';
      const result = await findValidRefreshToken(token);
      expect(result).toEqual(record);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > NOW()'),
        [hashToken(token)],
      );
    });

    it('returns null for expired token', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await findValidRefreshToken('expired-token');
      expect(result).toBeNull();
    });
  });

  describe('revokeRefreshToken', () => {
    it('deletes token by hash', async () => {
      mockPoolQuery.mockResolvedValueOnce(undefined);
      const token = 'token-to-revoke';
      await revokeRefreshToken(token);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM refresh_tokens WHERE token_hash = $1'),
        [hashToken(token)],
      );
    });
  });

  describe('revokeAllRefreshTokensForUser', () => {
    it('deletes all tokens for user', async () => {
      mockPoolQuery.mockResolvedValueOnce(undefined);
      await revokeAllRefreshTokensForUser('u1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM refresh_tokens WHERE user_id = $1'),
        ['u1'],
      );
    });
  });

  describe('updatePasswordHash', () => {
    it('updates password hash for user', async () => {
      mockPoolQuery.mockResolvedValueOnce(undefined);
      await updatePasswordHash('u1', 'new-hash');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET password_hash = $1 WHERE id = $2'),
        ['new-hash', 'u1'],
      );
    });
  });
});
