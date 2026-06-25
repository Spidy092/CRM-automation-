import * as cheerio from 'cheerio';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  ScraperConfigInput,
  ScraperConfigRow,
  ScraperConfigUpdate,
  ScraperActor,
  ScraperRunResult,
} from './scraper.types';
import {
  findScraperConfigById,
  findScraperConfigs,
  insertScraperConfig,
  updateScraperConfig,
  deleteScraperConfig,
  insertScraperLog,
  updateScraperLog,
  findScraperLogsByConfig,
  countScraperLogsByConfig,
  updateScraperConfigLastRun,
} from './scraper.repository';

interface ScrapedLead {
  business_name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string | null;
  industry?: string;
  location?: string;
  country?: string;
  google_rating?: number | null;
  review_count?: number | null;
  source_platform: string;
}

// ── Placeholder helpers ────────────────────────────────────────────────────

/**
 * Generates a stable, unique-enough placeholder phone for scraped leads that
 * have no real phone number. The value is deterministic for the same seed so
 * re-scraping the same business does not produce a new record (dedup key is
 * phone + platform). Format: +0{10 digits} — passes E.164 validation but is
 * clearly synthetic. Should be updated when real contact info is collected.
 */
function generatePlaceholderPhone(seed: string): string {
  const digits = seed
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0).toString(), '')
    .slice(-10)
    .padStart(10, '0');
  return `+0${digits}`;
}

/**
 * Generates a stable placeholder email for scraped leads that have no real
 * email address. Unique per business + location + source platform combo.
 */
