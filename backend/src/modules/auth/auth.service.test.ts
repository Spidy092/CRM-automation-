jest.mock('./auth.repository', () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findValidRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeAllRefreshTokensForUser: jest.fn(),
  storeRefreshToken: jest.fn(),
  updatePasswordHash: jest.fn(),
}));
jest.mock('../../shared/utils/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  },
}));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(), verify: jest.fn() }));

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { forgotPassword, login, logout, refresh, resetPassword } from './auth.service';
import {
  findUserByEmail,
  findUserById,
  findValidRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  storeRefreshToken,
  updatePasswordHash,
} from './auth.repository';
import { redis } from '../../shared/utils/redis';
import { UserRecord } from './auth.types';

const user: UserRecord = {
  id: 'u1',
  name: 'Admin',
  email: 'admin@crm.com',
  password_hash: 'hash',
  role: 'admin',
  is_available: true,
  is_active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = 'private-key';
  process.env.JWT_PUBLIC_KEY = 'public-key';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  (redis.get as jest.Mock).mockResolvedValue(null); // not locked by default
  (redis.incr as jest.Mock).mockResolvedValue(1);
  (redis.expire as jest.Mock).mockResolvedValue(1);
  (redis.del as jest.Mock).mockResolvedValue(1);
  (redis.set as jest.Mock).mockResolvedValue('OK');
});

describe('login', () => {
  it('locks the account after too many failed attempts (423)', async () => {
    (redis.get as jest.Mock).mockResolvedValue('5');
    await expect(login({ email: 'admin@crm.com', password: 'pw' })).rejects.toMatchObject({
      statusCode: 423,
    });
  });

  it('rejects an unknown user (401) and records the failure', async () => {
    (findUserByEmail as jest.Mock).mockResolvedValue(null);
    await expect(login({ email: 'nope@crm.com', password: 'pw' })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(redis.incr).toHaveBeenCalled();
  });

  it('rejects a wrong password (401) and records the failure', async () => {
    (findUserByEmail as jest.Mock).mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(login({ email: 'admin@crm.com', password: 'wrong' })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(redis.incr).toHaveBeenCalled();
  });

  it('returns tokens and stores the refresh token on success', async () => {
    (findUserByEmail as jest.Mock).mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('access-token');
    (storeRefreshToken as jest.Mock).mockResolvedValue(undefined);

    const result = await login({ email: 'admin@crm.com', password: 'correct' });
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.id).toBe('u1');
    expect(storeRefreshToken).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled(); // clearFailedLogins
  });
});

describe('refresh', () => {
  it('rejects an invalid refresh token (401)', async () => {
    (findValidRefreshToken as jest.Mock).mockResolvedValue(null);
    await expect(refresh('bad-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('issues a new access token for a valid refresh token', async () => {
    (findValidRefreshToken as jest.Mock).mockResolvedValue({ id: 't1', user_id: 'u1' });
    (findUserById as jest.Mock).mockResolvedValue(user);
    (jwt.sign as jest.Mock).mockReturnValue('access-token');
    const result = await refresh('good-token');
    expect(result.accessToken).toBe('access-token');
  });

  it('rejects when the user is no longer active (401)', async () => {
    (findValidRefreshToken as jest.Mock).mockResolvedValue({ id: 't1', user_id: 'u1' });
    (findUserById as jest.Mock).mockResolvedValue({ ...user, is_active: false });
    await expect(refresh('good-token')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('logout', () => {
  it('revokes the refresh token', async () => {
    (revokeRefreshToken as jest.Mock).mockResolvedValue(undefined);
    await logout('some-token');
    expect(revokeRefreshToken).toHaveBeenCalledWith('some-token');
  });
});

describe('forgotPassword', () => {
  it('returns null for an unknown user (no enumeration)', async () => {
    (findUserByEmail as jest.Mock).mockResolvedValue(null);
    const result = await forgotPassword('nope@crm.com');
    expect(result).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('generates and stores a reset token for a known user', async () => {
    (findUserByEmail as jest.Mock).mockResolvedValue(user);
    const result = await forgotPassword('admin@crm.com');
    expect(result).not.toBeNull();
    expect(result?.resetToken).toBeTruthy();
    expect(redis.set).toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  it('rejects an invalid token (400)', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    await expect(resetPassword('bad', 'NewPass1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('resets the password, single-uses the token, and revokes sessions', async () => {
    (redis.get as jest.Mock).mockResolvedValue('u1');
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    (updatePasswordHash as jest.Mock).mockResolvedValue(undefined);
    (revokeAllRefreshTokensForUser as jest.Mock).mockResolvedValue(undefined);

    await resetPassword('good', 'NewPass1');
    expect(bcrypt.hash).toHaveBeenCalledWith('NewPass1', 12);
    expect(updatePasswordHash).toHaveBeenCalledWith('u1', 'new-hash');
    expect(redis.del).toHaveBeenCalled();
    expect(revokeAllRefreshTokensForUser).toHaveBeenCalledWith('u1');
  });
});
