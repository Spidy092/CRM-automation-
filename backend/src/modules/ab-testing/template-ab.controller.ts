/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- TODO: refactor away from `any` casts (legacy debt) */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as templateAbService from './template-ab.service';
import {
  createTemplateVariantSchema,
  updateTemplateVariantSchema,
  templateIdParamSchema,
  templateVariantIdParamSchema,
} from './template-ab.schema';

function actorFromReq(req: Request) {
  const user = (req as any).user;
  return { id: user.id, role: user.role, ipAddress: req.ip };
}

export async function listTemplateVariantsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const variants = await templateAbService.listTemplateVariants(templateId);
    sendSuccess(res, variants);
  } catch (err) {
    next(err);
  }
}

export async function getTemplateVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = templateVariantIdParamSchema.parse(req.params);
    const variant = await templateAbService.getTemplateVariant(variantId);
    sendSuccess(res, variant);
  } catch (err) {
    next(err);
  }
}

export async function createTemplateVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const body = createTemplateVariantSchema.parse(req.body);
    const actor = actorFromReq(req);
    const variant = await templateAbService.createTemplateVariant(templateId, body, actor);
    sendSuccess(res, variant, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateTemplateVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = templateVariantIdParamSchema.parse(req.params);
    const body = updateTemplateVariantSchema.parse(req.body);
    const actor = actorFromReq(req);
    const variant = await templateAbService.updateTemplateVariantById(variantId, body, actor);
    sendSuccess(res, variant);
  } catch (err) {
    next(err);
  }
}

export async function deleteTemplateVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = templateVariantIdParamSchema.parse(req.params);
    const actor = actorFromReq(req);
    await templateAbService.deleteTemplateVariantById(variantId, actor);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getTemplateABTestReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const report = await templateAbService.getTemplateABTestReport(templateId);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function getTemplateVariantResultsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = templateVariantIdParamSchema.parse(req.params);
    const results = await templateAbService.getTemplateVariantResults(variantId);
    sendSuccess(res, results);
  } catch (err) {
    next(err);
  }
}

export async function promoteTemplateWinnerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const winner = await templateAbService.checkAndPromoteTemplateWinner(templateId);
    sendSuccess(res, { promoted: !!winner, winner });
  } catch (err) {
    next(err);
  }
}
