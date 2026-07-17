import { z } from 'zod';

export const sourceTypeEnum = z.enum([
  'google_places',
  'facebook',
  'youtube',
  'web_scrape',
  'apify_actor',
  'browser_scrape',
  'meta_lead_forms',
  'google_ads_lead_forms',
  'linkedin_lead_forms',
]);

/** A single URL, or a list of URLs (one per line in the UI) to scrape in one run. */
const urlOrUrls = z.union([
  z.string().url('Must be a valid URL'),
  z.array(z.string().url('Must be a valid URL')).min(1, 'At least one URL is required'),
]);

export const googlePlacesConfigSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  location: z.string().optional(),
  radius: z.number().int().positive().max(50000).optional(),
  maxResults: z.number().int().positive().max(50).optional().default(20),
  apiKeyRef: z.string().min(1, 'API key reference is required'),
});

export const facebookConfigSchema = z.object({
  pageId: z.string().min(1, 'Page ID is required'),
  accessTokenRef: z.string().min(1, 'Access token reference is required'),
  fields: z.array(z.string()).optional(),
  maxPosts: z.number().int().positive().max(100).optional().default(25),
});

export const youtubeConfigSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  channelId: z.string().optional(),
  maxResults: z.number().int().positive().max(50).optional().default(10),
  apiKeyRef: z.string().min(1, 'API key reference is required'),
});

/**
 * Deep-crawl options shared by web_scrape and browser_scrape. When
 * followLinks is on, the scraper BFS-crawls same-origin links from each
 * listed URL up to maxDepth, and maxPages becomes the TOTAL page budget
 * for the run (instead of pages-per-URL pagination).
 */
const deepCrawlFields = {
  followLinks: z.boolean().optional().default(false),
  // Link depth from the listed URLs: 1 = only pages linked from them, etc.
  maxDepth: z.number().int().min(1).max(5).optional().default(2),
  // Substring filters applied to discovered links (not to the listed URLs).
  includePatterns: z.array(z.string().min(1)).max(20).optional(),
  excludePatterns: z.array(z.string().min(1)).max(20).optional(),
};

export const webScrapeConfigSchema = z.object({
  url: urlOrUrls,
  // 'smart' = selector-free extraction (regex emails/phones, page title as name).
  // 'selectors' = explicit CSS selector extraction (the original behaviour).
  mode: z.enum(['smart', 'selectors']).optional().default('smart'),
  // Only required in 'selectors' mode — enforced at run time in scrapeWeb().
  selectors: z.record(z.string(), z.string()).optional(),
  containerSelector: z.string().optional(),
  paginationSelector: z.string().optional(),
  maxPages: z.number().int().positive().max(100).optional().default(1),
  headers: z.record(z.string(), z.string()).optional(),
  ...deepCrawlFields,
});

export const browserScrapeConfigSchema = z.object({
  url: urlOrUrls,
  // Same mode split as web_scrape: 'smart' mines emails/phones from the
  // rendered DOM, 'selectors' extracts explicit CSS-targeted fields.
  mode: z.enum(['smart', 'selectors']).optional().default('smart'),
  selectors: z.record(z.string(), z.string()).optional(),
  containerSelector: z.string().optional(),
  // CSS selector to wait for before reading the DOM — required for content
  // that renders after an XHR/fetch call (most SPA listing pages).
  waitForSelector: z.string().optional(),
  // Extra fixed delay (ms) after navigation, on top of waitForSelector.
  waitMs: z.number().int().min(0).max(15000).optional().default(0),
  maxPages: z.number().int().positive().max(30).optional().default(1),
  headers: z.record(z.string(), z.string()).optional(),
  ...deepCrawlFields,
});

export const apifyActorConfigSchema = z.object({
  // Actor id or tilde-separated "username~actor-name" (e.g. "compass~crawler-google-places").
  actorId: z.string().min(1, 'Actor id is required'),
  // Passed through verbatim as the Actor's INPUT — shape is actor-specific.
  input: z.record(z.unknown()).optional().default({}),
  maxResults: z.number().int().positive().max(1000).optional().default(100),
});

// Body for the AI "auto-detect selectors" endpoint.
export const detectSelectorsSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

// Body for the "discover pages" endpoint — crawls a site's rendered nav
// links so a user can pick which pages to add to a multi-URL source.
export const discoverPagesSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

export const createScraperConfigSchema = z.object({
  name: z.string().min(1).max(255),
  source_type: sourceTypeEnum,
  is_active: z.boolean().optional().default(true),
  config: z.record(z.unknown()),
  schedule_cron: z.string().nullable().optional(),
});

export const updateScraperConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_active: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  schedule_cron: z.string().nullable().optional(),
});

export const triggerScrapeSchema = z.object({
  configId: z.string().uuid(),
});

export const listLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const statsSummaryQuerySchema = z.object({
  hours: z.coerce.number().int().positive().max(720).optional().default(24),
});

export type CreateScraperConfigInput = z.infer<typeof createScraperConfigSchema>;
export type UpdateScraperConfigInput = z.infer<typeof updateScraperConfigSchema>;