function generatePlaceholderEmail(
  businessName: string,
  location: string | undefined,
  sourcePlatform: string,
): string {
  const slug =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'unknown';
  const locSlug =
    (location ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'noloc';
  return `${slug}-${locSlug}@${sourcePlatform}-scraped.local`;
}

/**
 * Validates that the given ref is the NAME of a configured env variable, not
 * a raw API key. Throws AppError with actionable guidance if the var is absent.
 */
function assertEnvVarConfigured(ref: unknown, label: string): string {
  if (typeof ref !== 'string' || !ref) {
    throw new AppError(`${label} is required in the scraper config`, 400);
  }
  const value = process.env[ref] ?? '';
  if (!value) {
    throw new AppError(
      `Environment variable "${ref}" is not set. ` +
        `Add ${ref}=<your-${label.toLowerCase()}> to your .env file and restart the server. ` +
        `The config field must contain the env variable NAME (e.g. "GOOGLE_PLACES_API_KEY"), not the raw key value.`,
      400,
    );
  }
  return value;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listConfigs(): Promise<ScraperConfigRow[]> {
  return findScraperConfigs();
}

export async function getConfigById(id: string): Promise<ScraperConfigRow> {
  const config = await findScraperConfigById(id);
  if (!config) throw new AppError('Scraper config not found', 404);
  return config;
}

/** Validate that all apiKeyRef / accessTokenRef fields point to real env vars. */
function validateApiKeyRefs(sourceType: string, config: Record<string, unknown>): void {
  if (sourceType === 'google_places' || sourceType === 'youtube') {
    assertEnvVarConfigured(config.apiKeyRef, 'apiKeyRef');
  }
  if (sourceType === 'facebook') {
    assertEnvVarConfigured(config.accessTokenRef, 'accessTokenRef');
  }
}

export async function createConfig(
  input: ScraperConfigInput,
  actor: ScraperActor,
): Promise<ScraperConfigRow> {
  // Fix: validate that apiKeyRef / accessTokenRef reference existing env vars,
  // not raw key values, so misconfigurations are caught at save time.
  validateApiKeyRefs(input.source_type, input.config);

  const config = await insertScraperConfig(input, actor.id);
  await writeAuditLog({
    userId: actor.id,
    action: 'scraper_config.created',
    entityType: 'scraper_config',
    entityId: config.id,
    newValue: { name: config.name, source_type: config.source_type },
    ipAddress: actor.ipAddress ?? null,
  });
  return config;
}

export async function updateConfig(
  id: string,
  input: ScraperConfigUpdate,
  actor: ScraperActor,
): Promise<ScraperConfigRow> {
  const before = await getConfigById(id);

  // Validate updated config fields against env vars if the config blob is changing.
  if (input.config) {
    validateApiKeyRefs(before.source_type, input.config);
  }

  const updated = await updateScraperConfig(id, input);
  if (!updated) throw new AppError('Scraper config not found', 404);
  await writeAuditLog({
    userId: actor.id,
    action: 'scraper_config.updated',
    entityType: 'scraper_config',
    entityId: id,
    oldValue: { name: before.name },
    newValue: { name: updated.name, is_active: updated.is_active },
    ipAddress: actor.ipAddress ?? null,
  });
  return updated;
}

export async function removeConfig(id: string, actor: ScraperActor): Promise<void> {
  await getConfigById(id);
  await deleteScraperConfig(id);
  await writeAuditLog({
    userId: actor.id,
    action: 'scraper_config.deleted',
    entityType: 'scraper_config',
    entityId: id,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function getLogsByConfig(
  configId: string,
  limit: number,
  offset: number,
): Promise<{ items: import('./scraper.types').ScraperLogRow[]; total: number }> {
  const items = await findScraperLogsByConfig(configId, limit, offset);
  const total = await countScraperLogsByConfig(configId);
  return { items, total };
}

// ── Scrape Execution ───────────────────────────────────────────────────────

export async function runScrape(configId: string, _actor: ScraperActor): Promise<ScraperRunResult> {
  const config = await getConfigById(configId);
  if (!config.is_active) {
    throw new AppError('Scraper config is not active', 400);
  }

  const log = await insertScraperLog({ config_id: configId, status: 'running' });

  try {
    const result = await executeScraper(config);
    const status =
      result.recordsFailed > 0 && result.recordsFound > 0
        ? 'partially_completed'
        : result.recordsFailed > 0
          ? 'failed'
          : 'completed';

    await updateScraperLog(log.id, {
      status,
      completed_at: new Date().toISOString(),
      records_found: result.recordsFound,
      records_imported: result.recordsImported,
      records_failed: result.recordsFailed,
      raw_response: result.rawResponse,
    });

    await updateScraperConfigLastRun(configId, new Date().toISOString());

    logger.info('scraper run completed', {
      configId,
      source_type: config.source_type,
      recordsFound: result.recordsFound,
      recordsImported: result.recordsImported,
      status,
    });

    return {
      logId: log.id,
      recordsFound: result.recordsFound,
      recordsImported: result.recordsImported,
      recordsFailed: result.recordsFailed,
      status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await updateScraperLog(log.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: message,
    });

    logger.error('scraper run failed', {
      configId,
      source_type: config.source_type,
      error: message,
    });

    return {
      logId: log.id,
      recordsFound: 0,
      recordsImported: 0,
      recordsFailed: 0,
      status: 'failed',
    };
  }
}

async function executeScraper(config: ScraperConfigRow): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  switch (config.source_type) {
    case 'google_places':
      return scrapeGooglePlaces(config.config);
    case 'facebook':
      return scrapeFacebook(config.config);
    case 'youtube':
      return scrapeYouTube(config.config);
    case 'web_scrape':
      return scrapeWeb(config.config);
    default:
      throw new AppError(`Unknown scraper source type: ${String(config.source_type)}`, 500);
  }
}

// ── Google Places Scraper ──────────────────────────────────────────────────

async function scrapeGooglePlaces(_config: Record<string, unknown>): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper google_places: starting API call');

  // apiKeyRef must be the NAME of an env var (e.g. "GOOGLE_PLACES_API_KEY"), not the raw key.
  const apiKey = assertEnvVarConfigured(_config.apiKeyRef, 'apiKeyRef');

  const query = String(_config.query ?? '');
  const location = typeof _config.location === 'string' ? _config.location : '';
  const radius = Number(_config.radius) || 5000;
  const maxResults = Number(_config.maxResults) || 20;

  // Build the initial Text Search request params
  const baseParams = new URLSearchParams({ query, key: apiKey });
  if (location) baseParams.append('location', location);
  if (radius) baseParams.append('radius', String(radius));

  let rawResults: unknown[] = [];
  let nextPageToken: string | null = null;

  do {
    // Fix: page 2+ must ONLY send pagetoken + key.
    // Mixing the original search params with pagetoken triggers INVALID_REQUEST.
    const url = nextPageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(nextPageToken)}&key=${apiKey}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?${baseParams.toString()}`;

    // Fix: check HTTP-level errors before parsing the response body
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError(
        `Google Places Text Search HTTP error: ${response.status} ${response.statusText}`,
        502,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const apiStatus = String(data.status ?? '');

    if (apiStatus === 'REQUEST_DENIED') {
      throw new AppError(
        'Google Places API key rejected (REQUEST_DENIED). Verify the key is correct and the Places API is enabled in Google Cloud Console.',
        400,
      );
    }
    if (apiStatus === 'INVALID_REQUEST') {
      throw new AppError(
        'Google Places rejected the request (INVALID_REQUEST). Check the query and location params.',
        400,
      );
    }
    if (apiStatus === 'OVER_QUERY_LIMIT') {
      throw new AppError(
        'Google Places daily quota exceeded (OVER_QUERY_LIMIT). Try again tomorrow or increase your quota.',
        429,
      );
    }
    if (apiStatus === 'ZERO_RESULTS') break; // no matches — not an error

    const places = (data.results as unknown[]) ?? [];
    rawResults = rawResults.concat(places);
    nextPageToken = typeof data.next_page_token === 'string' ? data.next_page_token : null;

    // Google requires ~2 s before next_page_token becomes usable
    if (nextPageToken) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  } while (nextPageToken && rawResults.length < maxResults);

  // Fix: Text Search does NOT return formatted_phone_number or website in its results.
  // Call Place Details per result to fetch real contact data before importing.
  const leads: ScrapedLead[] = [];

  for (const place of rawResults.slice(0, maxResults)) {
    const p = place as Record<string, unknown>;
    const placeId = typeof p.place_id === 'string' ? p.place_id : '';
    const businessName = String(p.name ?? '');

    let phone: string | undefined;
    let website: string | null = null;

    if (placeId) {
      try {
        const detailsParams = new URLSearchParams({
          place_id: placeId,
          fields: 'formatted_phone_number,website',
          key: apiKey,
        });
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?${detailsParams.toString()}`;
        const detailsResp = await fetch(detailsUrl);

        if (detailsResp.ok) {
          const detailsData = (await detailsResp.json()) as Record<string, unknown>;
          const detail = detailsData.result as Record<string, string> | undefined;
          const rawPhone = detail?.formatted_phone_number?.trim();
          const rawWebsite = detail?.website?.trim();
          if (rawPhone) phone = rawPhone;
          if (rawWebsite) website = rawWebsite;
        }
      } catch {
        // Non-fatal: log and continue — the place will still be imported with placeholders
        logger.warn('scraper google_places: place details call failed', { placeId, businessName });
      }

      // Stay within the Places Details rate limit (~50 QPM)
      await new Promise((r) => setTimeout(r, 200));
    }

    // Fix: generate unique, deterministic placeholders for phone/email when the
    // Places API provides no contact info. Derived from place_id so the same place
    // always gets the same placeholder — preventing duplicate rows on re-scrape.
    // These values are clearly synthetic and should be updated when real contact
    // info is collected (e.g. via enrichment or manual entry).
    const placeholderSeed = placeId || `${businessName}|${String(p.formatted_address ?? '')}`;
    const idDigits = placeholderSeed
      .split('')
      .reduce((acc, c) => acc + c.charCodeAt(0).toString(), '')
      .slice(-10)
      .padStart(10, '0');

    // Prefer using the website domain for the email so it looks real when the
    // website IS available; fall back to a clearly-synthetic local address.
    let email: string;
    if (website) {
      try {
        const domain = new URL(website).hostname.replace(/^www\./, '');
        email = `no-reply@${domain}`;
      } catch {
        email = `no-reply-${placeId.slice(0, 8).toLowerCase()}@google-scraped.local`;
      }
    } else {
      email = `no-reply-${placeId.slice(0, 8).toLowerCase()}@google-scraped.local`;
    }

    leads.push({
      business_name: businessName,
      // contact_name intentionally omitted — Text Search provides no person name
      phone: phone ?? `+0${idDigits}`,
      email,
      website,
      location: String(p.formatted_address ?? ''),
      google_rating: typeof p.rating === 'number' ? p.rating : null,
      review_count:
        typeof p.user_ratings_total === 'number'
          ? (p as Record<string, number>).user_ratings_total
          : null,
      source_platform: 'google_business',
    });
  }

  const stats = await importLeads(leads);
  return {
    ...stats,
    rawResponse: { total_results: rawResults.length },
  };
}

