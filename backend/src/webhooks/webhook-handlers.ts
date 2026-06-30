/**
 * Provider-specific webhook business logic.
 *
 * Each function handles a single webhook payload type — message, status
 * update, event batch, or lead form submission — and performs the
 * appropriate action (upsert lead, update outreach_log, etc.).
 *
 * Idempotency is handled by the caller (webhooks.routes.ts) via the
 * webhook_events table.
 */
import { pool, queryOne } from '../shared/utils/db';
import { logger } from '../shared/utils/logger';
import { cancelPendingOutreachJobs, enqueueAiClassifyReply } from '../workers/queue';
import { publishAIDomainEvent } from '../shared/events/eventBus';

// ── Types ──────────────────────────────────────────────────────────────────

interface WebhookResult {
  action: string;
  leadId?: string;
  details?: string;
}

async function publishLeadReplyReceived(
  leadId: string,
  channel: 'whatsapp' | 'sms' | 'email',
  messageId: string,
  rawBody: string,
): Promise<void> {
  await publishAIDomainEvent({
    type: 'lead.reply.received',
    payload: {
      lead_id: leadId,
      channel,
      message_id: messageId,
      message_text: rawBody.slice(0, 2000),
      received_at: new Date().toISOString(),
    },
  });
}

async function stopAutomationForReply(leadId: string): Promise<void> {
  await cancelPendingOutreachJobs({ leadId });

  const stage = await queryOne<{ id: string }>(
    `SELECT id FROM pipeline_stages WHERE name = 'Follow-Up Required' ORDER BY created_at ASC LIMIT 1`,
  );
  if (stage) {
    await pool.query(
      `UPDATE leads SET pipeline_stage_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
      [stage.id, leadId],
    );
  }

  await pool.query(
    `INSERT INTO tasks (lead_id, assigned_to, type, title, description, due_at, created_by)
     SELECT id, assigned_to, 'follow_up', 'Follow up on inbound reply',
            'Inbound reply stopped automation. Review the conversation and respond.',
            NOW(), assigned_to
     FROM leads
     WHERE id = $1 AND assigned_to IS NOT NULL AND deleted_at IS NULL`,
    [leadId],
  );
}

// ── WhatsApp ───────────────────────────────────────────────────────────────

/**
 * Handle inbound WhatsApp message (text or interactive reply).
 * Find or create a lead by sender's phone number.
 */
export async function handleWhatsAppMessage(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const entry = (payload.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value = change?.value as Record<string, unknown> | undefined;
  const messages = value?.messages as unknown[] | undefined;
  const metadata = value?.metadata as Record<string, unknown> | undefined;

  if (!messages || messages.length === 0) {
    return { action: 'noop', details: 'No messages in payload' };
  }

  const msg = messages[0] as Record<string, unknown>;
  const from = msg.from as string; // sender phone number
  const msgType = msg.type as string;
  const phoneNumberId = metadata?.phone_number_id as string;
  const wamId = (msg.id as string | undefined) ?? 'unknown';
  const textBody =
    ((msg.text as Record<string, unknown> | undefined)?.body as string | undefined) ??
    (msg.interactive as Record<string, unknown> | undefined)?.button_reply?.toString() ??
    '';

  logger.info('WhatsApp inbound message', {
    from,
    type: msgType,
    phoneNumberId,
  });

  // Check if lead exists with this phone number
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
    [from],
  );

  if (existing) {
    // Update outreach_log for the lead — mark messages from this number as "replied"
    try {
      await pool.query(
        `UPDATE outreach_logs SET status = 'replied', replied_at = NOW(), updated_at = NOW()
         WHERE lead_id = $1 AND channel = 'whatsapp' AND status NOT IN ('replied', 'failed')`,
        [existing.id],
      );
    } catch (error) {
      logger.error('Failed to persist WhatsApp reply', {
        leadId: existing.id,
        from,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await publishLeadReplyReceived(existing.id, 'whatsapp', `wam:${wamId}`, textBody);
    await stopAutomationForReply(existing.id);

    if (textBody) {
      void enqueueAiClassifyReply({
        leadId: existing.id,
        channel: 'whatsapp',
        messageText: textBody,
        externalMessageId: wamId !== 'unknown' ? `wam:${wamId}` : undefined,
      }).catch((err: unknown) => {
        logger.warn('WhatsApp: failed to enqueue AI reply classification', {
          leadId: existing.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    logger.info('WhatsApp reply recorded', { leadId: existing.id, from });
    return { action: 'reply_recorded', leadId: existing.id, details: `Reply from ${from}` };
  }

  // New lead from inbound WhatsApp message
  let created: { id: string } | null;
  try {
    created = await queryOne<{ id: string }>(
      `INSERT INTO leads (business_name, contact_name, phone, source_platform, status)
       VALUES ($1, $2, $3, 'whatsapp', 'active')
       RETURNING id`,
      [`WhatsApp Lead ${from.slice(-4)}`, `Contact ${from.slice(-4)}`, from],
    );
  } catch (error) {
    logger.error('Failed to create lead from WhatsApp message', {
      from,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (created) {
    await publishLeadReplyReceived(created.id, 'whatsapp', `wam:${wamId}`, textBody);
  }

  logger.info('WhatsApp lead created', { leadId: created?.id, from });
  return { action: 'lead_created', leadId: created?.id, details: `New lead from ${from}` };
}

/**
 * Handle WhatsApp message status update (sent, delivered, read, failed).
 */
export async function handleWhatsAppStatus(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const entry = (payload.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value = change?.value as Record<string, unknown> | undefined;
  const statuses = value?.statuses as unknown[] | undefined;

  if (!statuses || statuses.length === 0) {
    return { action: 'noop', details: 'No statuses in payload' };
  }

  for (const s of statuses) {
    const status = s as Record<string, unknown>;
    const wamId = status.id as string;
    const waStatus = status.status as string; // sent, delivered, read, failed
    const externalId = `wam:${wamId}`;

    // Map WhatsApp status to outreach_log status
    let logStatus: string;
    switch (waStatus) {
      case 'sent':
        logStatus = 'sent';
        break;
      case 'delivered':
        logStatus = 'delivered';
        break;
      case 'read':
        logStatus = 'opened';
        break;
      case 'failed':
        logStatus = 'failed';
        break;
      default:
        logStatus = waStatus;
    }

    const result = await pool.query(
      `UPDATE outreach_logs SET status = $1, updated_at = NOW()
       WHERE external_msg_id = $2 AND status != $1
       RETURNING lead_id`,
      [logStatus, externalId],
    );

    if (result.rowCount && result.rowCount > 0) {
      logger.info('WhatsApp status updated', { wamId, waStatus, logStatus });
    }
  }

  return { action: 'status_updated', details: `Processed ${statuses.length} status updates` };
}

// ── Twilio ─────────────────────────────────────────────────────────────────

/**
 * Handle inbound Twilio SMS or delivery status callback.
 */
export async function handleTwilioMessage(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const from = payload.From as string;
  const body = payload.Body as string;
  const smsSid = payload.SmsSid as string;

  logger.info('Twilio inbound', { from, body: body?.slice(0, 100), smsSid });

  if (!from) {
    return { action: 'noop', details: 'No sender number' };
  }

  // Format phone to E.164 if needed
  const phone = from.startsWith('+') ? from : `+${from}`;

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
    [phone],
  );

  if (existing) {
    try {
      await pool.query(
        `UPDATE outreach_logs SET status = 'replied', replied_at = NOW(), updated_at = NOW()
         WHERE lead_id = $1 AND channel = 'sms' AND status NOT IN ('replied', 'failed')`,
        [existing.id],
      );
    } catch (error) {
      logger.error('Failed to persist Twilio SMS reply', {
        leadId: existing.id,
        phone,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await publishLeadReplyReceived(
      existing.id,
      'sms',
      smsSid ? `tw:${smsSid}` : 'unknown',
      body ?? '',
    );
    await stopAutomationForReply(existing.id);

    if (body) {
      void enqueueAiClassifyReply({
        leadId: existing.id,
        channel: 'sms',
        messageText: body,
        externalMessageId: smsSid ? `tw:${smsSid}` : undefined,
      }).catch((err: unknown) => {
        logger.warn('Twilio: failed to enqueue AI reply classification', {
          leadId: existing.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return { action: 'reply_recorded', leadId: existing.id, details: `SMS reply from ${phone}` };
  }

  let created: { id: string } | null;
  try {
    created = await queryOne<{ id: string }>(
      `INSERT INTO leads (business_name, contact_name, phone, source_platform, notes, status)
       VALUES ($1, $2, $3, 'sms_inbound', $4, 'active')
       RETURNING id`,
      [`SMS Lead ${phone.slice(-4)}`, `Contact ${phone.slice(-4)}`, phone, body ?? ''],
    );
  } catch (error) {
    logger.error('Failed to create lead from Twilio SMS', {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (created) {
    await publishLeadReplyReceived(
      created.id,
      'sms',
      smsSid ? `tw:${smsSid}` : 'unknown',
      body ?? '',
    );
  }

  return { action: 'lead_created', leadId: created?.id, details: `New lead from SMS ${phone}` };
}

/**
 * Handle Twilio delivery status callback.
 */
export async function handleTwilioStatus(payload: Record<string, unknown>): Promise<WebhookResult> {
  const messageSid = payload.MessageSid as string;
  const deliveryStatus = payload.MessageStatus as string; // delivered, failed, undelivered, etc.

  if (!messageSid) {
    return { action: 'noop', details: 'No MessageSid' };
  }

  let logStatus: string;
  switch (deliveryStatus) {
    case 'delivered':
      logStatus = 'delivered';
      break;
    case 'failed':
    case 'undelivered':
      logStatus = 'failed';
      break;
    case 'sent':
      logStatus = 'sent';
      break;
    default:
      logStatus = deliveryStatus;
  }

  await pool.query(
    `UPDATE outreach_logs SET status = $1, updated_at = NOW()
     WHERE external_msg_id = $2 AND status != $1`,
    [logStatus, `tw:${messageSid}`],
  );

  return { action: 'status_updated', details: `Twilio status: ${deliveryStatus}` };
}

// ── SendGrid ───────────────────────────────────────────────────────────────

/**
 * Handle SendGrid event webhook (array of events).
 * Events include: delivered, opened, clicked, bounced, dropped, unsubscribe.
 */
export async function handleSendGridEvents(events: unknown[]): Promise<WebhookResult> {
  if (!Array.isArray(events) || events.length === 0) {
    return { action: 'noop', details: 'No events' };
  }

  let updated = 0;
  for (const evt of events) {
    const event = evt as Record<string, unknown>;
    const sgMessageId = event.sg_message_id as string;
    const eventName = event.event as string; // delivered, open, click, bounce, dropped

    if (!sgMessageId || !eventName) continue;

    // SendGrid message IDs often include a dot-separated suffix
    const externalId = sgMessageId.includes('.') ? sgMessageId.split('.')[0] : sgMessageId;

    let logStatus: string;
    switch (eventName) {
      case 'delivered':
        logStatus = 'delivered';
        break;
      case 'open':
        logStatus = 'opened';
        break;
      case 'click':
        logStatus = 'replied';
        break;
      case 'bounce':
      case 'dropped':
        logStatus = 'failed';
        break;
      case 'unsubscribe':
        // Update lead status to opted_out
        {
          const optedOut = await pool.query<{ id: string }>(
            `UPDATE leads SET status = 'opted_out', updated_at = NOW()
             WHERE id = (SELECT lead_id FROM outreach_logs WHERE external_msg_id = $1 LIMIT 1)
             AND deleted_at IS NULL
             RETURNING id`,
            [`sg:${externalId}`],
          );
          for (const row of optedOut.rows) {
            await cancelPendingOutreachJobs({ leadId: row.id });
          }
        }
        logStatus = 'failed';
        break;
      default:
        logStatus = eventName;
    }

    const result = await pool.query(
      `UPDATE outreach_logs SET status = $1, updated_at = NOW()
       WHERE external_msg_id = $2 AND status != $1`,
      [logStatus, `sg:${externalId}`],
    );
    if (result.rowCount && result.rowCount > 0) updated++;
  }

  return {
    action: 'events_processed',
    details: `Processed ${events.length} events, updated ${updated} logs`,
  };
}

// ── Google Ads ─────────────────────────────────────────────────────────────

/**
 * Handle Google Ads lead form submission.
 * Creates or updates a lead from the form payload.
 */
export async function handleGoogleAdsLeadForm(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  logger.info('Google Ads lead form received', { payload });

  // Google Ads lead form payload typically contains:
  // { lead_id, form_id, google_key, api_version, user_column_data: [{column_name, string_value}] }
  const userColumnData = (payload.user_column_data as unknown[]) ?? [];
  const leadId = payload.lead_id as string;

  // Extract fields from column data
  const fields: Record<string, string> = {};
  for (const col of userColumnData) {
    const c = col as Record<string, unknown>;
    const name = c.column_name as string;
    const value = (c.string_value as string) ?? '';
    if (name) fields[name.toLowerCase()] = value;
  }

  const businessName =
    fields.business_name || fields.company || fields.businessname || 'Google Ads Lead';
  const contactName = fields.full_name || fields.name || fields.contact_name || businessName;
  const phone = fields.phone || fields.phone_number || '';
  const email = fields.email || fields.email_address || '';
  const location = fields.city || fields.location || fields.state || '';

  // Check for existing lead by email or phone within google_ads source
  const existing = email
    ? await queryOne<{ id: string }>(
        `SELECT id FROM leads WHERE source_platform = 'google_ads' AND email = $1 AND deleted_at IS NULL LIMIT 1`,
        [email.toLowerCase()],
      )
    : phone
      ? await queryOne<{ id: string }>(
          `SELECT id FROM leads WHERE source_platform = 'google_ads' AND phone = $1 AND deleted_at IS NULL LIMIT 1`,
          [phone],
        )
      : null;

  if (existing) {
    logger.info('Google Ads lead updated', { leadId: existing.id, googleLeadId: leadId });
    return {
      action: 'lead_updated',
      leadId: existing.id,
      details: `Existing lead updated from ${leadId}`,
    };
  }

  const created = await queryOne<{ id: string }>(
    `INSERT INTO leads (business_name, contact_name, phone, email, location, source_platform, status, notes)
     VALUES ($1, $2, $3, $4, $5, 'google_ads', 'active', $6)
     RETURNING id`,
    [
      businessName,
      contactName,
      phone || '',
      email || `${leadId}@googleads.local`,
      location,
      JSON.stringify(payload),
    ],
  );

  logger.info('Google Ads lead created', { leadId: created?.id, googleLeadId: leadId });
  return {
    action: 'lead_created',
    leadId: created?.id,
    details: `New lead from Google Ads ${leadId}`,
  };
}
