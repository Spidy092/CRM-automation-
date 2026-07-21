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

export type NewsletterResult<T, E> = { ok: true; value: T } | { ok: false; error: E };
