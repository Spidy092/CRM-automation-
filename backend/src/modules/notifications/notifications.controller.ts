import type { Request, Response } from 'express';
import { subscribeUser } from './notifications.emitter';
import { logger } from '../../shared/utils/logger';

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
