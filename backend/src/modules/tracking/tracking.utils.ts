import { pool, queryOne } from '../../shared/utils/db';
import { logger } from '../../shared/utils/logger';

// ── 1x1 Transparent GIF Pixel ────────────────────────────────────────────
// 43 bytes — the smallest valid GIF.
const PIXEL_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Record an open event and return the 1x1 transparent pixel.
 * Safe to call multiple times — only the first call sets opened_at.
 */
export async function recordOpen(logId: string): Promise<Buffer> {
  try {
    await pool.query(
      `UPDATE outreach_logs
       SET opened_at = COALESCE(opened_at, NOW()), status = CASE
         WHEN status IN ('queued', 'sent', 'delivered') THEN 'opened'
         ELSE status
       END, updated_at = NOW()
       WHERE id = $1 AND channel = 'email'`,
      [logId],
    );
  } catch (err) {
    logger.warn('Failed to record open', { logId, error: (err as Error).message });
  }
  return PIXEL_BUFFER;
}

/**
 * Record a click event and return the destination URL.
 */
export async function recordClick(logId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ click_url: string | null }>(
      `SELECT click_url FROM outreach_logs WHERE id = $1 AND channel = 'email'`,
      [logId],
    );
    if (!row?.click_url) return null;

    await pool.query(
      `UPDATE outreach_logs
       SET clicked_at = COALESCE(clicked_at, NOW()),
           status = CASE
             WHEN status IN ('queued', 'sent', 'delivered', 'opened') THEN 'clicked'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $1 AND channel = 'email'`,
      [logId],
    );

    return row.click_url;
  } catch (err) {
    logger.warn('Failed to record click', { logId, error: (err as Error).message });
    return null;
  }
}

/**
 * Store the click_url for an outreach log (called before dispatch).
 */
export async function setClickUrl(logId: string, url: string): Promise<void> {
  try {
    await pool.query(`UPDATE outreach_logs SET click_url = $1 WHERE id = $2`, [url, logId]);
  } catch (err) {
    logger.warn('Failed to set click_url', { logId, error: (err as Error).message });
  }
}

/**
 * Build a tracking pixel <img> tag for embedding in HTML email.
 * Returns an HTML string like: <img src="https://host/track/open/:logId" .../>
 */
export function buildTrackingPixel(logId: string, baseUrl: string): string {
  const url = `${baseUrl}/track/open/${logId}`;
  return `<img src="${url}" width="1" height="1" style="display:none;opacity:0;pointer-events:none;" alt="" />`;
}

/**
 * Rewrite all <a href="..."> links in an HTML body to route through the
 * click tracker. Each link's original URL is stored in the outreach_log
 * so the redirect endpoint knows where to send the click.
 *
 * Only rewrites http/https links. Mailto:, tel:, and anchor links are left alone.
 */
export function rewriteLinksForTracking(
  htmlBody: string,
  logId: string,
  baseUrl: string,
): { rewritten: string; links: string[] } {
  const links: string[] = [];
  const rewritten = htmlBody.replace(
    /<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/gi,
    (match: string, originalUrl: string) => {
      links.push(originalUrl);
      const trackedUrl = `${baseUrl}/track/click/${logId}?url=${encodeURIComponent(originalUrl)}`;
      return match.replace(/href=["'][^"']+["']/, `href="${trackedUrl}"`);
    },
  );
  return { rewritten, links };
}
