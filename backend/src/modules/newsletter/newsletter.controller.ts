import { AppError } from '../../shared/middleware/errorHandler';
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as newsletterService from './newsletter.service';
import { NewsletterSubscriberRow } from './newsletter.types';
import {
  addNewsletterContactsSchema,
  subscribeSchema,
  confirmQuerySchema,
  unsubscribeQuerySchema,
  preferencesQuerySchema,
  updatePreferencesBodySchema,
  listSubscribersQuerySchema,
  subscriberIdParamSchema,
  broadcastIdParamSchema,
  retryBroadcastBodySchema,
  broadcastBodySchema,
  automatedDigestToggleSchema,
  updateDigestConfigSchema,
  eligibleCountQuerySchema,
  testSendSchema,
  digestDraftSchema,
  digestAutoSendSchema,
} from './newsletter.schema';

/** Strips the persisted unsubscribe token hash before any admin-facing response. */
function toPublicSubscriber(
  row: NewsletterSubscriberRow,
): Omit<NewsletterSubscriberRow, 'unsubscribe_token_hash'> {
  const publicRow: Partial<NewsletterSubscriberRow> = { ...row };
  delete publicRow.unsubscribe_token_hash;
  return publicRow as Omit<NewsletterSubscriberRow, 'unsubscribe_token_hash'>;
}

// ── Public Handlers ──────────────────────────────────────────────────────

export async function subscribeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = subscribeSchema.parse(req.body);
    const result = await newsletterService.subscribe(
      body.email,
      body.topics ?? [],
      body.frequency ?? 'weekly',
      'website',
    );
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value, 201);
  } catch (err) {
    next(err);
  }
}

export async function confirmHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = confirmQuerySchema.parse(req.query);
    const result = await newsletterService.confirmSubscription(token);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function unsubscribeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = unsubscribeQuerySchema.parse(req.query);
    const result = await newsletterService.unsubscribe(token);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function getPreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = preferencesQuerySchema.parse(req.query);
    const result = await newsletterService.getPreferences(token);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function updatePreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = preferencesQuerySchema.parse(req.query);
    const body = updatePreferencesBodySchema.parse(req.body);
    const result = await newsletterService.updateSubscriberPreferences(token, body);
    if (!result.ok) throw result.error;
    sendSuccess(res, toPublicSubscriber(result.value));
  } catch (err) {
    next(err);
  }
}

// ── Admin Handlers ───────────────────────────────────────────────────────

export async function listSubscribersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSubscribersQuerySchema.parse(req.query);
    const result = await newsletterService.listSubscribers(
      query.limit,
      query.offset,
      query.status,
      {
        ...(query.search ? { search: query.search } : {}),
        ...(query.topic ? { topic: query.topic } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.frequency ? { frequency: query.frequency } : {}),
      },
    );
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value.items.map(toPublicSubscriber), 200, result.value.meta);
  } catch (err) {
    next(err);
  }
}

export async function getSubscriberHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = subscriberIdParamSchema.parse(req.params);
    const result = await newsletterService.getSubscriberById(id);
    if (!result.ok) throw result.error;
    sendSuccess(res, toPublicSubscriber(result.value));
  } catch (err) {
    next(err);
  }
}

export async function broadcastHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = broadcastBodySchema.parse(req.body);
    const result = await newsletterService.triggerBroadcast(
      body.subject,
      body.htmlBody,
      {
        subject: body.subject,
        htmlBody: body.htmlBody,
        ...(body.previewText ? { previewText: body.previewText } : {}),
        ...(body.topics ? { topics: body.topics } : {}),
        ...(body.frequency ? { frequency: body.frequency } : {}),
        ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}),
        ...(body.scheduledAtLocal ? { scheduledAtLocal: body.scheduledAtLocal } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
        ...(body.templateId ? { templateId: body.templateId } : {}),
      },
      req.user ? { id: req.user.id } : undefined,
    );
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value, 202);
  } catch (err) {
    next(err);
  }
}

export async function toggleAutomatedDigestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = automatedDigestToggleSchema.parse(req.body);
    const result = await newsletterService.toggleAutomatedDigest(body.enabled);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function getDigestConfigHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.getDigestConfig();
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function updateDigestConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = updateDigestConfigSchema.parse(req.body);
    const result = await newsletterService.updateDigestConfig(body);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function getSubscriberCountsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.getSubscriberCounts();
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function getEligibleCountHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = eligibleCountQuerySchema.parse(req.query);
    const result = await newsletterService.getEligibleRecipientCount({
      ...(query.topics ? { topics: query.topics } : {}),
      ...(query.frequency ? { frequency: query.frequency } : {}),
    });
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function testSendHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = testSendSchema.parse(req.body);
    const result = await newsletterService.sendNewsletterTest(
      body.to,
      body.subject,
      body.htmlBody,
      body.previewText,
    );
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function exportSubscribersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSubscribersQuerySchema.parse(req.query);
    // Export honours the same filters as the list view and pages through
    // every matching row — never silently truncated (cap breaches are an
    // explicit 422 from the service).
    const result = await newsletterService.exportSubscribersCsv({
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.topic ? { topic: query.topic } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.frequency ? { frequency: query.frequency } : {}),
    });
    if (!result.ok) throw result.error;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
    res.setHeader('X-Newsletter-Export-Total', String(result.value.total));
    res.status(200).send(result.value.csv);
  } catch (err) {
    next(err);
  }
}

export async function getDigestStatusHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.getDigestStatus();
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function getDigestDraftHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.getDigestDraft();
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function saveDigestDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = digestDraftSchema.parse(req.body);
    const result = await newsletterService.saveDigestDraft(body);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value, 201);
  } catch (err) {
    next(err);
  }
}

export async function approveDigestDraftHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.approveDigestDraft();
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value, 202);
  } catch (err) {
    next(err);
  }
}

export async function setDigestAutoSendHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = digestAutoSendSchema.parse(req.body);
    const result = await newsletterService.setDigestAutoSend(body.autoSend);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}

export async function listBroadcastsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await newsletterService.listBroadcastHistory(50);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value.items);
  } catch (err) {
    next(err);
  }
}

export async function retryBroadcastHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = broadcastIdParamSchema.parse(req.params);
    // Body is optional (backwards compatible): without `includeUncertain`,
    // only certain failures are retried — uncertain sends are never
    // auto-resent. Operators review them first, then opt in explicitly.
    const body = retryBroadcastBodySchema.parse(req.body ?? {});
    const result = await newsletterService.retryFailedRecipients(
      id,
      req.user ? { id: req.user.id } : undefined,
      { includeUncertain: body.includeUncertain },
    );
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value, 202);
  } catch (err) {
    next(err);
  }
}

export async function listUncertainRecipientsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = broadcastIdParamSchema.parse(req.params);
    const result = await newsletterService.listUncertainRecipients(id);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value.items);
  } catch (err) {
    next(err);
  }
}

export async function addNewsletterContactsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = addNewsletterContactsSchema.parse(req.body);
    if (!req.user) throw new AppError('Authentication required', 401);
    const result = await newsletterService.addNewsletterContacts(body, req.user);
    if (!result.ok) throw result.error;
    sendSuccess(res, result.value);
  } catch (err) {
    next(err);
  }
}
