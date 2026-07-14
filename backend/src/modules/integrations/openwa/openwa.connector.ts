/**
 * OpenWA HTTP connector.
 *
 * Implements the shared connector interface and composes the anti-ban helpers
 * (rate-limiting, warm-up, cooldown, number rotation) from openwa.antiban.
 *
 * Endpoints (OpenWA):
 *   Send message: POST {baseUrl}/api/sessions/{sessionId}/messages/send-text
 *   Health check: GET  {baseUrl}/api/sessions/{sessionId}/health
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- TODO: refactor away from `any` casts (legacy debt) */
import { AppError } from '../../../shared/middleware/errorHandler';
import { loggedFetch, type ConnectorResult, type ConnectorChannel } from '../connector.base';
import { OpenWACredentials, OpenWASendResponse, openWACredentialsSchema } from './openwa.types';
import {
  buildAntiBanConfig,
  cooldown,
  createStateRepository,
  jitter,
  rateLimit,
  rotateNumber,
  warmup,
} from './openwa.antiban';

const OPENWA_CHANNEL: ConnectorChannel = 'openwa';
const DEFAULT_INTEGRATION_KEY = 'default';

export interface SendMessageInput {
  credentials: OpenWACredentials;
  leadId: string;
  campaignId: string;
  to: string;
  body: string;
  integrationId?: string;
}

export interface SendMessageOutput {
  messageId: string;
  numberUsed: string;
}

/**
 * Loads and validates raw OpenWA credentials.
 *
 * Throws AppError(422) when the shape is invalid, numbers are empty, or the
 * base URL does not use http/https. No network call is performed.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function loadCredentials(input?: unknown): Promise<OpenWACredentials> {
  const parsed = openWACredentialsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      `OpenWA credentials invalid: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }

  const credentials = parsed.data;

  if (
    !credentials.baseUrl.toLowerCase().startsWith('http://') &&
    !credentials.baseUrl.toLowerCase().startsWith('https://')
  ) {
    throw new AppError('OpenWA baseUrl must start with http:// or https://', 422);
  }

  if (credentials.numbers.length === 0) {
    throw new AppError('OpenWA credentials must include at least one sender number', 422);
  }

  credentials.antiBan = buildAntiBanConfig(credentials.antiBan);
  return credentials;
}

/**
 * Sends a text message through OpenWA using the anti-ban helpers.
 *
 * Never throws for HTTP failures — returns a ConnectorResult instead.
 */
