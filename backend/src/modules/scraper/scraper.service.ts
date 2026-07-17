import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { z } from 'zod';
import { fetchFormLeads } from '../integrations/facebook/facebook.connector';
import { loadCredentials as loadApifyCredentials, runActorSync } from '../integrations/apify/apify.connector';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { normalizePhone } from '../../shared/utils/phone';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import {
  ScraperConfigInput,
  ScraperConfigRow,
  ScraperConfigWithHealth,
  ScraperConfigUpdate,
  ScraperActor,
  ScraperRunResult,
  ScraperStatsSummary,
  FailedScrapeItem,
} from './scraper.types';
import {
  findScraperConfigById,
  findScraperConfigsWithHealth,
  insertScraperConfig,
  updateScraperConfig,
  deleteScraperConfig,
  insertScraperLog,
  updateScraperLog,
  findScraperLogById,
  findScraperLogsByConfig,
  countScraperLogsByConfig,
  updateScraperConfigLastRun,
  sumScraperLogsSince,
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
/**
 * Deterministic 32-bit hash (djb2-style) over the FULL seed string, so any
 * difference anywhere in the seed changes the output. The previous approach
 * concatenated char codes and took only the last 10 characters, which meant
 * seeds sharing a common suffix (e.g. two emails at the same domain, like
 * "sales@acme.com" / "support@acme.com") collided on an identical fake phone.
 */
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function generatePlaceholderPhone(seed: string): string {
  const digits = String(hashSeed(seed)).padStart(10, '0');
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

export async function listConfigs(): Promise<ScraperConfigWithHealth[]> {
  return findScraperConfigsWithHealth();
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
  if (sourceType === 'google_ads_lead_forms' && config.webhookSecretRef) {
    assertEnvVarConfigured(config.webhookSecretRef, 'webhookSecretRef');
  }
}

function getStringField(fields: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const direct = fields[name];
    if (direct) return direct;
  }
  return '';
}

function normalizeLeadFormFields(
  fieldData: Array<{ name: string; values: string[] }>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of fieldData) {
    const key = field.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const value = field.values.find((v) => v.trim().length > 0)?.trim() ?? '';
    if (key && value) fields[key] = value;
  }
  return fields;
}

function leadFromFormFields(
  fields: Record<string, string>,
  fallbackName: string,
  sourcePlatform: string,
): ScrapedLead {
  const contactName = getStringField(fields, ['full_name', 'name', 'contact_name', 'first_name']);
  const businessName =
    getStringField(fields, ['company_name', 'company', 'business_name', 'organization']) ||
    contactName ||
    fallbackName;

  return {
    business_name: businessName,
    contact_name: contactName || businessName,
    phone: getStringField(fields, ['phone_number', 'phone', 'mobile_phone', 'mobile']),
    email: getStringField(fields, ['email', 'email_address', 'work_email']),
    location: getStringField(fields, ['city', 'location', 'state', 'country']),
    industry: getStringField(fields, ['industry']),
    source_platform: sourcePlatform,
  };
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

/** Structural shape shared by every executeScraper branch and importLeads. */
interface ScrapeStats {
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}

/**
 * Persists a successful (or partially-failed) run's stats to its log row,
 * bumps the config's last_run_at, and builds the ScraperRunResult. Shared by
 * runScrape and retryFailedItems so both write logs the same way.
 */
async function finalizeSuccessfulRun(
  logId: string,
  configId: string,
  sourceType: string,
  result: ScrapeStats,
): Promise<ScraperRunResult> {
  const status =
    result.recordsFailed > 0 && result.recordsFound > 0
      ? 'partially_completed'
      : result.recordsFailed > 0
        ? 'failed'
        : 'completed';

  await updateScraperLog(logId, {
    status,
    completed_at: new Date().toISOString(),
    records_found: result.recordsFound,
    records_imported: result.recordsImported,
    records_duplicate: result.recordsDuplicate,
    records_failed: result.recordsFailed,
    raw_response: result.rawResponse,
    failed_items: result.failedItems,
    duplicate_lead_ids: result.duplicateLeadIds,
  });

  await updateScraperConfigLastRun(configId, new Date().toISOString());

  logger.info('scraper run completed', {
    configId,
    source_type: sourceType,
    recordsFound: result.recordsFound,
    recordsImported: result.recordsImported,
    status,
  });

  return {
    logId,
    recordsFound: result.recordsFound,
    recordsImported: result.recordsImported,
    recordsDuplicate: result.recordsDuplicate,
    recordsFailed: result.recordsFailed,
    status,
    errorMessage: null,
  };
}

export async function runScrape(configId: string, _actor: ScraperActor): Promise<ScraperRunResult> {
  const config = await getConfigById(configId);
  if (!config.is_active) {
    throw new AppError('Scraper config is not active', 400);
  }

  const log = await insertScraperLog({ config_id: configId, status: 'running' });

  try {
    const result = await executeScraper(config, log.id);
    return await finalizeSuccessfulRun(log.id, configId, config.source_type, result);
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
      recordsDuplicate: 0,
      recordsFailed: 0,
      status: 'failed',
      // Surface the reason to the caller (HTTP layer) so the UI can show it,
      // instead of a silent "success with 0 records".
      errorMessage: message,
    };
  }
}

/** Leads created by a specific scraper run — powers the "view leads" drilldown. */
export async function getLeadsForRun(logId: string): Promise<{
  newLeads: import('../leads/leads.types').LeadResponse[];
  duplicateLeads: import('../leads/leads.types').LeadResponse[];
}> {
  const log = await findScraperLogById(logId);
  if (!log) throw new AppError('Scraper log not found', 404);
  const { getLeadsByScraperLogId, getLeadsByIds } = await import('../leads/leads.service');
  const [newLeads, duplicateLeads] = await Promise.all([
    getLeadsByScraperLogId(logId),
    getLeadsByIds(log.duplicate_lead_ids),
  ]);
  return { newLeads, duplicateLeads };
}

/**
 * Re-attempts just the records that failed on a prior run, without
 * re-scraping the whole source. Creates a new log row (its own run history
 * entry) rather than mutating the original, so the original run's record
 * stays accurate.
 */