// ── Facebook Scraper ───────────────────────────────────────────────────────

async function scrapeFacebook(_config: Record<string, unknown>): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper facebook: starting API call');

  const pageId = String(_config.pageId ?? '');
  const accessToken = assertEnvVarConfigured(_config.accessTokenRef, 'accessTokenRef');

  const fields = Array.isArray(_config.fields)
    ? (_config.fields as string[]).join(',')
    : 'name,about,phone,website,emails,location,rating_count,overall_star_rating';
  const maxPosts = Number(_config.maxPosts) || 25;

  // Fetch page info
  const pageUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=${fields}&access_token=${accessToken}`;
  const pageResponse = await fetch(pageUrl);
  // Fix: check HTTP status before parsing
  if (!pageResponse.ok) {
    throw new AppError(
      `Facebook Graph API HTTP error: ${pageResponse.status} ${pageResponse.statusText}`,
      502,
    );
  }
  const pageData = (await pageResponse.json()) as Record<string, unknown>;

  if (pageData.error) {
    throw new AppError(
      `Facebook API error: ${String((pageData.error as Record<string, unknown>).message)}`,
      400,
    );
  }

  const leads: ScrapedLead[] = [];
  const loc = pageData.location as Record<string, string> | undefined;
  const locationStr = loc ? [loc.city, loc.state, loc.country].filter(Boolean).join(', ') : '';

  leads.push({
    business_name: String(pageData.name ?? ''),
    phone: String(pageData.phone ?? '') || undefined,
    email: Array.isArray(pageData.emails)
      ? String((pageData.emails as string[])[0] ?? '') || undefined
      : undefined,
    website: String(pageData.website ?? '') || null,
    location: locationStr,
    source_platform: 'facebook',
  });

  // Fetch recent posts to surface mentioned businesses
  const postsUrl = `https://graph.facebook.com/v18.0/${pageId}/posts?fields=message,created_time&limit=${maxPosts}&access_token=${accessToken}`;
  const postsResponse = await fetch(postsUrl);
  // Fix: check HTTP status
  if (!postsResponse.ok) {
    logger.warn('scraper facebook: posts fetch failed', {
      status: postsResponse.status,
      statusText: postsResponse.statusText,
    });
  }
  const postsData = postsResponse.ok
    ? ((await postsResponse.json()) as Record<string, unknown>)
    : { data: [] };
  const posts = (postsData.data as unknown[]) ?? [];

  const stats = await importLeads(leads);
  return {
    ...stats,
    rawResponse: { page_name: pageData.name, posts_count: posts.length },
  };
}

