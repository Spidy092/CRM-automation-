/**
 * Per-provider outbound dispatch helpers consumed by the outreach worker
 * (src/workers/outreach.worker.ts → `sendViaConnector`).
 *
 * The outreach worker previously fell back to a mock for every channel.
 * With Sprint 3 connectors landed, these helpers are the seam between the
 * worker and the per-provider connector modules.
 *
 * Design contract:
 *   - Each function returns a `DispatchOutcome` — never throws.
 *   - Failures carry `retryable` so the worker can decide whether to
 *     re-queue or surface to a dead-letter queue (BullMQ retries are
 *     configured in `queue.ts`).
 *   - We DO NOT log tokens, raw request bodies, or full phone numbers.
 */

import { logger } from '../../shared/utils/logger';
import { decryptJson } from '../../shared/utils/encryption';
import { findByName, findCredentialsById } from './integrations.repository';
import * as whatsapp from './whatsapp/whatsapp.connector';
import * as openwa from './openwa/openwa.connector';
import * as twilio from './twilio/twilio.connector';
import * as sendgrid from './sendgrid/sendgrid.connector';
import * as smtp from './smtp/smtp.connector';
import { OpenWACredentials } from './openwa/openwa.types';

export interface DispatchInput {
  leadId: string;
  campaignId: string;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  templateId: string;
  /** Rendered message body. For SMS/WhatsApp this is the text body; for email
   *  it is the HTML. For `phone_call` this module returns a "skip" outcome —
   *  the outreach worker should record the log and stop. */
  body: string;
  /** Phone or email — vendor-specific. Validated upstream. */
  destination: string;
  subject?: string;
  /** When true, skip the live API call and simulate success. */
  mockMode: boolean;
}

export interface DispatchOutcome {
  ok: boolean;
  externalId?: string;
  latencyMs: number;
  retryable: boolean;
  error?: string;
  /** Provider actually used for the dispatch. Only set for WhatsApp/OpenWA where
   *  a fallback path exists. */
  channel?: 'openwa' | 'whatsapp';
}

export async function dispatchOutbound(input: DispatchInput): Promise<DispatchOutcome> {
  const startedAt = Date.now();
  if (input.mockMode) {
    logger.info('dispatch mocked', {
      channel: input.channel,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
    });
    return {
      ok: true,
      externalId: `mock-${input.channel}-${startedAt}`,
      latencyMs: 0,
      retryable: false,
    };
  }

  try {
    switch (input.channel) {
      case 'whatsapp': {
        try {
          const openwaIntegration = await loadOpenwaIntegrationIfEnabled();
          if (openwaIntegration) {
            const res = await openwa.sendMessage({
              credentials: openwaIntegration.credentials,
              leadId: input.leadId,
              campaignId: input.campaignId,
              to: input.destination,
              body: input.body,
              integrationId: openwaIntegration.integrationId,
            });
            if (res.ok) {
              return {
                ok: true,
                externalId: res.data.messageId,
                latencyMs: res.latencyMs,
                retryable: false,
                channel: 'openwa',
              };
            }
            return {
              ok: false,
              latencyMs: res.latencyMs,
              retryable: res.retryable === true,
              error: res.error,
              channel: 'openwa',
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'OpenWA dispatch error';
          return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            retryable: false,
            error: message,
            channel: 'openwa',
          };
        }

        const res = await whatsapp.sendMessage({
          leadId: input.leadId,
          campaignId: input.campaignId,
          to: input.destination,
          body: input.body,
        });
        return mapOutcome(res, startedAt, 'whatsapp');
      }
      case 'sms': {
        const res = await twilio.sendSms({
          leadId: input.leadId,
          campaignId: input.campaignId,
          to: input.destination,
          body: input.body,
        });
        return mapOutcome(res, startedAt);
      }
      case 'email': {
        // Try SendGrid first; fall back to SMTP if SendGrid is not configured.
        const sgRes = await sendgrid.sendEmail({
          leadId: input.leadId,
          campaignId: input.campaignId,
          to: input.destination,
          subject: input.subject ?? '(no subject)',
          htmlBody: input.body,
        });
        if (sgRes.ok) return mapOutcome(sgRes, startedAt);

        // SendGrid failed — check if it was a config issue, then try SMTP.
        const sgError = sgRes.error ?? '';
        const isSgNotConfigured =
          sgError.toLowerCase().includes('not configured') ||
          sgError.toLowerCase().includes('credentials not set');

        if (isSgNotConfigured) {
          logger.info('SendGrid not configured — falling back to SMTP', {
            lead_id: input.leadId,
            campaign_id: input.campaignId,
          });
          const smtpRes = await smtp.sendEmail({
            leadId: input.leadId,
            campaignId: input.campaignId,
            to: input.destination,
            subject: input.subject ?? '(no subject)',
            htmlBody: input.body,
          });
          return mapOutcome(smtpRes, startedAt);
        }

        // SendGrid was configured but returned a dispatch error — do not retry via SMTP.
        return mapOutcome(sgRes, startedAt);
      }
      case 'phone_call': {
        // phone_call steps are handled upstream in outreach.worker.ts by
        // creating a task row. This branch should never be reached in
        // normal operation — return a no-op success so the log closes cleanly.
        logger.info('phone_call reached dispatch — handled upstream via task creation', {
          lead_id: input.leadId,
          campaign_id: input.campaignId,
        });
        return {
          ok: true,
          externalId: `phone-task-${startedAt}`,
          latencyMs: 0,
          retryable: false,
        };
      }
      default: {
        // Exhaustiveness — should never reach here at runtime.
        const _exhaustive: never = input.channel;
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          retryable: false,
          error: `Unknown channel: ${String(_exhaustive)}`,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    // AppError(404/422) from connector setup = "do not retry" (config issue).
    const messageLower = message.toLowerCase();
    const retryable =
      !messageLower.includes('not configured') &&
      !messageLower.includes('credentials not set') &&
      !messageLower.includes('invalid');
    logger.error('dispatch threw', {
      channel: input.channel,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      error: message,
      retryable,
    });
    return { ok: false, latencyMs: Date.now() - startedAt, retryable, error: message };
  }
}

async function loadOpenwaIntegrationIfEnabled(): Promise<{
  credentials: OpenWACredentials;
  integrationId: string;
} | null> {
  const row = await findByName('openwa');
  if (!row || !row.is_enabled) return null;

  const encrypted = await findCredentialsById(row.id);
  if (!encrypted) return null;

  const decrypted = decryptJson<unknown>(encrypted);
  const credentials = await openwa.loadCredentials(decrypted);
  return { credentials, integrationId: row.id };
}

function mapOutcome(
  res:
    | { ok: true; externalId?: string; latencyMs: number }
    | { ok: false; error: string; retryable?: boolean; latencyMs: number },
  startedAt: number,
  channel?: 'openwa' | 'whatsapp',
): DispatchOutcome {
  const latency = res.latencyMs || Date.now() - startedAt;
  if (res.ok) {
    return {
      ok: true,
      externalId: res.externalId,
      latencyMs: latency,
      retryable: false,
      channel,
    };
  }
  return {
    ok: false,
    latencyMs: latency,
    retryable: res.retryable === true,
    error: res.error,
    channel,
  };
}