export async function sendMessage(
  input: SendMessageInput,
): Promise<ConnectorResult<SendMessageOutput>> {
  const { credentials, leadId, campaignId, to, body, integrationId } = input;
  const config = buildAntiBanConfig(credentials.antiBan);
  const repo = createStateRepository();
  const integrationKey = integrationId ?? DEFAULT_INTEGRATION_KEY;
  const now = new Date();

  const chatId = to.endsWith('@c.us') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;

  const lastUsedAt = new Map<string, Date>();
  const activeCooldown = new Set<string>();

  await Promise.all(
    credentials.numbers.map(async (number) => {
      const state = await repo.get(integrationKey, number);
      if (state.lastSentAt) {
        lastUsedAt.set(number, new Date(state.lastSentAt));
      }
      if (state.cooldownUntil && new Date(state.cooldownUntil) > now) {
        activeCooldown.add(number);
      }
    }),
  );

  let numberUsed: string | null = null;
  const excluded = new Set<string>(activeCooldown);
  let attempt = 0;

  while (attempt < 2) {
    const rotation = rotateNumber({
      numbers: credentials.numbers,
      lastUsedAt,
      excludeCooldown: excluded,
      now,
    });

    if (!rotation.number) {
      return {
        ok: false,
        status: 429,
        error: 'All OpenWA sender numbers are cooling down',
        latencyMs: 0,
        retryable: false,
      };
    }

    const number = rotation.number;
    const state = await repo.get(integrationKey, number);

    const rateResult = await rateLimit({
      number,
      credentials,
      getState: () => Promise.resolve(state),
      increment: async () => {
        await repo.set(integrationKey, number, {
          dailyCount: state.dailyCount + 1,
          hourlyCount: state.hourlyCount + 1,
          lastSentAt: now.toISOString(),
          warmupSent: state.warmupSent + 1,
        });
      },
      now,
    });

    const warmupResult = await warmup({
      number,
      credentials,
      getState: () => Promise.resolve(state),
      now,
    });

    const antiBanReason = !rateResult.allowed
      ? rateResult.reason
      : !warmupResult.allowed
        ? warmupResult.reason
        : undefined;

    if (antiBanReason) {
      if (attempt === 1) {
        return {
          ok: false,
          status: 429,
          error: `OpenWA anti-ban rejected send: ${antiBanReason}`,
          latencyMs: 0,
          retryable: false,
        };
      }

      await jitter(config.jitterMinMs, config.jitterMaxMs);
      excluded.add(number);
      attempt++;
      continue;
    }

    if (warmupResult.delayMs) {
      await jitter(warmupResult.delayMs, warmupResult.delayMs);
    }

    numberUsed = number;
    break;
  }

  if (!numberUsed) {
    return {
      ok: false,
      status: 429,
      error: 'OpenWA anti-ban prevented send after retry',
      latencyMs: 0,
      retryable: false,
    };
  }

  await jitter(config.jitterMinMs, config.jitterMaxMs);

  let actualSessionId = credentials.sessionId;
  const baseUrl = credentials.baseUrl.replace(/\/+$/, '');

  // If the user provided a session name instead of a UUID, resolve it first.
  if (actualSessionId.length !== 36) {
    const listUrl = `${baseUrl}/api/sessions`;
    const resList = await loggedFetch<any[]>(
      listUrl,
      { method: 'GET', headers: { 'x-api-key': credentials.apiKey } },
      { channel: OPENWA_CHANNEL },
    );
    if (resList.ok && Array.isArray(resList.data)) {
      const match = resList.data.find((s) => s.name === actualSessionId);
      if (match) {
        actualSessionId = match.id;
      }
    }
  }

  const url = `${baseUrl}/api/sessions/${encodeURIComponent(actualSessionId)}/messages/send-text`;

  const res = await loggedFetch<OpenWASendResponse>(
    url,
    {
      method: 'POST',
      headers: {
        'x-api-key': credentials.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ chatId, text: body }),
    },
    {
      channel: OPENWA_CHANNEL,
      leadId,
      campaignId,
      context: { to: maskPhone(to), numberUsed },
    },
  );

  if (!res.ok) {
    const bodyText = res.error;
    const isBlockOrBan = /block|ban/i.test(bodyText);
    const nonRetryable =
      res.status === 401 || res.status === 403 || res.status === 404 || isBlockOrBan;

    if (nonRetryable && integrationId) {
      await cooldown({
        number: numberUsed,
        credentials,
        persist: async (patch) => repo.set(integrationKey, numberUsed, patch),
        now: new Date(),
      });
    }

    return {
      ok: false,
      status: res.status,
      error: bodyText,
      latencyMs: res.latencyMs,
      retryable: nonRetryable ? false : res.retryable,
    };
  }

  return {
    ok: true,
    status: res.status,
    data: { messageId: res.data.messageId, numberUsed },
    externalId: res.data.messageId,
    latencyMs: res.latencyMs,
  };
}

/**
 * Performs a health check against the configured OpenWA session.
 *
 * Never throws for HTTP failures.
 */
export async function healthCheck(input: {
  credentials: OpenWACredentials;
}): Promise<ConnectorResult<{ status: string }>> {
  const { credentials } = input;
  const baseUrl = credentials.baseUrl.replace(/\/+$/, '');

  // We fetch the list of all sessions instead of a single session.
  // This supports cases where the user configures the integration using the session "name"
  // rather than the UUID, which is common.
  const url = `${baseUrl}/api/sessions`;

  const res = await loggedFetch<any[]>(
    url,
    {
      method: 'GET',
      headers: { 'x-api-key': credentials.apiKey },
    },
    { channel: OPENWA_CHANNEL },
  );

  if (!res.ok) {
    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid API key.',
        latencyMs: res.latencyMs,
        retryable: false,
      };
    }
    return {
      ok: false,
      status: res.status,
      error: res.error || 'OpenWA health check failed',
      latencyMs: res.latencyMs,
      retryable: false,
    };
  }

  const sessions = Array.isArray(res.data) ? res.data : [];
  const session = sessions.find(
    (s) => s.id === credentials.sessionId || s.name === credentials.sessionId,
  );

  if (!session) {
    return {
      ok: false,
      status: 404,
      error: `Session '${credentials.sessionId}' not found. Please verify the session name or ID in the OpenWA dashboard.`,
      latencyMs: res.latencyMs,
      retryable: false,
    };
  }

  return {
    ok: true,
    status: 200,
    data: { status: session.status || 'CONNECTED' },
    latencyMs: res.latencyMs,
  };
}

/**
 * Webhook signature verification placeholder.
 *
 * HMAC verification is out of scope for this phase; the interface is kept so
 * callers can integrate it later without changing signatures.
 */
export function verifyWebhook(
  _payload: unknown,
  _signature?: string,
): { ok: boolean; reason?: string } {
  return { ok: false, reason: 'not_implemented' };
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***';
  return `${phone.slice(0, 2)}***${phone.slice(-2)}`;
}
