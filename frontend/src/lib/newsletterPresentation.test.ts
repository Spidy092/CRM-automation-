import { describe, expect, it } from 'vitest';
import type { NewsletterSubscriber } from '@/api/newsletter';
import { formatNewsletterDate, newsletterDeliveryLabel } from './newsletterPresentation';

const subscriber = (overrides: Partial<NewsletterSubscriber>): NewsletterSubscriber => ({
  id: 'sub-1',
  email: 'reader@example.com',
  status: 'confirmed',
  topics: [],
  frequency: 'weekly',
  source: 'website',
  confirmed_at: null,
  unsubscribed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('newsletter presentation helpers', () => {
  it('uses clear labels for subscriber states and unavailable limit storage', () => {
    expect(newsletterDeliveryLabel(subscriber({ status: 'pending' }))).toBe('Awaiting confirmation');
    expect(newsletterDeliveryLabel(subscriber({ status: 'unsubscribed' }))).toBe('Unsubscribed');
    expect(newsletterDeliveryLabel(subscriber({ send_limits_available: false }))).toBe('Check unavailable');
  });

  it('shows a hold, a future eligible time, or ready status for confirmed subscribers', () => {
    expect(newsletterDeliveryLabel(subscriber({ send_limits_available: true, delivery_reserved: true })))
      .toBe('Sending or awaiting review');
    expect(newsletterDeliveryLabel(subscriber({
      send_limits_available: true,
      next_eligible_at: '2999-01-01T00:00:00.000Z',
    }))).toContain('IST');
    expect(newsletterDeliveryLabel(subscriber({
      send_limits_available: true,
      next_eligible_at: '2000-01-01T00:00:00.000Z',
    }))).toBe('Ready now');
  });

  it('handles missing and invalid dates without throwing', () => {
    expect(formatNewsletterDate(null)).toBe('No recorded send');
    expect(formatNewsletterDate('not-a-date')).toBe('Unavailable');
  });
});
