/* eslint-disable @typescript-eslint/no-misused-promises -- route handlers are async by design (legacy debt) */
import { Router, Request, Response } from 'express';
import { recordOpen, recordClick } from './tracking.utils';
import { logger } from '../../shared/utils/logger';

const router = Router();

/**
 * GET /track/open/:logId
 * Returns a 1x1 transparent GIF and records the open event.
 * No auth required — called by email clients fetching embedded images.
 */
router.get('/open/:logId', async (req: Request, res: Response) => {
  const { logId } = req.params;
  try {
    const pixel = await recordOpen(logId);
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.send(pixel);
  } catch (err) {
    logger.warn('Open tracking error', { logId, error: (err as Error).message });
    // Still return the pixel — don't break the email for the recipient
    res.set({ 'Content-Type': 'image/gif' });
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  }
});

function sanitizeRedirectUrl(target: string | undefined): string | null {
  if (!target) return null;
  try {
    const parsed = new URL(target);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * GET /track/click/:logId
 * Records the click event and redirects to the original URL.
 * Query param: ?url=<encoded-original-url>
 * No auth required — called by recipients clicking links in emails.
 */
router.get('/click/:logId', async (req: Request, res: Response) => {
  const { logId } = req.params;
  const originalUrl = req.query.url as string | undefined;

  try {
    // Try to get URL from DB first (stored at send time)
    const storedUrl = await recordClick(logId);
    const target = storedUrl || originalUrl;
    const safeTarget = sanitizeRedirectUrl(target);

    if (safeTarget) {
      res.redirect(302, safeTarget);
    } else {
      // Fallback: return a simple page indicating the link was tracked
      res.status(200).send('<html><body><p>Link tracked.</p></body></html>');
    }
  } catch (err) {
    logger.warn('Click tracking error', { logId, error: (err as Error).message });
    const safeFallback = sanitizeRedirectUrl(originalUrl);
    if (safeFallback) {
      res.redirect(302, safeFallback);
    } else {
      res.status(200).send('<html><body><p>Link tracked.</p></body></html>');
    }
  }
});

export { router as trackingRoutes };
