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

export const metaLeadFormsConfigSchema = z.object({
  integrationId: z.string().min(1, 'integrationId is required for Meta Lead Forms'),
  formId: z.string().min(1, 'formId is required for Meta Lead Forms'),
  sinceHours: z.number().int().positive().max(720).optional().default(24),
  maxResults: z.number().int().positive().max(1000).optional().default(100),
});

export const googleAdsLeadFormsConfigSchema = z.object({
  // Ingestion is webhook-driven; a scheduled run is a no-op by design.
  webhookSecretRef: z.string().min(1).optional(),
});

export const linkedInLeadFormsConfigSchema = z.object({
  mode: z.enum(['api', 'manual_import']).optional().default('manual_import'),
});

/**
 * Per-source-type config schemas, keyed by `source_type`.
 *
 * `scraper_configs.config` is a JSONB blob whose shape depends entirely on
 * the source type, so it cannot be validated by a single flat schema. These
 * were previously defined but never applied — `config` was typed
 * `z.record(z.unknown())`, which meant every documented cap (maxResults,
 * maxPages, maxDepth, waitMs) was advisory and a config could be saved with
 * values that would only fail later, mid-run.
 *
 * Use `parseSourceConfig` rather than reaching into this map directly.
 */
export const SOURCE_CONFIG_SCHEMAS = {
  google_places: googlePlacesConfigSchema,
  facebook: facebookConfigSchema,
  youtube: youtubeConfigSchema,
  web_scrape: webScrapeConfigSchema,
  browser_scrape: browserScrapeConfigSchema,
  apify_actor: apifyActorConfigSchema,
  meta_lead_forms: metaLeadFormsConfigSchema,
  google_ads_lead_forms: googleAdsLeadFormsConfigSchema,
  linkedin_lead_forms: linkedInLeadFormsConfigSchema,
} as const satisfies Record<z.infer<typeof sourceTypeEnum>, z.ZodTypeAny>;

/**
 * Validates a config blob against the schema for its source type and returns
 * the parsed value, with schema defaults applied.
 *
 * Throws ZodError on failure, which `errorHandler` renders as a 422 with the
 * individual field messages — the same treatment every other validated body
 * in the app gets.
 *
 * Applying defaults here (rather than only validating) is deliberate: it means
 * a stored config always carries explicit values, so the run-time code no
 * longer has to guess what an absent key meant.
 */
export function parseSourceConfig(
  sourceType: z.infer<typeof sourceTypeEnum>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const schema = SOURCE_CONFIG_SCHEMAS[sourceType];
  // `.passthrough()` keeps forward-compatible extra keys (e.g. userAgent,
  // crawlDelayMs, respectRobotsTxt) that the run-time code reads defensively
  // but that predate these schemas. Validation still applies to known keys.
  return schema.passthrough().parse(config) as Record<string, unknown>;
}

// Body for the AI "auto-detect selectors" endpoint.
export const detectSelectorsSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

// Body for the "discover pages" endpoint — crawls a site's rendered nav
// links so a user can pick which pages to add to a multi-URL source.
export const discoverPagesSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

// ── Cron validation ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Field bounds for 6-field (seconds-first) cron; the 5-field form drops the first. */
const CRON_FIELDS: Array<{ min: number; max: number; names?: string[] }> = [
  { min: 0, max: 59 }, // second
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12, names: MONTH_NAMES },
  { min: 0, max: 7, names: DAY_NAMES }, // 0 and 7 both mean Sunday
];

function isValidCronValue(
  raw: string,
  spec: { min: number; max: number; names?: string[] },
): boolean {
  const token = raw.toLowerCase();
  if (spec.names) {
    const named = spec.names.indexOf(token);
    if (named !== -1) return true;
  }
  if (!/^\d+$/.test(token)) return false;
  const n = Number(token);
  return n >= spec.min && n <= spec.max;
}

function isValidCronField(
  field: string,
  spec: { min: number; max: number; names?: string[] },
): boolean {
  if (field === '') return false;
  // Comma list: every alternative must independently be valid.
  if (field.includes(',')) {
    const parts = field.split(',');
    return parts.length > 0 && parts.every((part) => isValidCronField(part, spec));
  }
  // Step: <range>/<n>
  const slash = field.indexOf('/');
  if (slash !== -1) {
    const base = field.slice(0, slash);
    const step = field.slice(slash + 1);
    if (!/^\d+$/.test(step) || Number(step) === 0) return false;
    return isValidCronField(base, spec);
  }
  if (field === '*') return true;
  // Range: a-b
  const dash = field.indexOf('-');
  if (dash > 0) {
    const from = field.slice(0, dash);
    const to = field.slice(dash + 1);
    return isValidCronValue(from, spec) && isValidCronValue(to, spec);
  }
  return isValidCronValue(field, spec);
}

/**
 * Validates a standard 5-field (or BullMQ's 6-field, seconds-first) cron
 * expression.
 *
 * This exists because an invalid pattern used to be accepted by the API,
 * written to the database, and only rejected later by BullMQ inside
 * `syncSchedule` — leaving a saved config that displayed a schedule in the UI
 * but had no repeatable job behind it, and a 500 at the API.
 *
 * Implemented locally rather than via `cron-parser`: that package is present
 * only as a transitive dependency of BullMQ, so importing it directly would
 * break silently whenever BullMQ changes its dependency tree. Promoting it to
 * a direct dependency needs sign-off (see CLAUDE.md), so this covers the
 * syntax BullMQ accepts without adding one.
 */
export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  // A 5-field expression omits the leading seconds field.
  const specs = fields.length === 6 ? CRON_FIELDS : CRON_FIELDS.slice(1);
  return fields.every((field, i) => isValidCronField(field, specs[i]));
}

/**
 * `schedule_cron` accepts null/'' (meaning "no schedule") or a valid cron
 * expression. Empty string normalises to null so the repository and scheduler
 * see one single "unscheduled" representation.
 */
const scheduleCronSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
  .refine((v) => v === null || isValidCronExpression(v), {
    message:
      'Invalid cron expression. Use 5 fields (minute hour day-of-month month day-of-week), e.g. "0 3 * * *" for daily at 03:00.',
  });

export const createScraperConfigSchema = z.object({
  name: z.string().min(1).max(255),
  source_type: sourceTypeEnum,
  is_active: z.boolean().optional().default(true),
  config: z.record(z.unknown()),
  schedule_cron: scheduleCronSchema,
  webhook_url: z.string().url('Must be a valid URL').max(2048).nullable().optional(),
  group_name: z.string().max(255).nullable().optional(),
});

export const updateScraperConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_active: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  schedule_cron: scheduleCronSchema,
  webhook_url: z.string().url('Must be a valid URL').max(2048).nullable().optional(),
  group_name: z.string().max(255).nullable().optional(),
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
