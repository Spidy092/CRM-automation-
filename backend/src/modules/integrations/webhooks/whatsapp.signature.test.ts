import crypto from 'crypto';
import { verifyWhatsappSignature } from './whatsapp.signature';

describe('verifyWhatsappSignature', () => {
  const appSecret = 'my-app-secret';
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
  const correctHmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  it('returns false when header is missing', () => {
    expect(verifyWhatsappSignature(rawBody, undefined, appSecret)).toBe(false);
  });

  it('returns false when header has wrong prefix', () => {
    expect(verifyWhatsappSignature(rawBody, `sha1=${correctHmac}`, appSecret)).toBe(false);
  });

  it('returns false when hex part is empty', () => {
    expect(verifyWhatsappSignature(rawBody, 'sha256=', appSecret)).toBe(false);
  });

  it('returns false when hex has wrong length', () => {
    expect(verifyWhatsappSignature(rawBody, 'sha256=abcd', appSecret)).toBe(false);
  });

  it('returns true for a valid HMAC match', () => {
    expect(verifyWhatsappSignature(rawBody, `sha256=${correctHmac}`, appSecret)).toBe(true);
  });

  it('returns false for an invalid HMAC mismatch', () => {
    const wrongHmac = correctHmac.slice(0, -1) + (correctHmac.slice(-1) === 'a' ? 'b' : 'a');
    expect(verifyWhatsappSignature(rawBody, `sha256=${wrongHmac}`, appSecret)).toBe(false);
  });

  it('returns false when timingSafeEqual throws (invalid hex)', () => {
    expect(verifyWhatsappSignature(rawBody, 'sha256=zzzz', appSecret)).toBe(false);
  });
});
