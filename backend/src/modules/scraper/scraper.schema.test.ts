import {
  createScraperConfigSchema,
  isValidCronExpression,
  parseSourceConfig,
} from './scraper.schema';

describe('isValidCronExpression', () => {
  it.each([
    ['0 3 * * *', 'daily at 03:00'],
    ['*/15 * * * *', 'every 15 minutes'],
    ['0 0 1 * *', 'monthly'],
    ['0 9 * * 1-5', 'weekday range'],
    ['0 9 * * mon-fri', 'named day range'],
    ['0 0 1 jan *', 'named month'],
    ['30 2,14 * * *', 'comma list'],
    ['0 0 */2 * *', 'step on day-of-month'],
    ['*/30 * * * * *', '6-field seconds-first form'],
  ])('accepts %s (%s)', (expr) => {
    expect(isValidCronExpression(expr)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['not a cron', 'garbage'],
    ['0 3 * *', 'only 4 fields'],
    ['0 3 * * * * *', '7 fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 32 * *', 'day-of-month out of range'],
    ['* * * 13 *', 'month out of range'],
    ['* * * * 8', 'day-of-week out of range'],
    ['*/0 * * * *', 'zero step'],
    ['0 3 * * xyz', 'unknown day name'],
    ['1-99 * * * *', 'range endpoint out of bounds'],
  ])('rejects %s (%s)', (expr) => {
    expect(isValidCronExpression(expr)).toBe(false);
  });
});

describe('createScraperConfigSchema schedule_cron', () => {
  const base = {
    name: 'Test',
    source_type: 'web_scrape' as const,
    config: { url: 'https://example.com' },
  };

  it('rejects an invalid cron expression instead of persisting it', () => {
    const result = createScraperConfigSchema.safeParse({ ...base, schedule_cron: 'every day' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid cron expression', () => {
    const result = createScraperConfigSchema.safeParse({ ...base, schedule_cron: '0 3 * * *' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.schedule_cron).toBe('0 3 * * *');
  });

  it('normalises empty string and undefined to null (one "unscheduled" representation)', () => {
    for (const input of ['', '   ', undefined, null]) {
      const result = createScraperConfigSchema.safeParse({ ...base, schedule_cron: input });
      expect(result.success).toBe(true);
      expect(result.success && result.data.schedule_cron).toBeNull();
    }
  });

  it('trims surrounding whitespace', () => {
    const result = createScraperConfigSchema.safeParse({ ...base, schedule_cron: '  0 3 * * *  ' });
    expect(result.success && result.data.schedule_cron).toBe('0 3 * * *');
  });
});

describe('parseSourceConfig', () => {
  it('rejects a google_places config missing the required query', () => {
    expect(() => parseSourceConfig('google_places', { apiKeyRef: 'K' })).toThrow();
  });

  it('rejects maxResults above the documented cap', () => {
    expect(() =>
      parseSourceConfig('google_places', { query: 'cafes', apiKeyRef: 'K', maxResults: 5000 }),
    ).toThrow();
  });

  it('applies defaults so stored configs carry explicit values', () => {
    const parsed = parseSourceConfig('google_places', { query: 'cafes', apiKeyRef: 'K' });
    expect(parsed.maxResults).toBe(20);
  });

  it('defaults web_scrape mode to smart', () => {
    const parsed = parseSourceConfig('web_scrape', { url: 'https://example.com' });
    expect(parsed.mode).toBe('smart');
    expect(parsed.maxPages).toBe(1);
  });

  it('rejects web_scrape maxPages above the cap', () => {
    expect(() =>
      parseSourceConfig('web_scrape', { url: 'https://example.com', maxPages: 10_000 }),
    ).toThrow();
  });

  it('rejects a deep-crawl maxDepth above the cap', () => {
    expect(() =>
      parseSourceConfig('web_scrape', {
        url: 'https://example.com',
        followLinks: true,
        maxDepth: 50,
      }),
    ).toThrow();
  });

  it('rejects a malformed url', () => {
    expect(() => parseSourceConfig('web_scrape', { url: 'not-a-url' })).toThrow();
  });

  it('keeps unknown forward-compatible keys the run-time code reads', () => {
    const parsed = parseSourceConfig('web_scrape', {
      url: 'https://example.com',
      crawlDelayMs: 5000,
      respectRobotsTxt: false,
      userAgent: 'Custom/1.0',
    });
    expect(parsed.crawlDelayMs).toBe(5000);
    expect(parsed.respectRobotsTxt).toBe(false);
    expect(parsed.userAgent).toBe('Custom/1.0');
  });

  it('validates browser_scrape waitMs against its cap', () => {
    expect(() =>
      parseSourceConfig('browser_scrape', { url: 'https://example.com', waitMs: 999_999 }),
    ).toThrow();
  });

  it('requires integrationId and formId for meta_lead_forms', () => {
    expect(() => parseSourceConfig('meta_lead_forms', { formId: 'f1' })).toThrow();
    expect(() =>
      parseSourceConfig('meta_lead_forms', { integrationId: 'i1', formId: 'f1' }),
    ).not.toThrow();
  });

  it('requires an actorId for apify_actor', () => {
    expect(() => parseSourceConfig('apify_actor', {})).toThrow();
    expect(() => parseSourceConfig('apify_actor', { actorId: 'user~actor' })).not.toThrow();
  });
});
