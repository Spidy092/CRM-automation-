/**
 * Regression test for the access-token TTL bug.
 *
 * signAccessToken() once passed ms('15m') (= 900000, milliseconds) as
 * jsonwebtoken's `expiresIn`, which interprets numbers as SECONDS — minting
 * ~10.4-day tokens instead of 15-minute ones. The existing service tests mock
 * `jsonwebtoken`, so they could never catch it. This file deliberately does
 * NOT mock jsonwebtoken: it signs with a throwaway in-memory RSA key and
 * decodes a real token.
 */
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

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { login } from './auth.service';
import { findUserByEmail, storeRefreshToken } from './auth.repository';
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

const OLD_ENV = {
  JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeAll(() => {
  // Throwaway keypair — never touches real credentials.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
});

afterAll(restoreEnv);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.JWT_ACCESS_EXPIRES_IN;
  (redis.get as jest.Mock).mockResolvedValue(null); // not locked
  (redis.incr as jest.Mock).mockResolvedValue(1);
  (redis.expire as jest.Mock).mockResolvedValue(1);
  (redis.del as jest.Mock).mockResolvedValue(1);
  (redis.set as jest.Mock).mockResolvedValue('OK');
  (findUserByEmail as jest.Mock).mockResolvedValue(user);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  (storeRefreshToken as jest.Mock).mockResolvedValue(undefined);
});

function verifyRealToken(accessToken: string): { exp: number; iat: number } {
  const payload = jwt.verify(accessToken, process.env.JWT_PUBLIC_KEY as string, {
    algorithms: ['RS256'],
  }) as { exp: number; iat: number };
  return payload;
}

describe('access token TTL (real RS256, no jwt mock)', () => {
  it('expires ~15 minutes after issue with the default config (not ~10 days)', async () => {
    const { accessToken } = await login({ email: 'admin@crm.com', password: 'correct' });
    const { exp, iat } = verifyRealToken(accessToken);
    expect(exp - iat).toBe(15 * 60);
  });

  it('honors a custom JWT_ACCESS_EXPIRES_IN duration string', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = '2h';
    const { accessToken } = await login({ email: 'admin@crm.com', password: 'correct' });
    const { exp, iat } = verifyRealToken(accessToken);
    expect(exp - iat).toBe(2 * 60 * 60);
  });
});
