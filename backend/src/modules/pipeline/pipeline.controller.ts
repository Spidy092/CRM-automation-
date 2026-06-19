import { Request, Response } from 'express';
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

export async function listPipelinesHandler(_req: Request, res: Response): Promise<void> {
  const pipelines = await getAllPipelines();
  res.json({ success: true, data: pipelines });
}

export async function getPipelineHandler(req: Request, res: Response): Promise<void> {
  const pipeline = await getPipelineById(req.params.id);
  res.json({ success: true, data: pipeline });
}

export async function createPipelineHandler(req: Request, res: Response): Promise<void> {
  const parsed = createPipelineSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const pipeline = await createPipeline(parsed, actor);
  res.status(201).json({ success: true, data: pipeline });
}

export async function updatePipelineHandler(req: Request, res: Response): Promise<void> {
  const parsed = updatePipelineSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const pipeline = await updatePipelineById(req.params.id, parsed, actor);
  res.json({ success: true, data: pipeline });
}

export async function deletePipelineHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await deletePipelineById(req.params.id, actor);
  res.status(204).send();
}

export async function listStagesHandler(req: Request, res: Response): Promise<void> {
  const stages = await getStages(req.params.pipelineId);
  res.json({ success: true, data: stages });
}

export async function createStageHandler(req: Request, res: Response): Promise<void> {
  const parsed = createStageSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const stage = await createStage(req.params.pipelineId, parsed, actor);
  res.status(201).json({ success: true, data: stage });
}

export async function updateStageHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateStageSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const stage = await updateStageById(req.params.id, parsed, actor);
  res.json({ success: true, data: stage });
}

export async function deleteStageHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await deleteStageById(req.params.id, actor);
  res.status(204).send();
}

export async function moveLeadHandler(req: Request, res: Response): Promise<void> {
  const parsed = moveLeadSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await moveLead(parsed.lead_id, parsed.stage_id, actor);
  res.json({ success: true, data: { message: 'Lead moved successfully' } });
}
