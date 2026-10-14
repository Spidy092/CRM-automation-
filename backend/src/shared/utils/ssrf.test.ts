import { validateSafeUrl, resolveSafeUrl, isPrivateIp } from './ssrf';

jest.mock('dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));
import dns from 'dns/promises';

describe('SSRF Protection Utility', () => {
  describe('isPrivateIp', () => {
    it('identifies private IPv4 addresses correctly', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('10.0.0.5')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('100.64.0.0')).toBe(true);
      expect(isPrivateIp('100.127.255.255')).toBe(true);
      expect(isPrivateIp('100.63.255.255')).toBe(false);
      expect(isPrivateIp('100.128.0.0')).toBe(false);
      expect(isPrivateIp('198.18.0.0')).toBe(true);
      expect(isPrivateIp('198.19.255.255')).toBe(true);
      expect(isPrivateIp('198.20.0.0')).toBe(false);
      expect(isPrivateIp('8.8.8.8')).toBe(false);
    });

    it('identifies private IPv6 addresses correctly', () => {
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
      expect(isPrivateIp('fc00::')).toBe(true);
      expect(isPrivateIp('fdff::')).toBe(true);
      expect(isPrivateIp('fe80::')).toBe(true);
      expect(isPrivateIp('febf::')).toBe(true);
      expect(isPrivateIp('fec0::')).toBe(false);
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
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
      await expect(validateSafeUrl('http://[::1]/')).rejects.toThrow('SSRF protection');
    });

    it('rejects public hostnames that resolve to private addresses', async () => {
      (dns.lookup as jest.Mock).mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ]);
      await expect(validateSafeUrl('https://attacker.example/pixel')).rejects.toThrow(
        'resolves to private IP',
      );
    });

    it('fails closed when DNS returns no addresses', async () => {
      (dns.lookup as jest.Mock).mockResolvedValueOnce([]);
      await expect(validateSafeUrl('https://empty.example')).rejects.toThrow(
        'resolved to no addresses',
      );
    });

    it('returns the exact validated addresses for a caller to pin', async () => {
      const addresses = [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ];
      (dns.lookup as jest.Mock).mockResolvedValueOnce(addresses);
      await expect(resolveSafeUrl('https://example.com/page')).resolves.toEqual({
        url: 'https://example.com/page',
        addresses,
      });
    });

    it('pins public IPv6 literals without a DNS lookup', async () => {
      await expect(resolveSafeUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/')).resolves.toEqual({
        url: 'https://[2606:2800:220:1:248:1893:25c8:1946]/',
        addresses: [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
      });
    });
  });
});
