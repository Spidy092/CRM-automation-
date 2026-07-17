/**
 * Apify connector.
 *
 * Apify is a managed web-scraping / automation platform. "Actors" are hosted,
 * ready-made scrapers (Google Maps, Instagram, LinkedIn, TikTok, …). We call
 * Apify's documented REST API to run an Actor and read back its dataset — the
 * scraping runs on Apify's infrastructure, not ours.
 *
 * Auth: API token — sent as `Authorization: Bearer <token>`.
 * Credentials shape: { apiToken: string }
 *
 * Vendor docs: https://docs.apify.com/api/v2
 * Base URL: https://api.apify.com/v2
 *
 * Key endpoints used:
 *   • GET  /users/me                                   — verify token
 *   • GET  /actors?my=1                                — list the user's Actors
 *   • POST /acts/:actorId/run-sync-get-dataset-items   — run an Actor and get its
 *                                                        dataset items in one call
 *
 * NOTE: run-sync-get-dataset-items blocks until the run finishes and Apify caps
 * it at 300s, so callers must use a long timeout (see APIFY_RUN_TIMEOUT_MS).
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';
import { logger } from '../../../shared/utils/logger';

export const APIFY_PROVIDER_NAME = 'apify';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

/** Apify hard-caps a synchronous run at 300s; allow a little client headroom. */
export const APIFY_RUN_TIMEOUT_MS = 305_000;

export const apifyCredentialsSchema = z
  .object({
    apiToken: z.string().min(1, 'API token is required'),
  })
  .strict();

export type ApifyCredentials = z.infer<typeof apifyCredentialsSchema>;

function authHeader(token: string): string {
  return `Bearer ${token}`;
}

export async function loadCredentials(): Promise<ApifyCredentials> {
  const row = await findByName(APIFY_PROVIDER_NAME);
  if (!row) throw new AppError('Apify integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Apify credentials not set', 422);
  const raw = JSON.parse(decrypt(enc)) as unknown;
  const result = apifyCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      `Apify credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

/**
 * Verifies the token against GET /users/me — a zero-side-effect endpoint that
 * returns the account profile. Returns the username on success for the UI.
 */
export async function testConnection(
  creds: ApifyCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number; username?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${APIFY_BASE_URL}/users/me`, {
      headers: { Authorization: authHeader(creds.apiToken) },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const body = (await res.json()) as { data?: { username?: string } };
      return { ok: true, latencyMs, username: body.data?.username };
    }
    let msg = `HTTP ${res.status}`;
    if (res.status === 401) msg = 'Apify rejected the API token (401 Unauthorized).';
    return { ok: false, error: msg, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      latencyMs: Date.now() - start,
    };
  }
}

export interface ApifyActorSummary {
  id: string;
  name: string;
  username: string;
  title?: string;
  /** Tilde-separated `username~name` — the form the run endpoint accepts. */
  fullName: string;
}

/**
 * Lists the Actors the account can run (owned + previously used).
 * Best-effort helper for the source-builder UI — returns [] on any failure so
 * the modal can still fall back to a free-text actor id.
 */
export async function listActors(creds: ApifyCredentials, limit = 100): Promise<ApifyActorSummary[]> {
  try {
    const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 1000)) });
    const res = await fetch(`${APIFY_BASE_URL}/actors?${params.toString()}`, {
      headers: { Authorization: authHeader(creds.apiToken) },
    });
    if (!res.ok) {
      logger.warn('apify: listActors failed', { status: res.status });
      return [];
    }
    const body = (await res.json()) as {
      data?: { items?: Array<{ id: string; name: string; username: string; title?: string }> };
    };
    const items = body.data?.items ?? [];
    return items.map((a) => ({
      id: a.id,
      name: a.name,
      username: a.username,
      title: a.title,
      fullName: `${a.username}~${a.name}`,
    }));
  } catch (err) {
    logger.warn('apify: listActors error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export interface RunActorResult {
  ok: boolean;
  items: Array<Record<string, unknown>>;
  error?: string;
  latencyMs: number;
}

/**
 * Runs an Actor synchronously and returns its dataset items.
 *
 * @param actorId  Actor id or tilde-separated `username~name` (e.g. `apify~google-maps-scraper`).
 * @param input    JSON passed as the Actor's INPUT — shape is actor-specific.
 * @param maxItems Optional cap applied via the `limit` query param on the dataset read.
 *
 * Never throws — returns { ok:false, error } so callers (the scraper) decide
 * how to record the failure.
 */
export async function runActorSync(
  creds: ApifyCredentials,
  actorId: string,
  input: Record<string, unknown>,
  maxItems?: number,
): Promise<RunActorResult> {
  const start = Date.now();
  const trimmed = actorId.trim();
  if (!trimmed) {
    return { ok: false, items: [], error: 'Actor id is required', latencyMs: 0 };
  }

  // Apify accepts either `~` or the URL-encoded `/` between owner and name.
  const pathId = encodeURIComponent(trimmed.replace('/', '~'));
  const params = new URLSearchParams({ format: 'json', clean: 'true' });
  if (maxItems && maxItems > 0) params.set('limit', String(maxItems));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_RUN_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${APIFY_BASE_URL}/acts/${pathId}/run-sync-get-dataset-items?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader(creds.apiToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input ?? {}),
        signal: controller.signal,
      },
    );

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      if (res.status === 401) msg = 'Apify rejected the API token (401).';
      else if (res.status === 404) msg = `Apify actor "${trimmed}" not found (404).`;
      else if (res.status === 408) msg = 'Apify run exceeded the 300s synchronous limit (408).';
      else {
        try {
          const b = (await res.json()) as { error?: { message?: string } };
          if (b.error?.message) msg = b.error.message;
        } catch {
          /* keep default */
        }
      }
      logger.warn('apify: run failed', { actorId: trimmed, status: res.status, latency_ms: latencyMs });
      return { ok: false, items: [], error: msg, latencyMs };
    }

    const body = (await res.json()) as unknown;
    const items = Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
    logger.info('apify: run ok', { actorId: trimmed, items: items.length, latency_ms: latencyMs });
    return { ok: true, items, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted
      ? `Apify run timed out after ${Math.round(APIFY_RUN_TIMEOUT_MS / 1000)}s`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    logger.warn('apify: run error', { actorId: trimmed, error: message });
    return { ok: false, items: [], error: message, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
