import type { NewsletterSubscriber, NewsletterTopic } from '@/api/newsletter';

export const NEWSLETTER_TOPIC_LABELS: Record<NewsletterTopic, string> = {
  product_updates: 'Product updates',
  promotions: 'Promotions',
  company_news: 'Company news',
};

export function formatNewsletterDate(value: string | null | undefined): string {
  if (!value) return 'No recorded send';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(date) + ' IST';
}

export function newsletterDeliveryLabel(subscriber: NewsletterSubscriber): string {
  if (subscriber.status === 'pending') return 'Awaiting confirmation';
  if (subscriber.status === 'unsubscribed') return 'Unsubscribed';
  if (!subscriber.send_limits_available) return 'Check unavailable';
  if (subscriber.delivery_reserved) return 'Sending or awaiting review';
  if (subscriber.next_eligible_at && new Date(subscriber.next_eligible_at).getTime() > Date.now()) {
    return formatNewsletterDate(subscriber.next_eligible_at);
  }
  return 'Ready now';
}
