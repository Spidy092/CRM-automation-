import { URL } from 'url';
import net from 'net';
import dns from 'dns/promises';
import { AppError } from '../middleware/errorHandler';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'instance-data',
]);

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) return true;
    return false;
  }
  return false;
}

export async function validateSafeUrl(urlStr: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new AppError(`Invalid URL format: ${urlStr}`, 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(`Forbidden URL protocol '${parsed.protocol}'. Only http: and https: are allowed.`, 400);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new AppError(`Access to local/internal host '${hostname}' is forbidden (SSRF protection).`, 400);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new AppError(`Access to private IP address '${hostname}' is forbidden (SSRF protection).`, 400);
    }
  } else {
    try {
      const addresses = await dns.resolve(hostname);
      for (const ip of addresses) {
        if (isPrivateIp(ip)) {
          throw new AppError(`Host '${hostname}' resolves to private IP '${ip}' (SSRF protection).`, 400);
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
  }

  return parsed.toString();
}
