import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { subscribeUser } from './notifications.emitter';
import { logger } from '../../shared/utils/logger';
import { redis } from '../../shared/utils/redis';

const TICKET_PREFIX = 'sse:ticket:';
const TICKET_TTL_SECONDS = 30;

/**
 * Mints a single-use, short-lived ticket that stands in for the caller's
 * Bearer token on the SSE connection. EventSource can't send custom headers,
 * so the long-lived access token would otherwise have to ride in the URL
 * query string — visible in access logs, browser history, and referrers.
 */
export async function mintSseTicketHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const ticket = randomUUID();
  await redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(user), 'EX', TICKET_TTL_SECONDS);

  res.json({ success: true, data: { ticket, expiresInSeconds: TICKET_TTL_SECONDS } });
}

export async function consumeSseTicket(ticket: string): Promise<Request['user'] | null> {
  // GETDEL is atomic (Redis 6.2+) so a ticket can never be replayed even
  // under concurrent requests.
  const raw = await redis.getdel(`${TICKET_PREFIX}${ticket}`);
  if (!raw) return null;
  return JSON.parse(raw) as Request['user'];
}

export function sseHandler(req: Request, res: Response): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(':connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 25_000);

  const unsubscribe = subscribeUser(user.id, (notification) => {
    res.write(`data: ${JSON.stringify(notification)}\n\n`);
  });

  logger.info('SSE client connected', { userId: user.id });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    logger.info('SSE client disconnected', { userId: user.id });
  });
}