// ── YouTube Scraper ────────────────────────────────────────────────────────

async function scrapeYouTube(_config: Record<string, unknown>): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper youtube: starting API call');

  const query = String(_config.query ?? '');
  const apiKey = assertEnvVarConfigured(_config.apiKeyRef, 'apiKeyRef');
  const maxResults = Number(_config.maxResults) || 10;

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    maxResults: String(maxResults),
    type: 'channel',
    key: apiKey,
  });

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const response = await fetch(url);
  // Fix: check HTTP status before parsing
  if (!response.ok) {
    throw new AppError(`YouTube API HTTP error: ${response.status} ${response.statusText}`, 502);
  }
  const data = (await response.json()) as Record<string, unknown>;

  if (data.error) {
    throw new AppError(
      `YouTube API error: ${String((data.error as Record<string, unknown>).message)}`,
      400,
    );
  }

  const items = (data.items as unknown[]) ?? [];
  const leads: ScrapedLead[] = items.map((item: unknown) => {
    const snippet = (item as Record<string, unknown>).snippet as Record<string, unknown>;
    return {
      business_name: String(snippet?.channelTitle ?? snippet?.title ?? ''),
      location: String(snippet?.country ?? ''),
      source_platform: 'youtube',
    };
  });

  const stats = await importLeads(leads);
  return {
    ...stats,
    rawResponse: { query, results_count: items.length },
  };
}

// ── Web Scraper (Cheerio) ──────────────────────────────────────────────────