export async function retryFailedItems(
  logId: string,
  _actor: ScraperActor,
): Promise<ScraperRunResult> {
  const log = await findScraperLogById(logId);
  if (!log) throw new AppError('Scraper log not found', 404);
  if (!log.failed_items || log.failed_items.length === 0) {
    throw new AppError('This run has no failed items to retry', 400);
  }

  const config = await getConfigById(log.config_id);
  const retryLog = await insertScraperLog({ config_id: log.config_id, status: 'running' });

  try {
    const leadsToRetry = log.failed_items.map((item) => item.lead as unknown as ScrapedLead);
    const result = await importLeads(leadsToRetry, retryLog.id);
    return await finalizeSuccessfulRun(retryLog.id, log.config_id, config.source_type, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await updateScraperLog(retryLog.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: message,
    });
    logger.error('scraper retry-failed run failed', {
      logId,
      configId: log.config_id,
      error: message,
    });
    return {
      logId: retryLog.id,
      recordsFound: 0,
      recordsImported: 0,
      recordsDuplicate: 0,
      recordsFailed: 0,
      status: 'failed',
      errorMessage: message,
    };
  }
}

/** Aggregate found/new/duplicate/failed counts across all sources in the last N hours. */
export async function getStatsSummary(hours = 24): Promise<ScraperStatsSummary> {
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const agg = await sumScraperLogsSince(sinceIso);
  return { windowHours: hours, ...agg };
}

async function executeScraper(
  config: ScraperConfigRow,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  switch (config.source_type) {
    case 'google_places':
      return scrapeGooglePlaces(config.config, logId);
    case 'facebook':
      return scrapeFacebook(config.config, logId);
    case 'youtube':
      return scrapeYouTube(config.config, logId);
    case 'web_scrape':
      return scrapeWeb(config.config, logId);
    case 'meta_lead_forms':
      return scrapeMetaLeadForms(config.config, logId);
    case 'google_ads_lead_forms':
      return scrapeGoogleAdsLeadForms(config.config, logId);
    case 'linkedin_lead_forms':
      return scrapeLinkedInLeadForms(config.config, logId);
    case 'apify_actor':
      return scrapeApifyActor(config.config, logId);
    case 'browser_scrape':
      return scrapeBrowser(config.config, logId);
    default:
      throw new AppError(`Unknown scraper source type: ${String(config.source_type)}`, 500);
  }
}

// ── Google Places Scraper ──────────────────────────────────────────────────

/**
 * Normalizes the `query` config field into a list of non-empty search terms.
 * Accepts a single string or an array of strings so one source can fan out
 * across several terms (e.g. ["restaurants", "cafes"]) in a single run.
 */
function normalizeQueries(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((q) => (typeof q === 'string' ? q.trim() : '')).filter((q) => q.length > 0);
}

/** Matches an already-coordinate location like "13.10,77.59" (optional spaces). */
const LAT_LNG_RE = /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

/**
 * Resolves a free-text location (e.g. "Yelahanka, Bangalore") into the
 * "lat,lng" pair the Google Places Text Search API requires for location bias.
 * - If the input is already "lat,lng", it is normalized and returned as-is.
 * - Otherwise the Google Geocoding API (same apiKey) converts the place name.
 * - If the place can't be found, returns undefined so the caller runs without a
 *   location bias rather than failing the whole scrape.
 * Throws only for hard auth/quota errors so the operator gets actionable feedback.
 */
async function geocodeLocation(location: string, apiKey: string): Promise<string | undefined> {
  const trimmed = location.trim();
  if (!trimmed) return undefined;
  if (LAT_LNG_RE.test(trimmed)) return trimmed.replace(/\s+/g, '');

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    trimmed,
  )}&key=${apiKey}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    logger.warn('scraper google_places: geocoding HTTP error, running without location bias', {
      status: resp.status,
      location: trimmed,
    });
    return undefined;
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const status = String(data.status ?? '');

  if (status === 'REQUEST_DENIED') {
    throw new AppError(
      'Google Geocoding API rejected the key (REQUEST_DENIED). Enable the Geocoding API for this key in Google Cloud Console, or enter the location as coordinates "lat,lng".',
      400,
    );
  }
  if (status === 'OVER_QUERY_LIMIT') {
    throw new AppError('Google Geocoding quota exceeded (OVER_QUERY_LIMIT).', 429);
  }

  const results = (data.results as Array<Record<string, unknown>>) ?? [];
  if (status !== 'OK' || results.length === 0) {
    logger.warn('scraper google_places: location not found, running without location bias', {
      location: trimmed,
      status,
    });
    return undefined;
  }

  const geometry = results[0].geometry as Record<string, unknown> | undefined;
  const loc = geometry?.location as Record<string, number> | undefined;
  if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return `${loc.lat},${loc.lng}`;
  }
  return undefined;
}

async function scrapeGooglePlaces(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper google_places: starting API call');

  // apiKeyRef must be the NAME of an env var (e.g. "GOOGLE_PLACES_API_KEY"), not the raw key.
  const apiKey = assertEnvVarConfigured(_config.apiKeyRef, 'apiKeyRef');

  // Support one or many search terms. `query` may be a single string or an
  // array of strings; we run a Text Search per term and merge the results.
  const queries = normalizeQueries(_config.query);
  if (queries.length === 0) {
    throw new AppError('At least one search query is required for a Google Places scrape.', 400);
  }

  const rawLocation = typeof _config.location === 'string' ? _config.location : '';
  const radius = Number(_config.radius) || 5000;
  const maxResults = Number(_config.maxResults) || 20;

  // Resolve a free-text location (e.g. "Yelahanka, Bangalore") into the
  // "lat,lng" pair the Text Search API requires. Coordinates pass through as-is.
  // When the location can't be resolved we run without a location bias (and
  // without radius, which the API rejects when there is no location).
  const resolvedLocation = rawLocation ? await geocodeLocation(rawLocation, apiKey) : undefined;

  // Collect results across all queries, de-duplicating by place_id so the same
  // business found by two terms is only imported once.
  const seenPlaceIds = new Set<string>();
  const rawResults: unknown[] = [];

  for (const query of queries) {
    if (rawResults.length >= maxResults) break;

    const baseParams = new URLSearchParams({ query, key: apiKey });
    if (resolvedLocation) {
      baseParams.append('location', resolvedLocation);
      if (radius) baseParams.append('radius', String(radius));
    }

    let nextPageToken: string | null = null;

    do {
      // Page 2+ must ONLY send pagetoken + key. Mixing the original search
      // params with pagetoken triggers INVALID_REQUEST.
      const url = nextPageToken
        ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(nextPageToken)}&key=${apiKey}`
        : `https://maps.googleapis.com/maps/api/place/textsearch/json?${baseParams.toString()}`;

      // Check HTTP-level errors before parsing the response body
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
      if (apiStatus === 'ZERO_RESULTS') break; // no matches for this term — not an error

      const places = (data.results as unknown[]) ?? [];
      for (const place of places) {
        const placeId =
          place && typeof place === 'object'
            ? String((place as Record<string, unknown>).place_id ?? '')
            : '';
        // Skip duplicates across queries/pages; keep entries without an id too.
        if (placeId && seenPlaceIds.has(placeId)) continue;
        if (placeId) seenPlaceIds.add(placeId);
        rawResults.push(place);
        if (rawResults.length >= maxResults) break;
      }

      nextPageToken = typeof data.next_page_token === 'string' ? data.next_page_token : null;

      // Google requires ~2 s before next_page_token becomes usable
      if (nextPageToken && rawResults.length < maxResults) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    } while (nextPageToken && rawResults.length < maxResults);
  }

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

  const stats = await importLeads(leads, logId);
  return {
    ...stats,
    rawResponse: { total_results: rawResults.length },
  };
}

