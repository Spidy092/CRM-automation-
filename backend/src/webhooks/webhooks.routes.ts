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
import {
  handleWhatsAppMessage,
  handleWhatsAppStatus,
  handleTwilioMessage,
  handleTwilioStatus,
  handleSendGridEvents,
  handleGoogleAdsLeadForm,
} from './webhook-handlers';

const router = Router();

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
    logger.info('Duplicate webhook event skipped', { provider, eventId });
    return { duplicate: true, id: existing.id };
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
router.post('/whatsapp', wrap(async (req: Request, res: Response) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';

    // Verify signature if app secret is configured
    if (appSecret && !verifyWhatsAppSignature(rawBody, signature, appSecret)) {
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
      const wamId = msg.id as string;
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

      const result = await handleWhatsAppMessage(body);
      await markWebhookProcessed(eventId, result.leadId);
    } else if (statuses && statuses.length > 0) {
      const status = statuses[0] as Record<string, unknown>;
      const wamId = status.id as string;
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

      await handleWhatsAppStatus(body);
      await markWebhookProcessed(eventId);
    } else {
      // Verification challenge or unknown payload
      logger.info('WhatsApp webhook received (no messages/statuses)', { body });
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    logger.error('WhatsApp webhook error', { error: (err as Error).message });
    res.status(200).send('EVENT_RECEIVED'); // Always return 200 per WhatsApp spec
  }
}));

// ── Twilio Webhook ─────────────────────────────────────────────────────────
// POST /webhooks/twilio
// Handles inbound SMS and status callbacks.
router.post('/twilio', wrap(async (req: Request, res: Response) => {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const signature = req.headers['x-twilio-signature'] as string | undefined;

    // Verify signature if auth token is configured
    if (authToken && signature) {
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const params = req.body as Record<string, string>;
      if (!verifyTwilioSignature(fullUrl, params, authToken, signature)) {
        logger.warn('Twilio webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    const body = req.body as Record<string, unknown>;
    const messageSid = (body.MessageSid as string) ?? (body.SmsSid as string);

    // Determine if this is an inbound message or status callback
    const isStatusCallback = !!(body.MessageStatus as string) && !!messageSid;
    const isInbound = !!(body.From as string) || !!(body.Body as string);

    if (isStatusCallback) {
      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'twilio',
        `status:${messageSid}`,
        body,
        signature,
      );
      if (!duplicate) {
        await handleTwilioStatus(body);
        await markWebhookProcessed(eventId);
      }
    } else if (isInbound) {
      // Use From as event ID for inbound messages
      const from = (body.From as string) ?? 'unknown';
      const { duplicate, id: eventId } = await ensureWebhookEvent(
        'twilio',
        `inbound:${from}`,
        body,
        signature,
      );
      if (!duplicate) {
        const result = await handleTwilioMessage(body);
        await markWebhookProcessed(eventId, result.leadId);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    logger.error('Twilio webhook error', { error: (err as Error).message });
    res.status(200).send('OK');
  }
}));

// ── SendGrid Webhook ──────────────────────────────────────────────────────
// POST /webhooks/sendgrid
// Receives event batches (delivered, opened, clicked, bounced, etc.).
router.post('/sendgrid', wrap(async (req: Request, res: Response) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-event-webhook-signature'] as string | undefined;
    const timestamp = req.headers['x-event-webhook-timestamp'] as string | undefined;
    const verificationKey = process.env.SENDGRID_VERIFICATION_KEY;

    // Construct the signed payload (timestamp + '.' + raw body) if verification is enabled
    if (signature && timestamp && verificationKey) {
      const signedPayload = `${timestamp}.${rawBody}`;
      if (!verifySendGridSignature(signedPayload, signature, verificationKey)) {
        logger.warn('SendGrid webhook signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];

    // Batch idempotency — use the first event's sg_event_id or a hash of all
    const batchId =
      events.length > 0
        ? (((events[0] as Record<string, unknown>).sg_event_id as string) ??
          `batch_${events.length}_${Date.now()}`)
        : `empty_${Date.now()}`;

    const { duplicate, id: eventId } = await ensureWebhookEvent(
      'sendgrid',
      batchId,
      events,
      signature,
    );
    if (!duplicate) {
      const result = await handleSendGridEvents(events);
      await markWebhookProcessed(eventId);
      logger.info('SendGrid events processed', { count: events.length, result: result.details });
    }

    res.status(200).send('OK');
  } catch (err) {
    logger.error('SendGrid webhook error', { error: (err as Error).message });
    res.status(200).send('OK');
  }
}));

// ── Google Ads Webhook ─────────────────────────────────────────────────────
// POST /webhooks/google-ads
// Receives lead form submissions from Google Ads Lead Form extensions.
router.post('/google-ads', wrap(async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const payloadSecret = body.secret as string | undefined;
    const configuredSecret = process.env.GOOGLE_ADS_WEBHOOK_SECRET;

    if (!verifyGoogleAdsSecret(payloadSecret, configuredSecret)) {
      logger.warn('Google Ads webhook secret mismatch');
      res.status(401).send('Invalid secret');
      return;
    }

    const googleLeadId = (body.lead_id as string) ?? `lead_${Date.now()}`;
    const { duplicate, id: eventId } = await ensureWebhookEvent(
      'google-ads',
      googleLeadId,
      body,
      undefined,
    );

    if (!duplicate) {
      const result = await handleGoogleAdsLeadForm(body);
      await markWebhookProcessed(eventId, result.leadId);
    }

    res.status(200).send('OK');
  } catch (err) {
    logger.error('Google Ads webhook error', { error: (err as Error).message });
    res.status(200).send('OK');
  }
}));

// ── WhatsApp Verification (GET /webhooks/whatsapp) ─────────────────────────
// Facebook/Meta requires a GET endpoint for webhook verification during setup.
router.get('/whatsapp', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken && challenge) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, token });
    res.status(403).send('Verification failed');
  }
});

export { router as webhooksRoutes };
