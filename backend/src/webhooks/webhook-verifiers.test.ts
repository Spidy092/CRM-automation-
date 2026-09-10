import {
  verifyWhatsAppSignature,
  verifyTwilioSignature,
  verifySendGridSignature,
  verifyGoogleAdsSecret,
} from './webhook-verifiers';
import crypto from 'crypto';

describe('verifyWhatsAppSignature', () => {
  const appSecret = 'my-app-secret';

  it('returns true for valid signature', () => {
    const crypto = require('crypto');
    const body = '{"test":"data"}';
    const sig = crypto.createHmac('sha256', appSecret).update(body, 'utf8').digest('hex');
    expect(verifyWhatsAppSignature(body, `sha256=${sig}`, appSecret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    expect(verifyWhatsAppSignature('body', 'sha256=invalid', appSecret)).toBe(false);
  });

  it('returns false when header missing', () => {
    expect(verifyWhatsAppSignature('body', undefined, appSecret)).toBe(false);
  });

  it('returns false when prefix is wrong', () => {
    expect(verifyWhatsAppSignature('body', 'md5=abc', appSecret)).toBe(false);
  });
});

describe('verifyTwilioSignature', () => {
  const authToken = 'twilio-auth-token';
  const url = 'https://example.com/webhooks/twilio';

  it('returns true for valid signature', () => {
    const crypto = require('crypto');
    const params: Record<string, string> = { Body: 'Hello', From: '+1234567890' };
    const sortedKeys = Object.keys(params).sort();
    let sigStr = url;
    for (const key of sortedKeys) sigStr += key + params[key];
    const sig = crypto.createHmac('sha1', authToken).update(sigStr, 'utf8').digest('base64');
    expect(verifyTwilioSignature(url, params, authToken, sig)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    expect(verifyTwilioSignature(url, {}, authToken, 'invalid')).toBe(false);
  });

  it('returns false when header missing', () => {
    expect(verifyTwilioSignature(url, {}, authToken, undefined)).toBe(false);
  });
});

describe('verifySendGridSignature', () => {
  const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const verificationKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('returns true for valid signature', () => {
    const payload = '1700000000{"event":"delivered"}';
    const signer = crypto.createSign('sha256');
    signer.update(payload);
    signer.end();
    const signature = signer.sign(keyPair.privateKey).toString('base64');
    expect(verifySendGridSignature(payload, signature, verificationKey)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    expect(verifySendGridSignature('payload', 'aW52YWxpZA==', verificationKey)).toBe(false);
  });

  it('returns false when no verification key configured', () => {
    expect(verifySendGridSignature('payload', undefined, undefined)).toBe(false);
  });

  it('returns false when header missing but key configured', () => {
    expect(verifySendGridSignature('payload', undefined, verificationKey)).toBe(false);
  });
});

describe('verifyGoogleAdsSecret', () => {
  const configuredSecret = 'my-google-secret';

  it('returns true for matching secret', () => {
    expect(verifyGoogleAdsSecret('my-google-secret', configuredSecret)).toBe(true);
  });

  it('returns false for mismatched secret', () => {
    expect(verifyGoogleAdsSecret('wrong', configuredSecret)).toBe(false);
  });

  it('returns false when no configured secret', () => {
    expect(verifyGoogleAdsSecret('any', undefined)).toBe(false);
  });

  it('returns false when payload secret missing but configured', () => {
    expect(verifyGoogleAdsSecret(undefined, configuredSecret)).toBe(false);
  });
});
