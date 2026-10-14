import { UserRole } from '../../shared/types';

export type NewsletterSubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type NewsletterFrequency = 'daily' | 'weekly' | 'monthly';

export interface NewsletterSubscriberRow {
  id: string;
  email: string;
  status: NewsletterSubscriberStatus;
  topics: string[];
  frequency: NewsletterFrequency;
  unsubscribe_token_hash: string;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewsletterActor {
  id: string;
  role: UserRole;
}

export interface NewsletterDigestConfig {
  topic: string;
  tone: 'professional' | 'casual' | 'motivational' | 'technical';
  customPrompt: string;
  targetAudience: string;
}

export interface NewsletterBroadcastTargeting {
  topics?: string[];
  frequency?: NewsletterFrequency | NewsletterFrequency[];
}

export interface NewsletterBroadcastInput {
  subject: string;
  htmlBody: string;
  previewText?: string;
  topics?: string[];
  frequency?: NewsletterFrequency;
  /** Frequency list for automated sends (digest targets daily + weekly). */
  frequencies?: NewsletterFrequency[];
  scheduledAt?: string;
  /** Wall-clock scheduling input; converted to UTC via `timezone`. */
  scheduledAtLocal?: string;
  timezone?: string;
  idempotencyKey?: string;
  templateId?: string;
}

export interface NewsletterDeliveryOutcome {
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  failures: Array<{ subscriberId: string; error: string }>;
}

export interface NewsletterDigestStatus {
  enabled: boolean;
  schedule: string;
  timezone: string;
  nextRunAt: string | null;
  autoSend: boolean;
  lastOutcome: {
    status: 'success' | 'failed' | 'needs_review' | 'never_run';
    message: string;
    at: string | null;
  };
}

export interface NewsletterDigestDraft {
  subject: string;
  htmlBody: string;
  status: 'draft' | 'approved' | 'sent';
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export type NewsletterResult<T, E> = { ok: true; value: T } | { ok: false; error: E };
