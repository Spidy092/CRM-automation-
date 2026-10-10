/**
 * Shared type definitions for the durable notification module.
 *
 * Keep this file free of runtime imports so it can be consumed by
 * both API and worker processes without pulling in Express or BullMQ.
 */

export type NotificationType =
  | 'lead_assigned'
  | 'campaign_enrolled'
  | 'export_ready'
  | 'job_failed'
  | 'scraper_complete'
  | 'lead_scored';

/** All allowed keys for the metadata JSONB column. */
export type NotificationMetadataKey =
  | 'leadId'
  | 'campaignId'
  | 'jobId'
  | 'reportType'
  | 'format'
  | 'logId'
  | 'configId'
  | 'status'
  | 'recordsImported'
  | 'score'
  | 'classification'
  | 'deepLink';

export type NotificationMetadata = Partial<Record<NotificationMetadataKey, string | number>>;

/** A single notification row returned from the database. */
export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  occurrence_key: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: NotificationMetadata;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

/** Input for creating a notification; caller must supply the occurrence key. */
export interface CreateNotificationInput {
  recipientUserId: string;
  /**
   * Stable identity for the event occurrence, unique per event occurrence + recipient.
   * Must be deterministic so that worker retries remain idempotent.
   * Examples:
   *   assignment:<assignmentId>
   *   enroll:<campaignId>:<leadId>
   *   export:<jobId>
   *   scraper:<logId>
   */
  occurrenceKey: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: NotificationMetadata;
}

/** Cursor-pagination options for listing a user's notifications. */
export interface ListNotificationsOptions {
  recipientUserId: string;
  limit: number;
  /** ISO timestamp cursor from previous page. */
  cursorCreatedAt?: string;
  /** UUID cursor from previous page (tie-break). */
  cursorId?: string;
  /** When true, only return non-dismissed items. Default false returns all. */
  excludeDismissed?: boolean;
}

/** Cursor-paginated result set. */
export interface NotificationPage {
  items: NotificationRow[];
  nextCursor: string | null;
}

/** The wire shape sent over SSE and returned by the API. */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: NotificationMetadata;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}
