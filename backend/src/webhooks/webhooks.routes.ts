import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { pool, queryOne } from '../shared/utils/db';
import { logger } from '../shared/utils/logger';
import { wrap } from '../shared/utils/asyncHandler';
import {
  verifyWhatsAppSignature,
  verifyTwilioSignature,
  verifySendGridSignature,
  verifyGoogleAdsSecret,
} from './webhook-verifiers';
import { verifyFacebookSignature } from './facebook-verifier';
import {
  handleWhatsAppMessage,
  handleWhatsAppStatus,
  handleTwilioMessage,
  handleTwilioStatus,
  handleSendGridEvents,
  handleGoogleAdsLeadForm,
  handleWebsiteForm,
} from './webhook-handlers';
import { handleFacebookLeadAd } from './facebook-handlers';

const router = Router();

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Signature schemes for Meta and SendGrid cover the exact bytes received on
 * the wire. `JSON.stringify(req.body)` is not equivalent because parsing can
 * normalize whitespace, escaping, and key order. The application middleware
 * captures rawBody before JSON parsing; reject requests from unit/integration
 * mounts that did not install that capture rather than accepting an
 * unverifiable webhook.
 */
function getRawBody(req: Request): string | null {
  const rawBody = (req as RawBodyRequest).rawBody;
  return Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : null;
}

