import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import {
  getAllCampaigns,
  getCampaignById,
  getCampaignAutomationPreview,
  createCampaign,
  updateCampaignById,
  deleteCampaignById,
  launchCampaignById,
  pauseCampaignById,
  resumeCampaignById,
  addLeads,
  removeLead,
  getCampaignLeads,
  getStats,
  retryLeadOutreachStep,
} from './campaigns.service';
import { createCampaignSchema, updateCampaignSchema, addLeadsSchema } from './campaigns.schema';

function actorFromReq(req: Request) {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, role: req.user.role, ipAddress: req.ip ?? null };
}

export async function listCampaignsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaigns = await getAllCampaigns();
    sendSuccess(res, campaigns);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaign = await getCampaignById(req.params.id);
    sendSuccess(res, campaign);
  } catch (err) {
    next(err);
  }
}

export async function createCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createCampaignSchema.parse(req.body);
    const campaign = await createCampaign(parsed, actorFromReq(req));
    sendSuccess(res, campaign, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateCampaignSchema.parse(req.body);
    const campaign = await updateCampaignById(req.params.id, parsed, actorFromReq(req));
    sendSuccess(res, campaign);
  } catch (err) {
    next(err);
  }
}

export async function deleteCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteCampaignById(req.params.id, actorFromReq(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function automationPreviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const preview = await getCampaignAutomationPreview(req.params.id);
    sendSuccess(res, preview);
  } catch (err) {
    next(err);
  }
}

export async function launchCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await launchCampaignById(req.params.id, actorFromReq(req));
    sendSuccess(res, result.campaign, 200, { automation: result.automation });
  } catch (err) {
    next(err);
  }
}

export async function pauseCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaign = await pauseCampaignById(req.params.id, actorFromReq(req));
    sendSuccess(res, campaign);
  } catch (err) {
    next(err);
  }
}

export async function resumeCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaign = await resumeCampaignById(req.params.id, actorFromReq(req));
    sendSuccess(res, campaign);
  } catch (err) {
    next(err);
  }
}

export async function addLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = addLeadsSchema.parse(req.body);
    const result = await addLeads(req.params.id, parsed.lead_ids, actorFromReq(req));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function removeLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await removeLead(req.params.id, req.params.leadId, actorFromReq(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listCampaignLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leadIds = await getCampaignLeads(req.params.id);
    sendSuccess(res, leadIds);
  } catch (err) {
    next(err);
  }
}

export async function retryLeadOutreachStepHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await retryLeadOutreachStep(req.params.id, req.params.leadId, actorFromReq(req));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getStats(req.params.id);
    sendSuccess(res, stats);
  } catch (err) {
    next(err);
  }
}
