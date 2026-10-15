import { newsletterBroadcastJobId } from './newsletterJobId';

describe('newsletterBroadcastJobId', () => {
  it('maps colon-bearing and Unicode keys consistently without exposing content', () => {
    const key = 'Update: October / 日本語';
    const id = newsletterBroadcastJobId(key);
    expect(id).toMatch(/^newsletter-broadcast-[a-f0-9]{64}$/);
    expect(id).toBe(newsletterBroadcastJobId(key));
    expect(id).not.toBe(newsletterBroadcastJobId(`${key}!`));
  });
});