function payloadDigest(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

// ── Idempotency Helper ─────────────────────────────────────────────────────

async function ensureWebhookEvent(
  provider: string,
  eventId: string,
  rawPayload: unknown,
  signatureHeader: string | undefined,
): Promise<{ duplicate: boolean; id: string }> {
  // Check if already processed
  const existing = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM webhook_events
     WHERE provider = $1 AND event_id = $2`,
    [provider, eventId],
  );

  if (existing) {
    if (existing.status === 'processed') {
      logger.info('Duplicate webhook event skipped', { provider, eventId });
      return { duplicate: true, id: existing.id };
    }

    // A prior attempt may have failed after the event row was inserted. Keep
    // that row retryable instead of treating every non-processed state as a
    // permanent duplicate.
    await pool.query(
      `UPDATE webhook_events
          SET status = 'received', error_message = NULL, processed_at = NULL
        WHERE id = $1 AND status <> 'processed'`,
      [existing.id],
    );
    return { duplicate: false, id: existing.id };
  }

  // Insert new event
  const created = await queryOne<{ id: string }>(
    `INSERT INTO webhook_events (provider, event_id, raw_payload, signature_header, status)
     VALUES ($1, $2, $3::jsonb, $4, 'received')
     RETURNING id`,
    [provider, eventId, JSON.stringify(rawPayload), signatureHeader ?? null],
  );

  return { duplicate: false, id: created?.id ?? '' };
}

async function markWebhookProcessed(id: string, leadId?: string, error?: string): Promise<void> {
  if (error) {
    await pool.query(
      `UPDATE webhook_events SET status = 'failed', error_message = $1, processed_at = NOW()
       WHERE id = $2`,
      [error, id],
    );
  } else {
    await pool.query(
      `UPDATE webhook_events SET status = 'processed', lead_id = COALESCE($1, lead_id), processed_at = NOW()
       WHERE id = $2`,
      [leadId ?? null, id],
    );
  }
}

// ── WhatsApp Cloud API Webhook ─────────────────────────────────────────────
// POST /webhooks/whatsapp
// Used for both inbound messages and status callbacks from WhatsApp.
router.post(
  '/whatsapp',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const rawBody = getRawBody(req);
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';

      if (!appSecret) {
        logger.error('WhatsApp webhook secret is not configured');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!rawBody) {
        logger.error('WhatsApp webhook raw body is unavailable');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
        logger.warn('WhatsApp webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }

      const body = req.body as Record<string, unknown>;
      const entry = (body.entry as unknown[])?.[0] as Record<string, unknown> | undefined;

      // Determine if this is a message or status update
      const changes = (entry?.changes as unknown[]) ?? [];
      const value = (changes[0] as Record<string, unknown>)?.value as
        | Record<string, unknown>
        | undefined;

      // WhatsApp sends status updates in the same structure as messages
      const messages = value?.messages as unknown[] | undefined;
      const statuses = value?.statuses as unknown[] | undefined;

      if (messages && messages.length > 0) {
        const msg = messages[0] as Record<string, unknown>;
        const wamId = typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : null;
        if (!wamId) {
          logger.warn('WhatsApp webhook message has no provider event id');
          res.status(400).send('Missing message id');
          return;
        }
        const { duplicate, id: eventId } = await ensureWebhookEvent(
          'whatsapp',
          `msg:${wamId}`,
          body,
          signature,
        );
        if (duplicate) {
          res.status(200).send('EVENT_RECEIVED');
          return;
        }
        webhookRecordId = eventId;

        const result = await handleWhatsAppMessage(body);
        await markWebhookProcessed(eventId, result.leadId);
      } else if (statuses && statuses.length > 0) {
        const status = statuses[0] as Record<string, unknown>;
        const wamId = typeof status.id === 'string' && status.id.length > 0 ? status.id : null;
        if (!wamId) {
          logger.warn('WhatsApp webhook status has no provider event id');
          res.status(400).send('Missing status id');
          return;
        }
        const { duplicate, id: eventId } = await ensureWebhookEvent(
          'whatsapp',
          `status:${wamId}`,
          body,
          signature,
        );
        if (duplicate) {
          res.status(200).send('EVENT_RECEIVED');
          return;
        }
        webhookRecordId = eventId;

        await handleWhatsAppStatus(body);
        await markWebhookProcessed(eventId);
      } else {
        // Verification challenge or unknown payload
        logger.info('WhatsApp webhook received (no messages/statuses)', { body });
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (err) {
      logger.error('WhatsApp webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark WhatsApp webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('EVENT_RECEIVED'); // Always return 200 per WhatsApp spec
    }
  }),
);

// ── Twilio Webhook ─────────────────────────────────────────────────────────
// POST /webhooks/twilio
// Handles inbound SMS and status callbacks.
router.post(
  '/twilio',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
      const signature = req.headers['x-twilio-signature'] as string | undefined;

      if (!authToken) {
        logger.error('Twilio webhook auth token is not configured');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!signature) {
        logger.warn('Twilio webhook missing signature');
        res.status(401).send('Invalid signature');
        return;
      }

      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const params = req.body as Record<string, string>;
      if (!verifyTwilioSignature(fullUrl, params, authToken, signature)) {
        logger.warn('Twilio webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }

      const body = req.body as Record<string, unknown>;
      const messageSid =
        typeof body.MessageSid === 'string'
          ? body.MessageSid
          : typeof body.SmsSid === 'string'
            ? body.SmsSid
            : null;

      if (!messageSid) {
        logger.warn('Twilio webhook has no provider event id');
        res.status(400).send('Missing message id');
        return;
      }

      // Determine if this is an inbound message or status callback
      const isStatusCallback = typeof body.MessageStatus === 'string';
      const isInbound = !!(body.From as string) || !!(body.Body as string);

      if (isStatusCallback) {
        const { duplicate, id: eventId } = await ensureWebhookEvent(
          'twilio',
          `status:${messageSid}`,
          body,
          signature,
        );
        if (!duplicate) {
          webhookRecordId = eventId;
          await handleTwilioStatus(body);
          await markWebhookProcessed(eventId);
        }
      } else if (isInbound) {
        const { duplicate, id: eventId } = await ensureWebhookEvent(
          'twilio',
          `inbound:${messageSid}`,
          body,
          signature,
        );
        if (!duplicate) {
          webhookRecordId = eventId;
          const result = await handleTwilioMessage(body);
          await markWebhookProcessed(eventId, result.leadId);
        }
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error('Twilio webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark Twilio webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('OK');
    }
  }),
);

// ── SendGrid Webhook ──────────────────────────────────────────────────────
// POST /webhooks/sendgrid
// Receives event batches (delivered, opened, clicked, bounced, etc.).
router.post(
  '/sendgrid',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const rawBody = getRawBody(req);
      const signature = req.headers['x-twilio-email-event-webhook-signature'] as string | undefined;
      const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string | undefined;
      const verificationKey = process.env.SENDGRID_VERIFICATION_KEY;

      if (!verificationKey) {
        logger.error('SendGrid webhook verification key is not configured');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!rawBody || !signature || !timestamp) {
        logger.warn('SendGrid webhook is missing signature material');
        res.status(401).send('Invalid signature');
        return;
      }

      const signedPayload = `${timestamp}${rawBody}`;
      if (!verifySendGridSignature(signedPayload, signature, verificationKey)) {
        logger.warn('SendGrid webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }

      const events = Array.isArray(req.body) ? req.body : [req.body];

      // A batch can contain multiple provider events. Hash the exact payload
      // so retries of a batch are idempotent even when no sg_event_id exists.
      const batchId = `batch:${payloadDigest(rawBody)}`;

      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'sendgrid',
        batchId,
        events,
        signature,
      );
      if (!duplicate) {
        webhookRecordId = eventId;
        const result = await handleSendGridEvents(events);
        await markWebhookProcessed(eventId);
        logger.info('SendGrid events processed', { count: events.length, result: result.details });
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error('SendGrid webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark SendGrid webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('OK');
    }
  }),
);

// ── Google Ads Webhook ─────────────────────────────────────────────────────
// POST /webhooks/google-ads
// Receives lead form submissions from Google Ads Lead Form extensions.
router.post(
  '/google-ads',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const body = req.body as Record<string, unknown>;
      const payloadSecret = body.secret as string | undefined;
      const configuredSecret = process.env.GOOGLE_ADS_WEBHOOK_SECRET;

      if (!verifyGoogleAdsSecret(payloadSecret, configuredSecret)) {
        logger.warn('Google Ads webhook secret mismatch');
        res.status(401).send('Invalid secret');
        return;
      }

      const googleLeadId = typeof body.lead_id === 'string' ? body.lead_id : null;
      if (!googleLeadId) {
        logger.warn('Google Ads webhook has no provider lead id');
        res.status(400).send('Missing lead id');
        return;
      }
      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'google-ads',
        googleLeadId,
        body,
        undefined,
      );

      if (!duplicate) {
        webhookRecordId = eventId;
        const result = await handleGoogleAdsLeadForm(body);
        await markWebhookProcessed(eventId, result.leadId);
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error('Google Ads webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark Google Ads webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('OK');
    }
  }),
);

// ── Website Contact Form Webhook ──────────────────────────────────────────
// POST /webhooks/website-form
// Receives contact form submissions from the website.
router.post(
  '/website-form',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const body = req.body as Record<string, unknown>;

      const rawBody = getRawBody(req);
      if (!rawBody) {
        logger.error('Website form webhook raw body is unavailable');
        res.status(503).send('Webhook idempotency unavailable');
        return;
      }
      // Website forms do not have a provider-generated event id. Hashing the
      // exact request body makes retries of the same submission idempotent.
      const googleLeadId = `webform:${payloadDigest(rawBody)}`;
      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'website-form',
        googleLeadId,
        body,
        undefined,
      );

      if (!duplicate) {
        webhookRecordId = eventId;
        const result = await handleWebsiteForm(body);
        await markWebhookProcessed(eventId, result.leadId);
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error('Website form webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark website form webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('OK');
    }
  }),
);

// ── Facebook Lead Ads Webhook ─────────────────────────────────────────────
// POST /webhooks/facebook
// Receives Lead Ads form submissions from Facebook/Meta.
router.post(
  '/facebook',
  wrap(async (req: Request, res: Response) => {
    let webhookRecordId: string | null = null;
    try {
      const rawBody = getRawBody(req);
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const appSecret = process.env.FACEBOOK_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET ?? '';

      if (!appSecret) {
        logger.error('Facebook webhook app secret is not configured');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!rawBody) {
        logger.error('Facebook webhook raw body is unavailable');
        res.status(503).send('Webhook verification unavailable');
        return;
      }
      if (!verifyFacebookSignature(rawBody, signature, appSecret)) {
        logger.warn('Facebook Lead Ads webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }

      const body = req.body as Record<string, unknown>;
      const entry = (body.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
      const change = ((entry?.changes as unknown[])?.[0] as Record<string, unknown>)?.value as
        | Record<string, unknown>
        | undefined;

      const leadgenId = typeof change?.leadgen_id === 'string' ? change.leadgen_id : null;
      if (!leadgenId) {
        logger.warn('Facebook Lead Ads webhook has no provider lead id');
        res.status(400).send('Missing lead id');
        return;
      }

      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'facebook',
        `lead:${leadgenId}`,
        body,
        signature,
      );
      if (duplicate) {
        res.status(200).send('OK');
        return;
      }
      webhookRecordId = eventId;

      const result = await handleFacebookLeadAd(body);
      await markWebhookProcessed(eventId, result.leadId);

      logger.info('Facebook Lead Ads webhook processed', {
        leadgenId,
        action: result.action,
        leadId: result.leadId,
      });

      res.status(200).send('OK');
    } catch (err) {
      logger.error('Facebook Lead Ads webhook error', { error: (err as Error).message });
      if (webhookRecordId) {
        await markWebhookProcessed(
          webhookRecordId,
          undefined,
          err instanceof Error ? err.message : String(err),
        ).catch((markError: unknown) => {
          logger.error('Failed to mark Facebook webhook failed', {
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      }
      res.status(200).send('OK'); // Facebook requires 200
    }
  }),
);

// ── Facebook Verification (GET /webhooks/facebook) ─────────────────────────
// Meta requires a GET endpoint for webhook verification during setup.
router.get('/facebook', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;
  const expectedToken = process.env.FACEBOOK_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN;

  if (expectedToken && mode === 'subscribe' && token === expectedToken && challenge) {
    logger.info('Facebook Lead Ads webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('Facebook Lead Ads webhook verification failed', {
      mode,
      hasToken: Boolean(token),
    });
    res.status(403).send('Verification failed');
  }
});

// ── WhatsApp Verification (GET /webhooks/whatsapp) ─────────────────────────
// Facebook/Meta requires a GET endpoint for webhook verification during setup.
router.get('/whatsapp', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (expectedToken && mode === 'subscribe' && token === expectedToken && challenge) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, hasToken: Boolean(token) });
    res.status(403).send('Verification failed');
  }
});

export { router as webhooksRoutes };
