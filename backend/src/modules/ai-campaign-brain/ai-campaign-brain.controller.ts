import type { Request, Response, NextFunction } from 'express';
import { campaignIdParamSchema } from './ai-campaign-brain.schema';
import {
  getCampaignBrief,
  approveCampaignBrief,
  rejectCampaignBrief,
} from './ai-campaign-brain.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';

/** GET /ai-campaign-brain/campaigns/:campaignId/brief */
export async function getBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = campaignIdParamSchema.safeParse(req.params);
    if (!params.success) throw new AppError(params.error.message, 400);

    const brief = await getCampaignBrief(params.data.campaignId);
    if (!brief) throw new AppError(`Campaign brief not found: ${params.data.campaignId}`, 404);

    res.json(successResponse(brief));
  } catch (err) {
    next(err);
  }
}

/** POST /ai-campaign-brain/campaigns/:campaignId/brief/approve */
export async function approveBriefHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.safeParse(req.params);
    if (!params.success) throw new AppError(params.error.message, 400);

    const brief = await approveCampaignBrief(params.data.campaignId, req.user!.id);
    res.json(successResponse(brief));
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      next(new AppError(err.message, 404));
    } else {
      next(err);
    }
  }
}

/** POST /ai-campaign-brain/campaigns/:campaignId/brief/reject */
export async function rejectBriefHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.safeParse(req.params);
    if (!params.success) throw new AppError(params.error.message, 400);

    const brief = await rejectCampaignBrief(params.data.campaignId);
    res.json(successResponse(brief));
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      next(new AppError(err.message, 404));
    } else {
      next(err);
    }
  }
}
