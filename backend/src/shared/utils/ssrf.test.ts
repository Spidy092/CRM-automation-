import { validateSafeUrl, isPrivateIp } from './ssrf';

describe('SSRF Protection Utility', () => {
  describe('isPrivateIp', () => {
    it('identifies private IPv4 addresses correctly', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('10.0.0.5')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('8.8.8.8')).toBe(false);
    });

    it('identifies private IPv6 addresses correctly', () => {
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
    });
  });

  describe('validateSafeUrl', () => {
    it('accepts valid public http/https URLs', async () => {
      await expect(validateSafeUrl('https://example.com')).resolves.toBe('https://example.com/');
      await expect(validateSafeUrl('http://google.com/search?q=test')).resolves.toBe('http://google.com/search?q=test');
    });

    it('rejects forbidden protocols', async () => {
      await expect(validateSafeUrl('javascript:alert(1)')).rejects.toThrow('Forbidden URL protocol');
      await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow('Forbidden URL protocol');
    });

    it('rejects local/internal hostnames', async () => {
      await expect(validateSafeUrl('http://localhost:8080')).rejects.toThrow('SSRF protection');
      await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('SSRF protection');
      await expect(validateSafeUrl('http://server.local')).rejects.toThrow('SSRF protection');
    });
  });
});
