/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- TODO: refactor away from `any` casts (legacy debt) */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as abTestService from './ab-testing.service';
import {
  createVariantSchema,
  updateVariantSchema,
  campaignIdParamSchema,
  variantIdParamSchema,
} from './ab-testing.schema';

function actorFromReq(req: Request) {
  const user = (req as any).user;
  return { id: user.id, role: user.role, ipAddress: req.ip };
}

// ── Variant CRUD ──────────────────────────────────────────────────────────

export async function listVariantsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { campaignId } = campaignIdParamSchema.parse(req.params);
    const variants = await abTestService.listVariants(campaignId);
    sendSuccess(res, variants);
  } catch (err) {
    next(err);
  }
}

export async function getVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = variantIdParamSchema.parse(req.params);
    const variant = await abTestService.getVariant(variantId);
    sendSuccess(res, variant);
  } catch (err) {
    next(err);
  }
}

export async function createVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { campaignId } = campaignIdParamSchema.parse(req.params);
    const body = createVariantSchema.parse(req.body);
    const actor = actorFromReq(req);
    const variant = await abTestService.createVariant(campaignId, body, actor);
    sendSuccess(res, variant, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = variantIdParamSchema.parse(req.params);
    const body = updateVariantSchema.parse(req.body);
    const actor = actorFromReq(req);
    const variant = await abTestService.updateVariantById(variantId, body, actor);
    sendSuccess(res, variant);
  } catch (err) {
    next(err);
  }
}

export async function deleteVariantHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = variantIdParamSchema.parse(req.params);
    const actor = actorFromReq(req);
    await abTestService.deleteVariantById(variantId, actor);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Reports ───────────────────────────────────────────────────────────────

export async function getABTestReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { campaignId } = campaignIdParamSchema.parse(req.params);
    const report = await abTestService.getABTestReport(campaignId);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function getVariantResultsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { variantId } = variantIdParamSchema.parse(req.params);
    const results = await abTestService.getVariantResults(variantId);
    sendSuccess(res, results);
  } catch (err) {
    next(err);
  }
}

export async function promoteWinnerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { campaignId } = campaignIdParamSchema.parse(req.params);
    const winner = await abTestService.checkAndPromoteWinner(campaignId);
    sendSuccess(res, { promoted: !!winner, winner });
  } catch (err) {
    next(err);
  }
}

export async function recordSnapshotsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { campaignId } = campaignIdParamSchema.parse(req.params);
    await abTestService.recordVariantSnapshots(campaignId);
    sendSuccess(res, { recorded: true });
  } catch (err) {
    next(err);
  }
}