// ── Official Lead Form Sources ─────────────────────────────────────────────

async function scrapeMetaLeadForms(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper meta_lead_forms: starting Graph API lead pull');

  const integrationId = String(_config.integrationId ?? '');
  const formId = String(_config.formId ?? '');
  const sinceHours = Number(_config.sinceHours) || 24;
  const maxResults = Number(_config.maxResults) || 100;

  if (!integrationId) throw new AppError('integrationId is required for Meta Lead Forms', 400);
  if (!formId) throw new AppError('formId is required for Meta Lead Forms', 400);

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const response = await fetchFormLeads(integrationId, formId, since);
  if (!response.ok) {
    throw new AppError(`Meta Lead Forms API error: ${response.error}`, 502);
  }

  const leadRows = (response.data?.data ?? []).slice(0, maxResults);
  const leads = leadRows.map((row) =>
    leadFromFormFields(
      normalizeLeadFormFields(row.field_data),
      `Meta Lead ${row.id}`,
      'meta_lead_forms',
    ),
  );

  const stats = await importLeads(leads, logId);
  return {
    ...stats,
    rawResponse: { form_id: formId, since: since.toISOString(), fetched: leadRows.length },
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- stub implementation has no async work
async function scrapeGoogleAdsLeadForms(
  _config: Record<string, unknown>,
  _logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  const webhookSecretRef =
    typeof _config.webhookSecretRef === 'string' ? _config.webhookSecretRef : null;
  if (webhookSecretRef) assertEnvVarConfigured(webhookSecretRef, 'webhookSecretRef');
  return {
    recordsFound: 0,
    recordsImported: 0,
    recordsDuplicate: 0,
    recordsFailed: 0,
    failedItems: [],
    duplicateLeadIds: [],
    rawResponse: {
      mode: 'webhook_only',
      provider: 'google_ads',
      message: 'Google Ads lead forms are ingested by POST /webhooks/google-ads.',
    },
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- stub implementation has no async work
async function scrapeLinkedInLeadForms(
  _config: Record<string, unknown>,
  _logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  const mode = _config.mode === 'manual_import' ? 'manual_import' : 'api';
  if (mode === 'manual_import') {
    return {
      recordsFound: 0,
      recordsImported: 0,
      recordsDuplicate: 0,
      recordsFailed: 0,
      failedItems: [],
      duplicateLeadIds: [],
      rawResponse: {
        mode,
        provider: 'linkedin',
        message:
          'LinkedIn leads should be imported manually or through an approved API integration.',
      },
    };
  }

  throw new AppError(
    'LinkedIn Lead Gen Forms API is not configured yet. LinkedIn scraping and bot-block bypass are not supported.',
    400,
  );
}

// ── Apify Actor Scraper ────────────────────────────────────────────────────

/**
 * Apify dataset items have no fixed schema — it depends entirely on which
 * Actor produced them (Google Maps Scraper, Instagram Profile Scraper, etc.).
 * This pulls out common lead-shaped fields by trying several likely key names
 * per field, so the most popular Apify Store actors map cleanly without
 * requiring per-actor configuration. Fields with no match are left undefined.
 */
function getApifyField(item: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = item[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function leadFromApifyItem(item: Record<string, unknown>, sourcePlatform: string): ScrapedLead {
  const businessName =
    getApifyField(item, ['title', 'name', 'businessName', 'companyName', 'fullName', 'username']) ||
    'Unknown Business';
  const website = getApifyField(item, ['website', 'url', 'websiteUrl', 'externalUrl']) ?? null;
  const location =
    getApifyField(item, ['address', 'location', 'formattedAddress', 'city']) ?? '';
  const ratingRaw = item.totalScore ?? item.rating ?? item.averageRating;
  const reviewsRaw = item.reviewsCount ?? item.userRatingsTotal ?? item.reviewCount;

  return {
    business_name: businessName,
    contact_name: getApifyField(item, ['contactName', 'ownerName', 'fullName']),
    phone: getApifyField(item, ['phone', 'phoneNumber', 'phoneUnformatted']),
    email: getApifyField(item, ['email', 'emailAddress']),
    website,
    industry: getApifyField(item, ['category', 'categoryName', 'industry']),
    location,
    google_rating: typeof ratingRaw === 'number' ? ratingRaw : null,
    review_count: typeof reviewsRaw === 'number' ? reviewsRaw : null,
    source_platform: sourcePlatform,
  };
}

/**
 * Runs a configured Apify Actor synchronously and imports its dataset items
 * as leads. Actor selection and input shape are entirely config-driven —
 * this makes any Apify Store actor (Google Maps, Instagram, LinkedIn, TikTok…)
 * usable as a scraper source without new code, since Apify runs the actual
 * scrape on its own infrastructure under the account's ToS.
 */
async function scrapeApifyActor(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper apify_actor: starting run');

  const actorId = String(_config.actorId ?? '').trim();
  if (!actorId) throw new AppError('actorId is required for an Apify Actor source', 400);

  const input = (_config.input && typeof _config.input === 'object'
    ? (_config.input as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const maxResults = Number(_config.maxResults) || 100;

  const creds = await loadApifyCredentials();
  const result = await runActorSync(creds, actorId, input, maxResults);

  if (!result.ok) {
    throw new AppError(`Apify run failed: ${result.error}`, 502);
  }

  const leads = result.items
    .slice(0, maxResults)
    .map((item) => leadFromApifyItem(item, 'apify'));

  const stats = await importLeads(leads, logId);
  return {
    ...stats,
    rawResponse: { actor_id: actorId, items_returned: result.items.length, latency_ms: result.latencyMs },
  };
}

// ── Browser (Puppeteer) Scraper ────────────────────────────────────────────

const DEFAULT_BROWSER_TIMEOUT_MS = 30_000;

/**
 * Extracts leads using explicit CSS selectors evaluated against a repeating
 * container. Mirrors scrapeWeb's inline selector logic but is written as a
 * standalone helper so scrapeBrowser can reuse it without touching the
 * existing, already-tested scrapeWeb implementation.
 */
/**
 * Collapses leads found more than once within the same run — by email if
 * present, otherwise by phone, otherwise by business_name+location. Keeps
 * the first occurrence. Guards against a misconfigured maxPages (or
 * multiple URLs) re-scraping the same contact and inflating "found" and
 * "duplicate" counts for what is really a single lead.
 */
function dedupeScrapedLeads(leads: ScrapedLead[]): ScrapedLead[] {
  const byKey = new Map<string, ScrapedLead>();
  const order: string[] = [];
  for (const lead of leads) {
    const key = lead.email
      ? `email:${lead.email.trim().toLowerCase()}`
      : lead.phone
        ? `phone:${lead.phone.trim()}`
        : `name:${lead.business_name.trim().toLowerCase()}|${(lead.location ?? '').trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, lead);
      order.push(key);
      continue;
    }
    // Merge rather than discard: a contact's phone/email/etc. may only
    // appear on ONE of several pages that share the same contact (e.g. a
    // portfolio site with a repeated footer email but the phone number only
    // on /contact). Keeping just the first-seen page would silently drop
    // real data in favor of whichever page happened to be scraped first.
    byKey.set(key, {
      ...existing,
      phone: existing.phone || lead.phone,
      email: existing.email || lead.email,
      website: existing.website ?? lead.website,
      contact_name: existing.contact_name || lead.contact_name,
      industry: existing.industry || lead.industry,
      location: existing.location || lead.location,
      country: existing.country || lead.country,
      google_rating: existing.google_rating ?? lead.google_rating,
      review_count: existing.review_count ?? lead.review_count,
    });
  }
  return order.map((key) => byKey.get(key)!);
}

function extractLeadsBySelectors(
  html: string,
  selectors: Record<string, string>,
  containerSelector: string | undefined,
  sourcePlatform: string,
): ScrapedLead[] {
  const $ = cheerio.load(html);
  const fieldKeys = Object.keys(selectors);
  const firstSelector = Object.values(selectors)[0];
  if (!firstSelector) return [];

  const elements = $(firstSelector);
  if (elements.length === 0) return [];

  const containers = containerSelector ? $(containerSelector) : elements.parent().parent();
  const leads: ScrapedLead[] = [];

  containers.each((_i, container) => {
    const entry: Record<string, string> = {};
    for (const key of fieldKeys) {
      const sel = selectors[key];
      entry[key] = $(container).find(sel).first().text().trim();
    }
    if (entry.business_name || entry.phone) {
      leads.push({
        business_name: entry.business_name || 'Unknown Business',
        phone: entry.phone || undefined,
        email: entry.email || undefined,
        website: entry.website || undefined,
        location: entry.location || '',
        source_platform: sourcePlatform,
      });
    }
  });

  return leads;
}

/**
 * Renders a page with a real (headless) Chrome via puppeteer-core, then runs
 * the same smart/selector extraction as scrapeWeb against the RENDERED DOM.
 * This is the JavaScript-capable counterpart to scrapeWeb — it exists for
 * sites whose lead-relevant content is injected client-side after an XHR
 * call, which the plain-HTTP Cheerio scraper cannot see.
 *
 * Requires PUPPETEER_EXECUTABLE_PATH to point at a locally installed Chrome
 * binary (puppeteer-core does not bundle one). Still respects robots.txt and
 * the CAPTCHA/blocked-response guards used by scrapeWeb.
 */
async function scrapeBrowser(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper browser_scrape: starting');

  // Accepts a single URL or a list (one per line in the UI), so one source
  // can scrape many sites in a single run instead of needing one config per URL.
  const urls = normalizeQueries(_config.url);
  if (urls.length === 0) throw new AppError('At least one URL is required for browser scraping', 400);

  const mode = _config.mode === 'selectors' ? 'selectors' : 'smart';
  const selectors = _config.selectors as Record<string, string> | undefined;
  if (mode === 'selectors' && (!selectors || Object.keys(selectors).length === 0)) {
    throw new AppError('CSS selectors are required for browser scraping in selectors mode', 400);
  }

  const waitForSelector =
    typeof _config.waitForSelector === 'string' ? _config.waitForSelector : undefined;
  const waitMs = Number(_config.waitMs) || 0;
  const maxPages = Number(_config.maxPages) || 1;
  const userAgent =
    typeof _config.userAgent === 'string' && _config.userAgent.trim()
      ? _config.userAgent.trim()
      : DEFAULT_CRAWLER_USER_AGENT;
  const respectRobotsTxt = _config.respectRobotsTxt !== false;

  const executablePath = assertEnvVarConfigured(
    'PUPPETEER_EXECUTABLE_PATH',
    'PUPPETEER_EXECUTABLE_PATH',
  );

  const puppeteer = await import('puppeteer-core');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      // Required in most containerized/CI environments where the kernel
      // sandbox namespace isn't available to an unprivileged process.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    throw new AppError(
      `Could not launch Chrome at PUPPETEER_EXECUTABLE_PATH="${executablePath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      500,
    );
  }

  const allLeads: ScrapedLead[] = [];
  let pagesFetched = 0;
  let urlsScraped = 0;

  try {
    const page = await browser.newPage();
    await page.setUserAgent({ userAgent });

    const crawl = deepCrawlSettings(_config);
    if (crawl.followLinks) {
      // Deep crawl: BFS over same-origin links extracted from the RENDERED
      // DOM (so SPA navs work). maxPages is the total page budget for the
      // run, and a single failing page skips forward instead of aborting.
      const { queue, seen } = seedCrawlQueue(urls);
      const robotsCache = new Map<string, string | null>();
      let pagesFailed = 0;
      let firstError: unknown = null;

      while (queue.length > 0 && pagesFetched < maxPages) {
        const { url: pageUrl, depth } = queue.shift()!;
        try {
          if (respectRobotsTxt) await assertRobotsAllowed(pageUrl, userAgent, robotsCache);
          const response = await page.goto(pageUrl, {
            waitUntil: 'networkidle2',
            timeout: DEFAULT_BROWSER_TIMEOUT_MS,
          });
          const status = response?.status() ?? 0;
          if (status && status >= 400) {
            throw new AppError(`Page navigation failed for ${pageUrl} (HTTP ${status})`, status);
          }

          if (waitForSelector) {
            try {
              await page.waitForSelector(waitForSelector, { timeout: DEFAULT_BROWSER_TIMEOUT_MS });
            } catch {
              logger.warn('scraper browser_scrape: waitForSelector timed out, reading DOM anyway', {
                waitForSelector,
                url: pageUrl,
              });
            }
          }
          if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

          const html = await page.content();
          assertNoCaptcha(html, pageUrl);
          pagesFetched++;

          if (mode === 'smart') {
            allLeads.push(...smartExtract(html, pageUrl, 'browser_scrape'));
          } else {
            allLeads.push(
              ...extractLeadsBySelectors(
                html,
                selectors!,
                _config.containerSelector as string | undefined,
                'browser_scrape',
              ),
            );
          }

          enqueueDiscoveredLinks(html, pageUrl, depth, crawl, queue, seen);
        } catch (err) {
          pagesFailed++;
          if (!firstError) firstError = err;
          logger.warn('scraper browser_scrape: deep-crawl page failed, continuing', {
            url: pageUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (pagesFetched === 0 && firstError) throw firstError;

      const stats = await importLeads(dedupeScrapedLeads(allLeads), logId);
      return {
        ...stats,
        rawResponse: {
          urls,
          follow_links: true,
          max_depth: crawl.maxDepth,
          pages_scraped: pagesFetched,
          pages_failed: pagesFailed,
          urls_discovered: seen.size,
          robots_checked: respectRobotsTxt,
          rendered: true,
        },
      };
    }

    for (const url of urls) {
      if (respectRobotsTxt) await assertRobotsAllowed(url, userAgent);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const pageUrl = pageNum === 1 ? url : `${url}?page=${pageNum}`;
        const response = await page.goto(pageUrl, {
          waitUntil: 'networkidle2',
          timeout: DEFAULT_BROWSER_TIMEOUT_MS,
        });

        const status = response?.status() ?? 0;
        if ([401, 403, 429].includes(status)) {
          throw new AppError(`Target blocked the crawler for ${pageUrl} (HTTP ${status})`, status);
        }
        if (status && status >= 400) {
          logger.warn('scraper browser_scrape: page navigation failed', {
            page: pageNum,
            status,
            url: pageUrl,
          });
          break;
        }

        if (waitForSelector) {
          try {
            await page.waitForSelector(waitForSelector, { timeout: DEFAULT_BROWSER_TIMEOUT_MS });
          } catch {
            logger.warn('scraper browser_scrape: waitForSelector timed out, reading DOM anyway', {
              waitForSelector,
              url: pageUrl,
            });
          }
        }
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

        const html = await page.content();
        assertNoCaptcha(html, pageUrl);
        pagesFetched++;

        if (mode === 'smart') {
          allLeads.push(...smartExtract(html, pageUrl, 'browser_scrape'));
        } else {
          allLeads.push(
            ...extractLeadsBySelectors(
              html,
              selectors!,
              _config.containerSelector as string | undefined,
              'browser_scrape',
            ),
          );
        }
      }
      urlsScraped++;
    }
  } finally {
    await browser.close();
  }

  // Safety net: a misconfigured maxPages against a site with no real
  // pagination (or the same contact appearing on multiple scraped URLs)
  // would otherwise re-attempt the same lead N times in one run, inflating
  // "found" and "duplicate" counts for what is really a single contact.
  const dedupedLeads = dedupeScrapedLeads(allLeads);

  const stats = await importLeads(dedupedLeads, logId);
  return {
    ...stats,
    rawResponse: {
      urls,
      urls_scraped: urlsScraped,
      pages_scraped: pagesFetched,
      robots_checked: respectRobotsTxt,
      rendered: true,
    },
  };
}

// ── Facebook Scraper ───────────────────────────────────────────────────────

async function scrapeFacebook(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
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

  const stats = await importLeads(leads, logId);
  return {
    ...stats,
    rawResponse: { page_name: pageData.name, posts_count: posts.length },
  };
}

// ── YouTube Scraper ────────────────────────────────────────────────────────

async function scrapeYouTube(
  _config: Record<string, unknown>,
  _logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
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

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DEFAULT_CRAWLER_USER_AGENT = 'CRMLeadCrawler/1.0 (+https://crm.local/scraper; compliant)';
const CAPTCHA_RE = /(captcha|recaptcha|hcaptcha|cf-challenge|access denied|verify you are human)/i;
const ASSET_EMAIL_RE = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i;

/**
 * Selector-free extraction. Scans the fetched HTML for emails (from text +
 * mailto: links) and phone numbers (from tel: links, falling back to text),
 * and uses the page title / og:site_name as the business name. Produces one
 * lead per discovered email (a contact page often lists several), or a single
 * phone-only lead when no email is present. Returns [] when nothing is found.
 *
 * Note: operates on the fetched HTML only — it does not run JavaScript, so
 * JS-rendered pages will yield little. That limitation is shared by the
 * selector path and is surfaced to the user in the UI.
 */
function smartExtract(html: string, pageUrl: string, sourcePlatform: string): ScrapedLead[] {
  const $ = cheerio.load(html);

  const title = (
    $('meta[property="og:site_name"]').attr('content') ||
    $('title').first().text() ||
    ''
  ).trim();

  let origin = '';
  let hostname = '';
  try {
    const u = new URL(pageUrl);
    origin = u.origin;
    hostname = u.hostname.replace(/^www\./, '');
  } catch {
    // pageUrl may be malformed in tests; fall back to empty.
  }
  const businessName = title || hostname || 'Unknown Business';

  const emails = new Set<string>();
  $('a[href^="mailto:"]').each((_i, el) => {
    const addr = ($(el).attr('href') || '')
      .replace(/^mailto:/i, '')
      .split('?')[0]
      .trim()
      .toLowerCase();
    if (addr && !ASSET_EMAIL_RE.test(addr)) emails.add(addr);
  });
  // Strip code that often contains junk before scanning visible text.
  $('script, style, noscript, svg').remove();
  const bodyHtml = $('body').html() ?? html;
  for (const m of bodyHtml.matchAll(EMAIL_RE)) {
    const addr = m[0].toLowerCase();
    if (!ASSET_EMAIL_RE.test(addr) && !addr.includes('@sentry') && !addr.endsWith('example.com')) {
      emails.add(addr);
    }
  }

  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_i, el) => {
    const p = normalizePhone(($(el).attr('href') || '').replace(/^tel:/i, ''));
    if (p) phones.add(p);
  });
  // Only mine free text for phones when no tel: links exist (text matching is
  // noisy and produces false positives like dates / ids).
  if (phones.size === 0) {
    const text = $('body').text();
    for (const m of text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
      const p = normalizePhone(m[0]);
      if (p) phones.add(p);
    }
  }

  const emailList = [...emails];
  const phoneList = [...phones];
  const leads: ScrapedLead[] = [];

  if (emailList.length > 0) {
    for (const email of emailList) {
      leads.push({
        business_name: businessName,
        email,
        phone: phoneList[0],
        website: origin || undefined,
        location: '',
        source_platform: sourcePlatform,
      });
    }
  } else if (phoneList.length > 0) {
    leads.push({
      business_name: businessName,
      phone: phoneList[0],
      website: origin || undefined,
      location: '',
      source_platform: sourcePlatform,
    });
  }

  return leads;
}

const SELECTOR_DETECT_MAX_TOKENS = 600;
const SELECTOR_DETECT_SYSTEM_PROMPT = [
  'You are a web-scraping assistant. Given the HTML of a page that lists businesses or contacts,',
  'return CSS selectors that extract lead fields. Respond with ONLY a JSON object of the shape:',
  '{ "containerSelector": string, "selectors": { "business_name"?: string, "phone"?: string, "email"?: string, "website"?: string, "location"?: string } }.',
  'containerSelector must match the repeating element wrapping ONE record (e.g. ".listing-card").',
  'Each value in selectors is a CSS selector evaluated WITHIN a container. Omit fields not present.',
  'Prefer stable class/attribute selectors. Do not invent selectors that are not in the HTML.',
].join(' ');

const detectSelectorsResponseSchema = z.object({
  containerSelector: z.string().default(''),
  selectors: z.record(z.string(), z.string()).default({}),
});

/**
 * AI-assisted selector detection (Option B). Fetches the page, sends a trimmed
 * copy of the HTML to the configured LLM (MiMo / OpenAI / any OpenAI-compatible
 * provider), and returns suggested container + field selectors for the user to
 * review. Requires the AI engine to be enabled in AI Settings.
 */
export async function detectSelectors(
  url: string,
): Promise<{ containerSelector: string; selectors: Record<string, string> }> {
  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    throw new AppError(
      'AI engine is not configured. Enable it and set an API key in AI Settings to use auto-detect.',
      400,
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(`Could not fetch the page for analysis (HTTP ${response.status}).`, 400);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  // Cap the HTML sent to the model to keep token usage and latency bounded.
  const trimmedHtml = ($('body').html() ?? html).slice(0, 12000);

  const client = new OpenAI({
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const startedAt = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: SELECTOR_DETECT_MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: SELECTOR_DETECT_SYSTEM_PROMPT },
        { role: 'user', content: `URL: ${url}\nHTML:\n${trimmedHtml}` },
      ],
    });
  } catch (err) {
    logger.error('scraper detectSelectors: OpenAI call failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      'AI auto-detect failed. Check the AI Settings credentials and try again.',
      502,
    );
  }

  logger.info('scraper detectSelectors: completed', {
    url,
    model: aiConfig.model,
    tokens_used: completion.usage?.total_tokens ?? null,
    latency_ms: Date.now() - startedAt,
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  // Strip code fences / prose and isolate the JSON object before parsing.
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new AppError(
      'AI returned an unexpected response. Please try again or use Custom selectors.',
      502,
    );
  }

  let parsed: { containerSelector: string; selectors: Record<string, string> };
  try {
    parsed = detectSelectorsResponseSchema.parse(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)));
  } catch (err) {
    logger.warn('scraper detectSelectors: malformed AI JSON', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      'AI returned malformed selectors. Please try again or use Custom selectors.',
      502,
    );
  }

  return parsed;
}

const MAX_DISCOVERED_PAGES = 40;

/** Strips hash fragments and a trailing slash so equivalent links dedupe cleanly. */
function normalizeDiscoveredUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    let normalized = u.toString();
    if (normalized.endsWith('/') && normalized !== `${u.origin}/`) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Renders a page with headless Chrome and extracts same-origin nav links,
 * so a user can see what pages exist on a site before choosing which ones
 * to add to a multi-URL scraper source. Uses a real browser (not a plain
 * fetch) because client-side-routed SPAs have no links in their raw HTML —
 * the nav only exists after the page hydrates.
 */
export async function discoverPages(
  url: string,
): Promise<import('./scraper.types').DiscoveredPage[]> {
  const userAgent = DEFAULT_CRAWLER_USER_AGENT;
  await assertRobotsAllowed(url, userAgent);

  const executablePath = assertEnvVarConfigured(
    'PUPPETEER_EXECUTABLE_PATH',
    'PUPPETEER_EXECUTABLE_PATH',
  );

  const puppeteer = await import('puppeteer-core');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    throw new AppError(
      `Could not launch Chrome at PUPPETEER_EXECUTABLE_PATH="${executablePath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      500,
    );
  }

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    await browser.close();
    throw new AppError('Invalid URL', 400);
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent({ userAgent });
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: DEFAULT_BROWSER_TIMEOUT_MS,
    });

    const status = response?.status() ?? 0;
    if ([401, 403, 429].includes(status)) {
      throw new AppError(`Target blocked the crawler for ${url} (HTTP ${status})`, status);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runs in
    // the page's browser context, which has no DOM lib types in this (Node) tsconfig.
    const rawLinks = await page.$$eval('a[href]', (els: any[]) =>
      els.map((el) => ({
        href: el.href as string,
        text: ((el.textContent as string) ?? '').trim(),
      })),
    );

    const seen = new Set<string>();
    const pages: import('./scraper.types').DiscoveredPage[] = [];

    const rootNormalized = normalizeDiscoveredUrl(url);
    if (rootNormalized) {
      seen.add(rootNormalized);
      pages.push({ url: rootNormalized, label: 'Home' });
    }

    for (const { href, text } of rawLinks) {
      const normalized = normalizeDiscoveredUrl(href);
      if (!normalized || !normalized.startsWith(origin) || seen.has(normalized)) continue;
      seen.add(normalized);
      const path = normalized.slice(origin.length) || '/';
      pages.push({ url: normalized, label: text || path });
      if (pages.length >= MAX_DISCOVERED_PAGES) break;
    }

    return pages;
  } finally {
    await browser.close();
  }
}

function pathMatchesRobotsRule(pathname: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === '/') return true;
  return pathname.startsWith(rule);
}

/**
 * @param robotsCache Optional per-run cache of robots.txt text keyed by
 *   origin (null = unavailable/allow-all), so a deep crawl doesn't re-fetch
 *   robots.txt for every page on the same site.
 */
async function assertRobotsAllowed(
  pageUrl: string,
  userAgent: string,
  robotsCache?: Map<string, string | null>,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new AppError('URL is required for web scraping', 400);
  }

  let text: string | null;
  if (robotsCache?.has(parsed.origin)) {
    text = robotsCache.get(parsed.origin)!;
  } else {
    const robotsUrl = `${parsed.origin}/robots.txt`;
    try {
      const response = await fetch(robotsUrl, { headers: { 'User-Agent': userAgent } });
      text = response.ok ? await response.text() : null;
    } catch (err) {
      logger.warn('scraper web_scrape: robots.txt fetch failed, allowing crawl', {
        robotsUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      text = null;
    }
    robotsCache?.set(parsed.origin, text);
  }
  if (text === null) return;
  const lines = text.split(/\r?\n/).map((line) => line.split('#')[0]?.trim() ?? '');
  let applies = false;
  const disallowed: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rawValue] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(':').trim();
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      applies = agent === '*' || userAgent.toLowerCase().includes(agent);
      continue;
    }
    if (applies && key === 'disallow' && value) disallowed.push(value);
  }

  const blockedBy = disallowed.find((rule) => pathMatchesRobotsRule(parsed.pathname || '/', rule));
  if (blockedBy) {
    throw new AppError(
      `Robots.txt disallows crawling ${parsed.pathname || '/'} (rule: ${blockedBy})`,
      403,
    );
  }
}

function assertNotBlockedResponse(response: Response, pageUrl: string): void {
  if ([401, 403, 429].includes(response.status)) {
    throw new AppError(
      `Target blocked the crawler for ${pageUrl} (HTTP ${response.status})`,
      response.status,
    );
  }
}

function assertNoCaptcha(html: string, pageUrl: string): void {
  if (CAPTCHA_RE.test(html)) {
    throw new AppError(`Target returned a CAPTCHA or bot-check page for ${pageUrl}`, 403);
  }
}

// ── Deep Crawl (follow same-site links) ────────────────────────────────────

interface DeepCrawlSettings {
  followLinks: boolean;
  maxDepth: number;
  includePatterns: string[];
  excludePatterns: string[];
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function deepCrawlSettings(config: Record<string, unknown>): DeepCrawlSettings {
  return {
    followLinks: config.followLinks === true,
    maxDepth: Math.min(Math.max(Number(config.maxDepth) || 2, 1), 5),
    includePatterns: toStringArray(config.includePatterns),
    excludePatterns: toStringArray(config.excludePatterns),
  };
}

/** Substring filters applied to discovered links (never to the listed seed URLs). */
function urlPassesPatterns(url: string, settings: DeepCrawlSettings): boolean {
  if (settings.excludePatterns.some((p) => url.includes(p))) return false;
  if (settings.includePatterns.length > 0 && !settings.includePatterns.some((p) => url.includes(p))) {
    return false;
  }
  return true;
}

/**
 * Same-origin links from a page's HTML, resolved against the page URL and
 * normalized so equivalent links dedupe cleanly. Non-HTML asset links are
 * skipped by extension since a deep crawl only wants navigable pages.
 */
const NON_HTML_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|webm|woff2?|ttf|eot)$/i;

function extractSameOriginLinks(html: string, pageUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    const normalized = normalizeDiscoveredUrl(absolute);
    if (!normalized || !normalized.startsWith(origin) || seen.has(normalized)) return;
    if (NON_HTML_EXT_RE.test(new URL(normalized).pathname)) return;
    seen.add(normalized);
    links.push(normalized);
  });
  return links;
}

/** One page visited (or attempted) during a deep crawl. */
interface CrawlQueueItem {
  url: string;
  depth: number;
}

/** Seeds the BFS queue with the configured URLs at depth 0. */
function seedCrawlQueue(urls: string[]): { queue: CrawlQueueItem[]; seen: Set<string> } {
  const queue: CrawlQueueItem[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const normalized = normalizeDiscoveredUrl(url) ?? url;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    queue.push({ url: normalized, depth: 0 });
  }
  return { queue, seen };
}

/** Enqueues a page's unseen same-origin links for the next crawl depth. */
function enqueueDiscoveredLinks(
  html: string,
  pageUrl: string,
  depth: number,
  settings: DeepCrawlSettings,
  queue: CrawlQueueItem[],
  seen: Set<string>,
): void {
  if (depth >= settings.maxDepth) return;
  for (const link of extractSameOriginLinks(html, pageUrl)) {
    if (seen.has(link) || !urlPassesPatterns(link, settings)) continue;
    seen.add(link);
    queue.push({ url: link, depth: depth + 1 });
  }
}

async function scrapeWeb(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper web_scrape: starting');

  // Accepts a single URL or a list (one per line in the UI), so one source
  // can scrape many sites in a single run instead of needing one config per URL.
  const urls = normalizeQueries(_config.url);
  const selectors = _config.selectors as Record<string, string> | undefined;
  const maxPages = Number(_config.maxPages) || 1;
  const userAgent =
    typeof _config.userAgent === 'string' && _config.userAgent.trim()
      ? _config.userAgent.trim()
      : DEFAULT_CRAWLER_USER_AGENT;
  const respectRobotsTxt = _config.respectRobotsTxt !== false;
  const crawlDelayMs = Number(_config.crawlDelayMs) || 3000;
  // 'smart' mode is opt-in: a config without an explicit mode keeps the
  // original selector-required behaviour (backward compatible).
  const mode = _config.mode === 'smart' ? 'smart' : 'selectors';

  if (urls.length === 0) throw new AppError('At least one URL is required for web scraping', 400);
  if (mode === 'selectors' && (!selectors || Object.keys(selectors).length === 0)) {
    throw new AppError('CSS selectors are required for web scraping', 400);
  }

  const allLeads: ScrapedLead[] = [];
  let pagesFetched = 0;
  let urlsScraped = 0;
  const fetchOpts: RequestInit = { headers: { 'User-Agent': userAgent } };

  const crawl = deepCrawlSettings(_config);
  if (crawl.followLinks) {
    // Deep crawl: BFS over same-origin links from the seed URLs. maxPages is
    // the TOTAL page budget here (not pages-per-URL pagination), and a single
    // failing page skips forward instead of aborting the whole run.
    const { queue, seen } = seedCrawlQueue(urls);
    const robotsCache = new Map<string, string | null>();
    let pagesFailed = 0;
    let firstError: unknown = null;

    while (queue.length > 0 && pagesFetched < maxPages) {
      const { url: pageUrl, depth } = queue.shift()!;
      try {
        if (respectRobotsTxt) await assertRobotsAllowed(pageUrl, userAgent, robotsCache);
        const response = await fetch(pageUrl, fetchOpts);
        assertNotBlockedResponse(response, pageUrl);
        if (!response.ok) {
          throw new AppError(`Page fetch failed for ${pageUrl} (HTTP ${response.status})`, 502);
        }
        const html = await response.text();
        assertNoCaptcha(html, pageUrl);
        pagesFetched++;

        if (mode === 'smart') {
          allLeads.push(...smartExtract(html, pageUrl, 'web_scrape'));
        } else {
          allLeads.push(
            ...extractLeadsBySelectors(
              html,
              selectors!,
              _config.containerSelector as string | undefined,
              'web_scrape',
            ),
          );
        }

        enqueueDiscoveredLinks(html, pageUrl, depth, crawl, queue, seen);
      } catch (err) {
        pagesFailed++;
        if (!firstError) firstError = err;
        logger.warn('scraper web_scrape: deep-crawl page failed, continuing', {
          url: pageUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (queue.length > 0 && pagesFetched < maxPages) {
        await new Promise((r) => setTimeout(r, crawlDelayMs));
      }
    }

    // Nothing was crawlable at all — surface the real cause instead of a
    // silent empty run (e.g. robots disallow or the seed site being down).
    if (pagesFetched === 0 && firstError) throw firstError;

    const stats = await importLeads(dedupeScrapedLeads(allLeads), logId);
    return {
      ...stats,
      rawResponse: {
        urls,
        follow_links: true,
        max_depth: crawl.maxDepth,
        pages_scraped: pagesFetched,
        pages_failed: pagesFailed,
        urls_discovered: seen.size,
        robots_checked: respectRobotsTxt,
      },
    };
  }

  for (const url of urls) {
    if (respectRobotsTxt) await assertRobotsAllowed(url, userAgent);

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? url : `${url}?page=${page}`;
      const response = await fetch(pageUrl, fetchOpts);
      // Fix: check HTTP status
      if (!response.ok) {
        assertNotBlockedResponse(response, pageUrl);
        logger.warn('scraper web_scrape: page fetch failed', {
          page,
          status: response.status,
          url: pageUrl,
        });
        break;
      }
      assertNotBlockedResponse(response, pageUrl);
      const html = await response.text();
      assertNoCaptcha(html, pageUrl);
      pagesFetched++;
      const $ = cheerio.load(html);

      if (mode === 'smart') {
        // Selector-free extraction: pull emails/phones from the page and use the
        // page title as the business name. Best for single contact/about pages.
        allLeads.push(...smartExtract(html, pageUrl, 'web_scrape'));
      } else {
        const firstSelector = Object.values(selectors!)[0];
        if (!firstSelector) continue;

        const items: Record<string, string>[] = [];
        const elements = $(firstSelector);

        if (elements.length > 0) {
          const fieldKeys = Object.keys(selectors!);
          const containerSelector = _config.containerSelector as string | undefined;
          const containers = containerSelector ? $(containerSelector) : elements.parent().parent();

          containers.each((_i, container) => {
            const entry: Record<string, string> = {};
            for (const key of fieldKeys) {
              const sel = selectors![key];
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
      }

      if (page < maxPages && _config.paginationSelector) {
        const pagEl = $(_config.paginationSelector as string);
        if (pagEl.length === 0) break;
      }

      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, crawlDelayMs));
      }
    }
    urlsScraped++;
  }

  // Safety net: a misconfigured maxPages against a site with no real
  // pagination (or the same contact appearing on multiple scraped URLs)
  // would otherwise re-attempt the same lead N times in one run, inflating
  // "found" and "duplicate" counts for what is really a single contact.
  const dedupedLeads = dedupeScrapedLeads(allLeads);

  const stats = await importLeads(dedupedLeads, logId);
  return {
    ...stats,
    rawResponse: {
      urls,
      urls_scraped: urlsScraped,
      pages_scraped: pagesFetched,
      robots_checked: respectRobotsTxt,
    },
  };
}

// ── Lead Import Helper ─────────────────────────────────────────────────────

async function importLeads(
  leads: ScrapedLead[],
  logId?: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
  failedItems: FailedScrapeItem[];
  duplicateLeadIds: string[];
}> {
  // Hoist dynamic import outside the loop — module is cached after the first call
  const { createLead } = await import('../leads/leads.service');

  let imported = 0;
  let duplicate = 0;
  let failed = 0;
  const failedItems: FailedScrapeItem[] = [];
  const duplicateLeadIds: string[] = [];

  for (const lead of leads) {
    // Include the real email in the seed so multiple distinct leads found on
    // the same page (e.g. several staff emails on one contact page) don't
    // collide on an identical placeholder phone — business_name/location are
    // often identical across them, which previously caused every lead after
    // the first to look like a duplicate and get silently skipped.
    const phoneSeed = `${lead.phone ?? ''}|${lead.business_name}|${lead.location ?? ''}|${lead.email ?? ''}`;
    const phone = lead.phone || generatePlaceholderPhone(phoneSeed);
    const email =
      lead.email ||
      generatePlaceholderEmail(lead.business_name, lead.location, lead.source_platform);

    const { normalizePhone } = await import('../../shared/utils/phone');
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const actor: {
        id: string;
        role: import('../../shared/types').UserRole;
        ipAddress?: string | null;
      } = { id: '00000000-0000-0000-0000-000000000000', role: 'admin' };

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
          scraper_log_id: logId ?? null,
        },
        actor,
      );
      imported++;
    } catch (err) {
      // 409 means the lead already exists — count as a duplicate (matched by
      // email/phone), not a new import. Idempotent re-runs still succeed —
      // this is not a failure — but it's also not a *new* lead.
      if (err instanceof AppError && err.statusCode === 409) {
        if (logId) {
          try {
            const { findExistingForDedup, updateLead } = await import('../leads/leads.repository');
            const existing = await findExistingForDedup(
              normalizedEmail,
              normalizedPhone,
              lead.source_platform,
            );
            if (existing) {
              duplicateLeadIds.push(existing.id);
              // Only ensure the source_platform tag is present — do not add log IDs
              if (!existing.tags?.includes(lead.source_platform)) {
                const updatedTags = Array.from(
                  new Set([...(existing.tags || []), lead.source_platform]),
                );
                await updateLead(existing.id, { tags: updatedTags });
              }
            }
          } catch (updateErr) {
            logger.warn('scraper failed to update existing lead tags', {
              business_name: lead.business_name,
              error: updateErr instanceof Error ? updateErr.message : String(updateErr),
            });
          }
        }
        duplicate++;
      } else {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('scraper failed to import lead', {
          business_name: lead.business_name,
          error: message,
        });
        failedItems.push({ lead: lead as unknown as Record<string, unknown>, error: message });
      }
    }
  }

  return {
    recordsFound: leads.length,
    recordsImported: imported,
    recordsDuplicate: duplicate,
    recordsFailed: failed,
    failedItems,
    duplicateLeadIds,
  };
}
