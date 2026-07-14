/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- TODO: refactor away from `any` casts (legacy debt) */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as formsService from './forms.service';
import {
  createFormSchema,
  updateFormSchema,
  formIdParamSchema,
  submitFormBodySchema,
  listFormsQuerySchema,
} from './forms.schema';

function actorFromReq(req: Request) {
  const user = (req as any).user;
  return { id: user.id, role: user.role, ipAddress: req.ip };
}

// ── Admin CRUD Handlers ───────────────────────────────────────────────────

export async function listFormsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listFormsQuerySchema.parse(req.query);
    const result = await formsService.listForms(query.limit, query.offset);
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const form = await formsService.getForm(formId);
    sendSuccess(res, form);
  } catch (err) {
    next(err);
  }
}

export async function createFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createFormSchema.parse(req.body);
    const actor = actorFromReq(req);
    const form = await formsService.createForm(body, actor);
    sendSuccess(res, form, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const body = updateFormSchema.parse(req.body);
    const actor = actorFromReq(req);
    const form = await formsService.updateFormById(formId, body, actor);
    sendSuccess(res, form);
  } catch (err) {
    next(err);
  }
}

export async function deleteFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const actor = actorFromReq(req);
    await formsService.deleteFormById(formId, actor);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getFormAnalyticsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const actor = actorFromReq(req);
    const analytics = await formsService.getFormAnalyticsById(formId, actor);
    sendSuccess(res, analytics);
  } catch (err) {
    next(err);
  }
}

export async function getEmbedSnippetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const form = await formsService.getForm(formId);
    const baseUrl =
      process.env.APP_BASE_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const snippet = formsService.generateEmbedSnippet(form, baseUrl);
    sendSuccess(res, { snippet, formId: form.id, slug: form.slug });
  } catch (err) {
    next(err);
  }
}

// ── Public Handlers ───────────────────────────────────────────────────────

export async function getPublicFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { slug } = req.params;
    const form = await formsService.getFormBySlug(slug);
    // Return minimal form data for rendering (no auth needed)
    sendSuccess(res, {
      id: form.id,
      name: form.name,
      description: form.description,
      fields: form.fields,
      submitMessage: form.submit_message,
      theme: form.theme,
    });
  } catch (err) {
    next(err);
  }
}

export async function submitFormHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { formId } = formIdParamSchema.parse(req.params);
    const body = submitFormBodySchema.parse(req.body);
    const result = await formsService.submitForm(formId, body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
      referrer: (req.headers.referer as string) ?? (req.headers.referrer as string) ?? undefined,
    });
    sendSuccess(
      res,
      {
        message: result.message,
        leadId: result.leadId,
        redirectUrl: result.redirectUrl,
      },
      201,
    );
  } catch (err) {
    next(err);
  }
}
