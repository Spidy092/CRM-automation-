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

export async function createApiKey(
  userId: string,
  name: string,
  keyHash: string,
  prefix: string,
  expiresAt: Date | null,
): Promise<{ id: string }> {
  const res = await queryOne<{ id: string }>(
    `INSERT INTO api_keys (user_id, name, key_hash, prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, name, keyHash, prefix, expiresAt],
  );
  if (!res) throw new Error('Failed to create API key');
  return res;
}

export async function listApiKeys(userId: string): Promise<any[]> {
  const result = await pool.query(
    `SELECT id, name, prefix, last_used_at, expires_at, created_at
     FROM api_keys
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function revokeApiKey(userId: string, id: string): Promise<number> {
  const res = await pool.query(
    `UPDATE api_keys SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId],
  );
  return res.rowCount ?? 0;
}

export async function findApiKeyByHash(keyHash: string): Promise<any | null> {
  return queryOne<any>(
    `SELECT k.id, k.user_id, k.expires_at, k.deleted_at, u.id as u_id, u.email, u.role, u.name, u.is_active
     FROM api_keys k
     JOIN users u ON k.user_id = u.id
     WHERE k.key_hash = $1`,
    [keyHash],
  );
}

export async function touchApiKey(id: string): Promise<void> {
  await pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [id]);
}
