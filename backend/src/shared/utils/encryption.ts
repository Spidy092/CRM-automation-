import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // recommended for GCM
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32; // AES-256
const VERSION_PREFIX = 'enc:v1';

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes (got ${key.length}). ` +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * Output format: `enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 * Versioned so we can rotate algorithms later without a migration.
 *
 * The IV is randomly generated per call. NEVER reuse an IV with the same key.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/**
 * Decrypts a string previously produced by {@link encrypt}.
 * Throws on tampered ciphertext, wrong IV/authTag length, or wrong key.
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const parts = payload.split(':');
  // Format: enc : v1 : <iv-hex> : <authTag-hex> : <ciphertext-hex>  → 5 parts
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error(`Invalid ciphertext format (expected ${VERSION_PREFIX}:...)`);
  }
  const ivHex = parts[2];
  const authTagHex = parts[3];
  const ciphertextHex = parts[4];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Invalid auth tag length: ${authTag.length}`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Encrypts a JSON-serialisable object. Throws on circular references (per JSON.stringify spec). */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypts and parses a JSON object previously produced by {@link encryptJson}. */
export function decryptJson<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/**
 * Returns true if a payload looks like an `enc:v1:` ciphertext.
 * Useful for deciding whether to decrypt or treat as legacy plain-text during migrations.
 */
export function isEncryptedPayload(payload: string): boolean {
  return payload.startsWith(`${VERSION_PREFIX}:`);
}
