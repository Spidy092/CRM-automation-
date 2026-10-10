import { z } from 'zod';

// ── Notification type ──────────────────────────────────────────────────────

export const notificationTypeSchema = z.enum([
  'lead_assigned',
  'campaign_enrolled',
  'export_ready',
  'job_failed',
  'scraper_complete',
  'lead_scored',
]);

// ── Metadata allowlist ─────────────────────────────────────────────────────

const allowedMetadataKeys = new Set([
  'leadId',
  'campaignId',
  'jobId',
  'reportType',
  'format',
  'logId',
  'configId',
  'status',
  'recordsImported',
  'score',
  'classification',
  'deepLink',
]);

const metadataValueSchema = z.union([z.string().max(500), z.number().finite()]);

export const metadataSchema = z
  .record(z.string(), metadataValueSchema)
  .optional()
  .transform((obj) => {
    if (!obj) return {};
    // Strip keys not on the allowlist; unknown keys are silently dropped.
    return Object.fromEntries(Object.entries(obj).filter(([k]) => allowedMetadataKeys.has(k)));
  });

// ── Create notification (internal service input) ───────────────────────────

export const createNotificationSchema = z.object({
  recipientUserId: z.string().uuid(),
  occurrenceKey: z.string().min(1).max(500),
  type: notificationTypeSchema,
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(2000),
  metadata: metadataSchema,
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

// ── Deep-link validation ───────────────────────────────────────────────────

/** Validate that a deep link is a relative path with no protocol, hostname, or
 *  javascript: scheme.  Only `/` paths are accepted so that notification links
 *  cannot navigate to external hosts.
 */
export function isAllowedDeepLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > 500) return false;
  // Must be a relative path starting with /
  if (!value.startsWith('/')) return false;
  // Reject anything that looks like a protocol
  if (/^\/\/|[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(value)) return false;
  return true;
}

// ── API request schemas ────────────────────────────────────────────────────

export const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export const listNotificationsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, Number(v ?? 50))))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      try {
        const decoded: unknown = JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
        const parsed = cursorPayloadSchema.safeParse(decoded);
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // fall through — invalid cursor is treated as absent
      }
      return undefined;
    }),
  excludeDismissed: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const markReadParamsSchema = z.object({
  id: z.string().uuid(),
});

export const dismissParamsSchema = z.object({
  id: z.string().uuid(),
});

export const markAllReadBodySchema = z.object({
  /**
   * ISO-8601 timestamp.  Notifications created on or before this cutoff are
   * marked read.  Arrivals after the user's click remain unread.
   */
  cutoffAt: z.string().datetime({ offset: true }),
});

export type MarkAllReadBody = z.infer<typeof markAllReadBodySchema>;

// ── Internal notification creation schema (worker payloads) ───────────────

export const createNotificationInputSchema = createNotificationSchema;
