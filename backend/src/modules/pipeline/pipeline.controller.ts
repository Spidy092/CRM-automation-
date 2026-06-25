import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import {
  getAllPipelines,
  getPipelineById,
  createPipeline,
  updatePipelineById,
  deletePipelineById,
  getStages,
  createStage,
  updateStageById,
  deleteStageById,
  moveLead,
} from './pipeline.service';
import {
  createPipelineSchema,
  updatePipelineSchema,
  createStageSchema,
  updateStageSchema,
  moveLeadSchema,
} from './pipeline.schema';

function actorFromReq(req: Request) {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, role: req.user.role, ipAddress: req.ip ?? null };
}

export async function listPipelinesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pipelines = await getAllPipelines();
    sendSuccess(res, pipelines);
  } catch (err) {
    next(err);
  }
}

export async function getPipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const pipeline = await getPipelineById(req.params.id);
    sendSuccess(res, pipeline);
  } catch (err) {
    next(err);
  }
}

export async function createPipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createPipelineSchema.parse(req.body);
    const pipeline = await createPipeline(parsed, actorFromReq(req));
    sendSuccess(res, pipeline, 201);
  } catch (err) {
    next(err);
  }
}

export async function updatePipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updatePipelineSchema.parse(req.body);
    const pipeline = await updatePipelineById(req.params.id, parsed, actorFromReq(req));
    sendSuccess(res, pipeline);
  } catch (err) {
    next(err);
  }
}

export async function deletePipelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deletePipelineById(req.params.id, actorFromReq(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listStagesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stages = await getStages(req.params.pipelineId);
    sendSuccess(res, stages);
  } catch (err) {
    next(err);
  }
}

export async function createStageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createStageSchema.parse(req.body);
    const stage = await createStage(req.params.pipelineId, parsed, actorFromReq(req));
    sendSuccess(res, stage, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateStageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateStageSchema.parse(req.body);
    const stage = await updateStageById(req.params.id, parsed, actorFromReq(req));
    sendSuccess(res, stage);
  } catch (err) {
    next(err);
  }
}

export async function deleteStageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteStageById(req.params.id, actorFromReq(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function moveLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = moveLeadSchema.parse(req.body);
    await moveLead(parsed.lead_id, parsed.stage_id, actorFromReq(req));
    sendSuccess(res, { message: 'Lead moved successfully' });
  } catch (err) {
    next(err);
  }
}