async function scrapeWeb(_config: Record<string, unknown>): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper web_scrape: starting');

  const url = String(_config.url ?? '');
  const selectors = _config.selectors as Record<string, string> | undefined;
  const maxPages = Number(_config.maxPages) || 1;
  const headers = _config.headers as Record<string, string> | undefined;

  if (!url) throw new AppError('URL is required for web scraping', 400);
  if (!selectors || Object.keys(selectors).length === 0) {
    throw new AppError('CSS selectors are required for web scraping', 400);
  }

  const allLeads: ScrapedLead[] = [];
  const fetchOpts: Record<string, unknown> = {};
  if (headers) fetchOpts.headers = headers;

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1 ? url : `${url}?page=${page}`;
    const response = await fetch(pageUrl, fetchOpts);
    // Fix: check HTTP status
    if (!response.ok) {
      logger.warn('scraper web_scrape: page fetch failed', {
        page,
        status: response.status,
        url: pageUrl,
      });
      break;
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    const firstSelector = Object.values(selectors)[0];
    if (!firstSelector) continue;

    const items: Record<string, string>[] = [];
    const elements = $(firstSelector);

    if (elements.length > 0) {
      const fieldKeys = Object.keys(selectors);
      const containerSelector = _config.containerSelector as string | undefined;
      const containers = containerSelector ? $(containerSelector) : elements.parent().parent();

      containers.each((_i, container) => {
        const entry: Record<string, string> = {};
        for (const key of fieldKeys) {
          const sel = selectors[key];
          const el = $(container).find(sel).first();
          entry[key] = el.text().trim();
        }
        if (entry.business_name || entry.phone) {
          items.push(entry);
        }
      });
    }

    for (const item of items) {
      allLeads.push({
        business_name: item.business_name || 'Unknown Business',
        phone: item.phone || undefined,
        email: item.email || undefined,
        website: item.website || undefined,
        location: item.location || '',
        source_platform: 'web_scrape',
      });
    }

    if (page < maxPages && _config.paginationSelector) {
      const pagEl = $(_config.paginationSelector as string);
      if (pagEl.length === 0) break;
    }

    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const stats = await importLeads(allLeads);
  return {
    ...stats,
    rawResponse: {
      url,
      pages_scraped: Math.min(maxPages, Math.ceil(allLeads.length / 10) || 1),
    },
  };
}

// ── Lead Import Helper ─────────────────────────────────────────────────────

async function importLeads(
  leads: ScrapedLead[],
): Promise<{ recordsFound: number; recordsImported: number; recordsFailed: number }> {
  // Hoist dynamic import outside the loop — module is cached after the first call
  const { createLead } = await import('../leads/leads.service');

  let imported = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      const actor: {
        id: string;
        role: import('../../shared/types').UserRole;
        ipAddress?: string | null;
      } = { id: '00000000-0000-0000-0000-000000000000', role: 'admin' };

      // Fix: replace the single shared +0000000000 placeholder with unique
      // deterministic values so the phone-based dedup index doesn't falsely
      // merge distinct businesses that have no known phone number.
      const phoneSeed = `${lead.phone ?? ''}|${lead.business_name}|${lead.location ?? ''}`;
      const phone = lead.phone || generatePlaceholderPhone(phoneSeed);
      const email =
        lead.email ||
        generatePlaceholderEmail(lead.business_name, lead.location, lead.source_platform);

      await createLead(
        {
          business_name: lead.business_name,
          // Fall back to business name — it is the most meaningful available value
          // when the scraper source does not provide a contact person name.
          contact_name: lead.contact_name || lead.business_name,
          phone,
          email,
          website: lead.website || null,
          industry: lead.industry || 'Unknown',
          location: lead.location || 'Unknown',
          source_platform: lead.source_platform,
          google_rating: lead.google_rating ?? null,
          review_count: lead.review_count ?? null,
          tags: [lead.source_platform],
        },
        actor,
      );
      imported++;
    } catch (err) {
      // 409 means the lead already exists — count as imported (idempotent re-run)
      if (err instanceof AppError && err.statusCode === 409) {
        imported++;
      } else {
        failed++;
        logger.warn('scraper failed to import lead', {
          business_name: lead.business_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { recordsFound: leads.length, recordsImported: imported, recordsFailed: failed };
}
