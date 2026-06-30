import { describe, it, expect } from '@jest/globals';
process.env.GOOGLE_ADS_CLIENT_ID = 'test-client-id';
process.env.FACEBOOK_APP_ID = 'test-client-id';
import { generateAuthorizationUrl } from './oauth.service';

describe('OAuth Service', () => {
  describe('generateAuthorizationUrl', () => {
    it('should generate a Google Ads authorization URL', () => {
      const { url, state } = generateAuthorizationUrl('google_ads', 'user-123');

      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('scope=');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain(`state=${state}`);
      expect(state).toHaveLength(64); // 32 bytes hex = 64 chars
    });

    it('should generate a Facebook authorization URL', () => {
      const { url, state } = generateAuthorizationUrl('facebook', 'user-123');

      expect(url).toContain('facebook.com/v18.0/dialog/oauth');
      expect(url).toContain('client_id=');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('scope=');
      expect(url).toContain('display=popup');
      expect(url).toContain(`state=${state}`);
    });

    it('should generate unique state parameters', () => {
      const result1 = generateAuthorizationUrl('google_ads', 'user-123');
      const result2 = generateAuthorizationUrl('google_ads', 'user-123');

      expect(result1.state).not.toBe(result2.state);
    });
  });
});
