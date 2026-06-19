import crypto from 'crypto';
import { pool, queryOne } from '../../shared/utils/db';
import { UserRecord } from './auth.types';

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>(
    `SELECT id, name, email, password_hash, role, is_available, is_active
     FROM users
     WHERE lower(email) = lower($1)`,
    [email],
  );
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>(
    `SELECT id, name, email, password_hash, role, is_available, is_active
     FROM users
     WHERE id = $1`,
    [id],
  );
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(
  userId: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

export async function findValidRefreshToken(
  refreshToken: string,
): Promise<{ id: string; user_id: string } | null> {
  const tokenHash = hashToken(refreshToken);
  return queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash],
  );
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await pool.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
}
