import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as newsletterService from './newsletter.service';
import { NewsletterSubscriberRow } from './newsletter.types';
import {
  subscribeSchema,
  confirmQuerySchema,
  unsubscribeQuerySchema,
  preferencesQuerySchema,
  updatePreferencesBodySchema,
  listSubscribersQuerySchema,
  subscriberIdParamSchema,
  broadcastBodySchema,
  automatedDigestToggleSchema,
  updateDigestConfigSchema,
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
    const result = await newsletterService.listSubscribers(query.limit, query.offset, query.status);
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
    const result = await newsletterService.triggerBroadcast(body.subject, body.htmlBody);
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

