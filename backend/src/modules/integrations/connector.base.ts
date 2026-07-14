/**
 * Shared connector utilities used by every provider-specific module
 * (WhatsApp / Twilio / SendGrid / Google Ads / Facebook).
 *
 * Conventions enforced here (per AGENTS.md "Observability Rules" + Security Rules):
 *
 *   • Every outbound HTTP call MUST log:
 *       channel, lead_id, campaign_id, status, latency_ms
 *   • Every outbound call MUST go through `loggedFetch`, which:
 *       - records start time
 *       - wraps fetch with AbortSignal timeout (configurable)
 *       - NEVER logs request/response bodies that may contain secrets
 *       - returns a typed `ConnectorResult` so callers do not throw
 *   • `ConnectorResult` is the "Result<T, E>" pattern: services never throw,
 *     callers inspect `.ok` and branch on `.error`.
 *
 * Providers MUST compose these helpers — never call `fetch` directly.
 */

import { logger } from '../../shared/utils/logger';

export type ConnectorChannel =
  | 'whatsapp'
  | 'twilio'
  | 'sendgrid'
  | 'google_ads'
  | 'facebook'
  | 'openwa';

export interface ConnectorSuccess<T = unknown> {
  ok: true;
  status: number;
  data: T;
  /** Provider-assigned message/campaign/object id. Optional. */
  externalId?: string;
  latencyMs: number;
}

export interface ConnectorFailure {
  ok: false;
  status: number;
  error: string;
  latencyMs: number;
  /** Optional hint for retry decision — e.g. 'rate_limited' or 'transient_5xx'. */
  retryable?: boolean;
}

export type ConnectorResult<T = unknown> = ConnectorSuccess<T> | ConnectorFailure;

export interface LoggedFetchOptions {
  channel: ConnectorChannel;
  leadId?: string | null;
  campaignId?: string | null;
  /** Override default 10s timeout. Use for known-slow calls (e.g. uploads). */
  timeoutMs?: number;
  /** Extra non-secret context to attach to the log line. */
  context?: Record<string, unknown>;
  /**
   * If true, log the FULL URL and method at debug level only. Default false.
   * URLs can contain tokens (Twilio auth in query string) — keep off in prod.
   */
  logFullUrl?: boolean;
}

/**
 * Performs a fetch with mandatory observability logging.
 *
 * Returns a `ConnectorResult` — NEVER throws. Network failures, non-2xx
 * responses, and aborts are converted to `ConnectorFailure`. The caller
 * decides whether to retry / enqueue / surface to the user.
 */
export async function loggedFetch<T = unknown>(
  url: string,
  init: RequestInit,
  opts: LoggedFetchOptions,
): Promise<ConnectorResult<T>> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Forward caller-provided abort signal, if any.
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  const safeInit: RequestInit = {
    ...init,
    signal: controller.signal,
  };

  let response: Response;
  try {
    response = await fetch(url, safeInit);
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : 'network error';
    logger.warn('connector network failure', {
      channel: opts.channel,
      lead_id: opts.leadId ?? null,
      campaign_id: opts.campaignId ?? null,
      status: 0,
      latency_ms: latencyMs,
      error: message,
      ...(opts.context ?? {}),
    });
    return {
      ok: false,
      status: 0,
      error: message,
      latencyMs,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - start;
  const ok = response.ok;

  // Parse body if any. We DO NOT log the body — vendors may echo secrets.
  let data: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (ok) {
    logger.info('connector call ok', {
      channel: opts.channel,
      lead_id: opts.leadId ?? null,
      campaign_id: opts.campaignId ?? null,
      status: response.status,
      latency_ms: latencyMs,
      ...(opts.context ?? {}),
    });
    const externalId = extractExternalId(data, opts.channel);
    return { ok: true, status: response.status, data: data as T, externalId, latencyMs };
  }

  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  logger.warn('connector call failed', {
    channel: opts.channel,
    lead_id: opts.leadId ?? null,
    campaign_id: opts.campaignId ?? null,
    status: response.status,
    latency_ms: latencyMs,
    retryable,
    ...(opts.context ?? {}),
  });
  return {
    ok: false,
    status: response.status,
    error: `HTTP ${response.status}`,
    latencyMs,
    retryable,
  };
}

/**
 * Extracts a provider-specific identifier from a successful response body.
 * Best-effort — returns undefined if the vendor's schema doesn't match.
 */
function extractExternalId(data: unknown, channel: ConnectorChannel): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  switch (channel) {
    case 'whatsapp':
      // Cloud API: messages[0].id
      return pickFirst<string>(obj, ['messages.0.id', 'id']);
    case 'twilio':
      return pickFirst<string>(obj, ['sid']);
    case 'sendgrid':
      return pickFirst<string>(obj, ['message_id', 'x-message-id']);
    case 'google_ads':
      return pickFirst<string>(obj, ['results.0.resourceName', 'resourceName']);
    case 'facebook':
      return pickFirst<string>(obj, ['id']);
    default:
      return undefined;
  }
}

function pickFirst<T>(obj: Record<string, unknown>, dottedPaths: string[]): T | undefined {
  for (const path of dottedPaths) {
    const segs = path.split('.');
    let cur: unknown = obj;
    for (const s of segs) {
      if (cur && typeof cur === 'object' && s in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[s];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null) return cur as T;
  }
  return undefined;
}

/**
 * Returns the configured integration record for a provider by name, or null.
 * Used by outbound dispatchers that need the integration row (and decrypted
 * credentials, loaded separately by the caller).
 */
export interface IntegrationLookupRow {
  id: string;
  name: string;
  is_enabled: boolean;
}

/**
 * Returns whether an outbound dispatch should be attempted.
 * Centralised so providers don't reinvent the same gate.
 */
export function isDispatchable(
  row: IntegrationLookupRow | null | undefined,
): row is IntegrationLookupRow {
  return !!row && row.is_enabled;
}
