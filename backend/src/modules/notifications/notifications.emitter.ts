/**
 * Cross-process notification bus backed by Redis pub/sub.
 *
 * API process: subscribes to `crm:notifications` and forwards events to
 *   in-process SSE clients via a local EventEmitter.
 * Worker processes: publish directly to `crm:notifications` using the
 *   lightweight pushToUser() helper.
 *
 * Call initNotificationSubscriber() once at API startup to wire the bridge.
 */

import IORedis from 'ioredis';
import { EventEmitter } from 'events';
import { logger } from '../../shared/utils/logger';

const REDIS_CHANNEL = 'crm:notifications';

export type NotificationType =
  | 'lead_assigned'
  | 'campaign_enrolled'
  | 'export_ready'
  | 'job_failed'
  | 'scraper_complete'
  | 'lead_scored';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

interface RedisMessage {
  userId: string;
  notification: AppNotification;
}

const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(500);

let subscriber: IORedis | null = null;
let publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (!publisher) {
    publisher = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      enableReadyCheck: false,
    });
    publisher.on('error', (err) =>
      logger.warn('notification publisher error', { error: err.message }),
    );
  }
  return publisher;
}

export function initNotificationSubscriber(): void {
  if (subscriber) return;
  subscriber = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    enableReadyCheck: false,
  });

  subscriber.on('error', (err) =>
    logger.warn('notification subscriber error', { error: err.message }),
  );

  subscriber
    .subscribe(REDIS_CHANNEL)
    .then(() => logger.info('notification subscriber ready', { channel: REDIS_CHANNEL }))
    .catch((err) =>
      logger.warn('notification subscriber subscribe failed', { error: err.message }),
    );

  subscriber.on('message', (_channel, message) => {
    try {
      const { userId, notification } = JSON.parse(message) as RedisMessage;
      localEmitter.emit(`user:${userId}`, notification);
    } catch {
      // ignore malformed messages
    }
  });
}

export function subscribeUser(
  userId: string,
  handler: (n: AppNotification) => void,
): () => void {
  const channel = `user:${userId}`;
  localEmitter.on(channel, handler);
  return () => localEmitter.off(channel, handler);
}

export async function pushToUser(userId: string, notification: AppNotification): Promise<void> {
  try {
    await getPublisher().publish(REDIS_CHANNEL, JSON.stringify({ userId, notification }));
  } catch (err) {
    logger.warn('pushToUser failed', {
      userId,
      type: notification.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
