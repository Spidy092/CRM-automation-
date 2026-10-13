import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { lookup } from 'dns/promises';
import { isPrivateIp, validateSafeUrl } from '../../shared/utils/ssrf';
import { AppError } from '../../shared/middleware/errorHandler';

/** DNS-pinned, size/time-bounded fetch. Redirects are handled explicitly by the caller. */
export async function readPublicWebsite(
  url: string,
  timeoutMs: number,
): Promise<{
  status: number;
  contentType: string;
  text: string;
  location?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  async function withinDeadline<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Website request timed out')),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const safe = new URL(await withinDeadline(validateSafeUrl(url)));
  if (safe.username || safe.password)
    throw new AppError('Website credentials are not allowed', 400);
  const addresses = await withinDeadline(lookup(safe.hostname, { all: true }));
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        isPrivateIp(address) ||
        address.toLowerCase().includes('::ffff:') ||
        (address.includes(':') && /^(fc|fd|fe[89ab]|ff)/i.test(address)) ||
        /^([2][2-5][0-9])\./.test(address) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ||
        /^(192\.0\.0|198\.(18|19))\./.test(address),
    )
  ) {
    throw new AppError('Website resolves to a blocked address', 403);
  }
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (safe.protocol === 'https:' ? httpsRequest : httpRequest)(
      safe,
      {
        family: pinned.family,
        headers: { 'User-Agent': 'CRMResearchBot/1.0', Accept: 'text/html,text/plain' },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 128 * 1024) request.destroy(new Error('Website response exceeds size limit'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers['content-type'] ?? ''),
            text: Buffer.concat(chunks).toString('utf8'),
            location: response.headers.location,
          }),
        );
      },
    );
    const timeout = setTimeout(
      () => request.destroy(new Error('Website request timed out')),
      Math.max(1, deadline - Date.now()),
    );
    request.on('error', reject);
    request.on('close', () => clearTimeout(timeout));
    request.end();
  });
}
