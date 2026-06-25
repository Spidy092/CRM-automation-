/**
 * AI Settings Service
 *
 * Provides read/update access to the ai_settings singleton row.
 *
 * API key storage: The raw key is encrypted with AES-256-GCM using
 * `process.env.ENCRYPTION_KEY` (a 32-byte hex string). If the env var is not
 * set, the key is stored as plaintext with a warning (acceptable for dev only).
 *
 * Never returns the decrypted key via the public API — only `has_api_key`.
 * The `getAiConfig()` function is the internal surface used by outreach.prompt.ts.
 */

import crypto from 'crypto';
import { findAiSettings, upsertAiSettings } from './ai-settings.repository';
import { UpdateAiSettingsInput } from './ai-settings.schema';
import { AiSettingsPublic } from './ai-settings.types';
import { logger } from '../../shared/utils/logger';
import { AppError } from '../../shared/middleware/errorHandler';

// ── Encryption helpers ──────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

function getEncryptionKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === 32 ? buf : null;
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    logger.warn(
      'ENCRYPTION_KEY not set — storing AI API key as plaintext. Set ENCRYPTION_KEY in production.',
    );
    return `plain:${plaintext}`;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(stored: string): string {
  if (stored.startsWith('plain:')) return stored.slice(6);
  const key = getEncryptionKey();
  if (!key) {
    logger.error('ENCRYPTION_KEY not set but encrypted API key found — cannot decrypt');
    return '';
  }
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getAiSettingsPublic(): Promise<AiSettingsPublic> {
  const row = await findAiSettings();
  if (!row) throw new AppError('AI settings not found', 404);
  return {
    id: row.id,
    enabled: row.enabled,
    base_url: row.base_url,
    has_api_key: Boolean(row.encrypted_api_key),
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: parseFloat(String(row.temperature)),
    system_prompt_override: row.system_prompt_override,
    cache_ttl_seconds: row.cache_ttl_seconds,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export async function updateAiSettings(
  input: UpdateAiSettingsInput,
  actorId: string,
): Promise<AiSettingsPublic> {
  const repoInput: Parameters<typeof upsertAiSettings>[0] = { updated_by: actorId };

  if (input.enabled !== undefined) repoInput.enabled = input.enabled;
  if (input.base_url !== undefined) repoInput.base_url = input.base_url;
  if (input.model !== undefined) repoInput.model = input.model;
  if (input.max_tokens !== undefined) repoInput.max_tokens = Math.min(input.max_tokens, 500);
  if (input.temperature !== undefined) repoInput.temperature = input.temperature;
  if (input.system_prompt_override !== undefined)
    repoInput.system_prompt_override = input.system_prompt_override;
  if (input.cache_ttl_seconds !== undefined)
    repoInput.cache_ttl_seconds = input.cache_ttl_seconds;

  // Encrypt the API key if provided; null = clear the key
  if (input.api_key !== undefined) {
    repoInput.encrypted_api_key = input.api_key ? encrypt(input.api_key) : null;
  }

  const row = await upsertAiSettings(repoInput);

  logger.info('ai_settings updated', { actorId, fields: Object.keys(repoInput) });

  return {
    id: row.id,
    enabled: row.enabled,
    base_url: row.base_url,
    has_api_key: Boolean(row.encrypted_api_key),
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: parseFloat(String(row.temperature)),
    system_prompt_override: row.system_prompt_override,
    cache_ttl_seconds: row.cache_ttl_seconds,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

/**
 * Internal function — used by outreach.prompt.ts.
 * Returns the decrypted API key and all config needed for personalization.
 * Returns null if AI is disabled.
 */
export async function getAiConfig(): Promise<{
  apiKey: string;
  baseUrl: string | null;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPromptOverride: string | null;
  cacheTtlSeconds: number;
} | null> {
  const row = await findAiSettings();
  if (!row || !row.enabled) return null;

  const apiKey = row.encrypted_api_key ? decrypt(row.encrypted_api_key) : '';
  if (!apiKey) {
    logger.warn('AI personalization enabled but no API key configured — skipping');
    return null;
  }

  return {
    apiKey,
    baseUrl: row.base_url,
    model: row.model,
    maxTokens: Math.min(row.max_tokens, 500),
    temperature: parseFloat(String(row.temperature)),
    systemPromptOverride: row.system_prompt_override,
    cacheTtlSeconds: row.cache_ttl_seconds,
  };
}
