import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { AppError } from '../../shared/middleware/errorHandler';
import { redis } from '../../shared/utils/redis';
import {
  findUserByEmail,
  findUserById,
  findValidRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  storeRefreshToken,
  updatePasswordHash,
} from './auth.repository';
import { JwtPayload, LoginInput, LoginResult } from './auth.types';

const BCRYPT_COST_FACTOR = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function getPrivateKey(): string {
  const rawKey = process.env.JWT_PRIVATE_KEY;
  if (!rawKey) throw new AppError('Server misconfiguration: JWT private key not set', 500);
  return rawKey.replace(/\\n/g, '\n');
}

function signAccessToken(payload: JwtPayload): string {
  const options: jwt.SignOptions = {
    algorithm: 'RS256',
    expiresIn: ms(process.env.JWT_ACCESS_EXPIRES_IN ?? '15m'),
  };
  return jwt.sign(payload, getPrivateKey(), options);
}

function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

function failedLoginKey(email: string): string {
  return `auth:failed_login:${email.toLowerCase()}`;
}

async function isAccountLocked(email: string): Promise<boolean> {
  const attempts = await redis.get(failedLoginKey(email));
  return attempts !== null && parseInt(attempts, 10) >= MAX_FAILED_ATTEMPTS;
}

async function recordFailedLogin(email: string): Promise<void> {
  const key = failedLoginKey(email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_DURATION_SECONDS);
  }
}

async function clearFailedLogins(email: string): Promise<void> {
  await redis.del(failedLoginKey(email));
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const { email, password } = input;

  if (await isAccountLocked(email)) {
    throw new AppError(
      'Account locked due to too many failed login attempts. Try again later.',
      423,
    );
  }

  const user = await findUserByEmail(email);
  if (!user || !user.is_active) {
    await recordFailedLogin(email);
    throw new AppError('Invalid email or password', 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    await recordFailedLogin(email);
    throw new AppError('Invalid email or password', 401);
  }

  await clearFailedLogins(email);

  const payload: JwtPayload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = signAccessToken(payload);
  const refreshToken = generateOpaqueRefreshToken();
  const refreshTtlMs = ms(process.env.JWT_REFRESH_EXPIRES_IN ?? '7d');
  const expiresAt = new Date(Date.now() + refreshTtlMs);

  await storeRefreshToken(user.id, refreshToken, expiresAt);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function refresh(refreshToken: string): Promise<{ accessToken: string }> {
  const tokenRecord = await findValidRefreshToken(refreshToken);
  if (!tokenRecord) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  const user = await findUserById(tokenRecord.user_id);
  if (!user || !user.is_active) {
    throw new AppError('User account is not active', 401);
  }

  const payload: JwtPayload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = signAccessToken(payload);

  return { accessToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

export async function forgotPassword(email: string): Promise<{ resetToken: string } | null> {
  const user = await findUserByEmail(email);
  // Always behave the same way whether or not the user exists, to avoid email enumeration.
  if (!user || !user.is_active) {
    return null;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  await redis.set(`auth:reset_token:${tokenHash}`, user.id, 'EX', RESET_TOKEN_TTL_SECONDS);

  // PHASE 1 STUB: SendGrid / SMTP integration is Sprint 3 work. The raw token
  // is intentionally returned to the controller so it can be surfaced in dev
  // logs / a test mailbox while email delivery is not yet wired. The HTTP
  // response always returns a generic message; this return value is never
  // leaked to the client. Replace with a queue→SendGrid dispatch in Sprint 3.
  return { resetToken };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const key = `auth:reset_token:${tokenHash}`;
  const userId = await redis.get(key);

  if (!userId) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);
  await updatePasswordHash(userId, passwordHash);

  // Single-use: delete the token immediately and revoke all existing sessions.
  await redis.del(key);
  await revokeAllRefreshTokensForUser(userId);
}
