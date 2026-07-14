import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { z } from 'zod';
import { fetchFormLeads } from '../integrations/facebook/facebook.connector';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { normalizePhone } from '../../shared/utils/phone';
import { getAiConfig } from '../ai-settings/ai-settings.service';
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

export async function runScrape(configId: string, _actor: ScraperActor): Promise<ScraperRunResult> {
  const config = await getConfigById(configId);
  if (!config.is_active) {
    throw new AppError('Scraper config is not active', 400);
  }

  const log = await insertScraperLog({ config_id: configId, status: 'running' });

  try {
    const result = await executeScraper(config, log.id);
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
      errorMessage: null,
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
      // Surface the reason to the caller (HTTP layer) so the UI can show it,
      // instead of a silent "success with 0 records".
      errorMessage: message,
    };
  }
}

async function executeScraper(
  config: ScraperConfigRow,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
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
  recordsFailed: number;
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
  recordsFailed: number;
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
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  const webhookSecretRef =
    typeof _config.webhookSecretRef === 'string' ? _config.webhookSecretRef : null;
  if (webhookSecretRef) assertEnvVarConfigured(webhookSecretRef, 'webhookSecretRef');
  return {
    recordsFound: 0,
    recordsImported: 0,
    recordsFailed: 0,
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
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  const mode = _config.mode === 'manual_import' ? 'manual_import' : 'api';
  if (mode === 'manual_import') {
    return {
      recordsFound: 0,
      recordsImported: 0,
      recordsFailed: 0,
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

// ── Facebook Scraper ───────────────────────────────────────────────────────

async function scrapeFacebook(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
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
function smartExtract(html: string, pageUrl: string): ScrapedLead[] {
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
        source_platform: 'web_scrape',
      });
    }
  } else if (phoneList.length > 0) {
    leads.push({
      business_name: businessName,
      phone: phoneList[0],
      website: origin || undefined,
      location: '',
      source_platform: 'web_scrape',
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

function pathMatchesRobotsRule(pathname: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === '/') return true;
  return pathname.startsWith(rule);
}

async function assertRobotsAllowed(pageUrl: string, userAgent: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new AppError('URL is required for web scraping', 400);
  }

  const robotsUrl = `${parsed.origin}/robots.txt`;
  let response: Response;
  try {
    response = await fetch(robotsUrl, { headers: { 'User-Agent': userAgent } });
  } catch (err) {
    logger.warn('scraper web_scrape: robots.txt fetch failed, allowing crawl', {
      robotsUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!response.ok) return;

  const text = await response.text();
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

async function scrapeWeb(
  _config: Record<string, unknown>,
  logId: string,
): Promise<{
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  rawResponse?: Record<string, unknown>;
}> {
  logger.info('scraper web_scrape: starting');

  const url = String(_config.url ?? '');
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

  if (!url) throw new AppError('URL is required for web scraping', 400);
  if (mode === 'selectors' && (!selectors || Object.keys(selectors).length === 0)) {
    throw new AppError('CSS selectors are required for web scraping', 400);
  }

  if (respectRobotsTxt) await assertRobotsAllowed(url, userAgent);

  const allLeads: ScrapedLead[] = [];
  let pagesFetched = 0;
  const fetchOpts: RequestInit = { headers: { 'User-Agent': userAgent } };

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
      allLeads.push(...smartExtract(html, pageUrl));
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

  const stats = await importLeads(allLeads, logId);
  return {
    ...stats,
    rawResponse: {
      url,
      pages_scraped: pagesFetched,
      robots_checked: respectRobotsTxt,
    },
  };
}

// ── Lead Import Helper ─────────────────────────────────────────────────────

async function importLeads(
  leads: ScrapedLead[],
  logId?: string,
): Promise<{ recordsFound: number; recordsImported: number; recordsFailed: number }> {
  // Hoist dynamic import outside the loop — module is cached after the first call
  const { createLead } = await import('../leads/leads.service');

  let imported = 0;
  let failed = 0;

  for (const lead of leads) {
    const phoneSeed = `${lead.phone ?? ''}|${lead.business_name}|${lead.location ?? ''}`;
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
        },
        actor,
      );
      imported++;
    } catch (err) {
      // 409 means the lead already exists — count as imported (idempotent re-run)
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
