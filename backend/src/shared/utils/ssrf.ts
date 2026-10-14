import { URL } from 'url';
import net from 'net';
import dns from 'dns/promises';
import { AppError } from '../middleware/errorHandler';

export const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'instance-data',
]);

export function isHostnameBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h) || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (net.isIP(h) !== 0 && isPrivateIp(h)) {
    return true;
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) return isPrivateIp(mapped);
      const groups = mapped.split(':');
      if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const high = parseInt(groups[0], 16);
        const low = parseInt(groups[1], 16);
        return isPrivateIp(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
      }
    }
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) return true;
    if (normalized.startsWith('ff')) return true;
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
    throw new AppError(
      `Forbidden URL protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      400,
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (isHostnameBlocked(hostname)) {
    throw new AppError(
      `Access to local/internal host '${hostname}' is forbidden (SSRF protection).`,
      400,
    );
  } else {
    try {
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
      if (addresses.length === 0) {
        throw new AppError(`Host '${hostname}' resolved to no addresses (SSRF protection).`, 400);
      }
      for (const { address: ip } of addresses) {
        if (isPrivateIp(ip)) {
          throw new AppError(
            `Host '${hostname}' resolves to private IP '${ip}' (SSRF protection).`,
            400,
          );
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // DNS lookup failure: the hostname doesn't exist or is unreachable.
      // Do NOT silently swallow this — a subsequent fetch() call would perform
      // its own DNS lookup, which could resolve to a different (possibly private)
      // address, bypassing this guard via a TOCTOU race.
      throw new AppError(
        `Host '${hostname}' could not be resolved (DNS lookup failed): ${
          err instanceof Error ? err.message : String(err)
        }`,
        400,
      );
    }
  }

  return parsed.toString();
}
