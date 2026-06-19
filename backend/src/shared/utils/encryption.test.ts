import { decrypt, encrypt, encryptJson, decryptJson, isEncryptedPayload } from './encryption';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

function setKey(): void {
  // 32 bytes hex = 64 chars
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
}

function clearKey(): void {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
}

describe('encryption helpers', () => {
  beforeEach(() => setKey());
  afterAll(() => clearKey());

  describe('encrypt / decrypt round trip', () => {
    it('round-trips a simple string', () => {
      const ct = encrypt('hello world');
      expect(ct.startsWith('enc:v1:')).toBe(true);
      expect(decrypt(ct)).toBe('hello world');
    });

    it('round-trips a long string', () => {
      const long = 'x'.repeat(10_000);
      const ct = encrypt(long);
      expect(decrypt(ct)).toBe(long);
    });

    it('round-trips unicode', () => {
      const text = 'नमस्ते — مرحبا — 🚀';
      expect(decrypt(encrypt(text))).toBe(text);
    });

    it('produces a different ciphertext for the same plaintext each call (random IV)', () => {
      const a = encrypt('same');
      const b = encrypt('same');
      expect(a).not.toBe(b);
    });
  });

  describe('encryptJson / decryptJson', () => {
    it('round-trips an object', () => {
      const obj = { api_key: 'sk_test', from_email: 'a@b.com', nested: { ok: true } };
      const ct = encryptJson(obj);
      expect(decryptJson<typeof obj>(ct)).toEqual(obj);
    });
  });

  describe('tampering detection', () => {
    it('throws when ciphertext is tampered', () => {
      const ct = encrypt('secret');
      const parts = ct.split(':');
      const tampered = parts.slice();
      const ctBuf = Buffer.from(tampered[4], 'hex');
      ctBuf[0] = ctBuf[0] ^ 0xff;
      tampered[4] = ctBuf.toString('hex');
      expect(() => decrypt(tampered.join(':'))).toThrow();
    });

    it('throws when auth tag is tampered', () => {
      const ct = encrypt('secret');
      const parts = ct.split(':');
      const tagBuf = Buffer.from(parts[3], 'hex');
      tagBuf[0] = tagBuf[0] ^ 0xff;
      parts[3] = tagBuf.toString('hex');
      expect(() => decrypt(parts.join(':'))).toThrow();
    });

    it('throws on wrong version prefix', () => {
      expect(() => decrypt('enc:v9:aa:bb:cc')).toThrow(/Invalid ciphertext format/);
    });

    it('throws on malformed payload', () => {
      expect(() => decrypt('not-a-valid-ciphertext')).toThrow();
    });
  });

  describe('isEncryptedPayload', () => {
    it('returns true for v1 ciphertext', () => {
      expect(isEncryptedPayload(encrypt('x'))).toBe(true);
    });
    it('returns false for plain text', () => {
      expect(isEncryptedPayload('plain text')).toBe(false);
    });
  });

  describe('key validation', () => {
    it('throws when ENCRYPTION_KEY is missing', () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      try {
        expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY is not set/);
      } finally {
        if (saved !== undefined) process.env.ENCRYPTION_KEY = saved;
      }
    });

    it('throws when ENCRYPTION_KEY is wrong length', () => {
      const saved = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'aabbcc'; // too short
      try {
        expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY must decode to 32 bytes/);
      } finally {
        if (saved !== undefined) process.env.ENCRYPTION_KEY = saved;
      }
    });

    it('throws when decrypting with a different key', () => {
      const ct = encrypt('secret');
      const saved = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      try {
        expect(() => decrypt(ct)).toThrow();
      } finally {
        process.env.ENCRYPTION_KEY = saved;
      }
    });
  });
});