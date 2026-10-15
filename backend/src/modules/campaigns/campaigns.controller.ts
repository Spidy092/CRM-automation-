import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import {
  getCampaignEnrollmentOptions,
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
  getStepStats,
  retryLeadOutreachStep,
} from './campaigns.service';
import {
  enrollmentOptionsQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
  addLeadsSchema,
  campaignIdParamSchema,
  campaignLeadParamSchema,
  operationsSummaryQuerySchema,
  scheduleQuerySchema,
  activityQuerySchema,
  enrollmentsQuerySchema,
  pauseEnrollmentSchema,
  resumeEnrollmentSchema,
} from './campaigns.schema';
import {
  getCampaignOperations,
  getCampaignSchedule,
  getCampaignActivity,
  getCampaignEnrollments,
  pauseCampaignEnrollment,
  resumeCampaignEnrollment,
  getCampaignsSummary,
} from './campaigns.operations.service';

function actorFromReq(req: Request) {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, role: req.user.role, ipAddress: req.ip ?? null };
}

export async function listCampaignsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pipeline_id = req.query?.pipeline_id as string | undefined;
    const campaigns = await getAllCampaigns({ pipeline_id });
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
    const result = await pauseCampaignById(req.params.id, actorFromReq(req));
    // data stays the campaign for compatibility; operational counts ride in meta.
    sendSuccess(res, result.campaign, 200, { operations: result.operations });
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
    const result = await resumeCampaignById(req.params.id, actorFromReq(req));
    sendSuccess(res, result.campaign, 200, { operations: result.operations });
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

export async function getCampaignStepStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getStepStats(req.params.id);
    sendSuccess(res, stats);
  } catch (err) {
    next(err);
  }
}

export async function enrollmentOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    enrollmentOptionsQuerySchema.parse(req.query);
    sendSuccess(res, await getCampaignEnrollmentOptions());
  } catch (err) {
    next(err);
  }
}

export async function getCampaignOperationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.parse(req.params);
    const overview = await getCampaignOperations(params.id, actorFromReq(req));
    sendSuccess(res, overview);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignScheduleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.parse(req.params);
    const query = scheduleQuerySchema.parse(req.query);
    const schedule = await getCampaignSchedule(params.id, actorFromReq(req), {
      limit: query.limit ?? 25,
      includeProjected: query.includeProjected,
    });
    sendSuccess(res, schedule);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignActivityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.parse(req.params);
    const query = activityQuerySchema.parse(req.query);
    const activity = await getCampaignActivity(params.id, actorFromReq(req), {
      limit: query.limit ?? 25,
      cursor: query.cursor,
    });
    sendSuccess(res, activity.items, 200, {
      hasMore: activity.meta.hasMore,
      nextCursor: activity.meta.nextCursor ?? undefined,
    });
  } catch (err) {
    next(err);
  }
}

export async function listCampaignEnrollmentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignIdParamSchema.parse(req.params);
    const query = enrollmentsQuerySchema.parse(req.query);
    const page = await getCampaignEnrollments(params.id, actorFromReq(req), {
      limit: query.limit ?? 25,
      cursor: query.cursor,
      enrollmentStatus: query.enrollmentStatus,
      search: query.search,
    });
    sendSuccess(res, page.items, 200, {
      hasMore: page.meta.hasMore,
      nextCursor: page.meta.nextCursor ?? undefined,
    });
  } catch (err) {
    next(err);
  }
}

export async function pauseCampaignEnrollmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignLeadParamSchema.parse(req.params);
    const body = pauseEnrollmentSchema.parse(req.body);
    const status = await pauseCampaignEnrollment(params.id, params.leadId, actorFromReq(req), body);
    sendSuccess(res, { enrollmentStatus: status });
  } catch (err) {
    next(err);
  }
}

export async function resumeCampaignEnrollmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = campaignLeadParamSchema.parse(req.params);
    const body = resumeEnrollmentSchema.parse(req.body);
    const result = await resumeCampaignEnrollment(
      params.id,
      params.leadId,
      actorFromReq(req),
      body,
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignsSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = operationsSummaryQuerySchema.parse(req.query);
    const summary = await getCampaignsSummary(query.ids, actorFromReq(req));
    sendSuccess(res, summary);
  } catch (err) {
    next(err);
  }
}
