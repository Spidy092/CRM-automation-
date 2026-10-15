import { createHash } from 'crypto';

/** Stable BullMQ-safe identifier; keys may contain arbitrary user text. */
export function newsletterBroadcastJobId(key: string): string {
  return `newsletter-broadcast-${createHash('sha256').update(key).digest('hex')}`;
}
