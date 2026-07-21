import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { resolveStageOutcome } from '../../shared/utils/leadOutcome';
import { enqueueLeadEvent } from '../../workers/queue';
import { findLeadById, updateLeadOutcome } from '../leads/leads.repository';
import { insertActivity } from '../activities/activities.repository';
import {
  findPipelines,
  findPipelineById,
  findPipelineWithStages,
  insertPipeline,
  updatePipeline,
  deletePipeline,
  insertStage,
  updateStage,
  deleteStage,
  findStagesByPipeline,
  findStageById,
  moveLeadToStage,
  findDefaultPipeline,
} from './pipeline.repository';
import {
  CreatePipelineInput,
  UpdatePipelineInput,
  CreateStageInput,
  UpdateStageInput,
  Pipeline,
  PipelineStage,
  PipelineWithStages,
} from './pipeline.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export async function getAllPipelines(): Promise<PipelineWithStages[]> {
  return findPipelines();
}

export async function getPipelineById(id: string): Promise<PipelineWithStages> {
  const pipeline = await findPipelineWithStages(id);
  if (!pipeline) {
    throw new AppError('Pipeline not found', 404);
  }
  return pipeline;
}

export async function createPipeline(
  input: CreatePipelineInput,
  actor: Actor,
): Promise<PipelineWithStages> {
  const pipeline = await insertPipeline(input.name, input.is_default ?? false, actor.id);

  for (const stage of input.stages) {
    await insertStage(
      pipeline.id,
      stage.name,
      stage.position,
      stage.is_terminal_won ?? false,
      stage.is_terminal_lost ?? false,
    );
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline.created',
    entityType: 'pipeline',
    entityId: pipeline.id,
    newValue: { name: pipeline.name, stages: input.stages },
    ipAddress: actor.ipAddress ?? null,
  });

  return findPipelineWithStages(pipeline.id) as Promise<PipelineWithStages>;
}

export async function updatePipelineById(
  id: string,
  input: UpdatePipelineInput,
  actor: Actor,
): Promise<Pipeline> {
  const existing = await findPipelineById(id);
  if (!existing) {
    throw new AppError('Pipeline not found', 404);
  }

  const updated = await updatePipeline(id, input);

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline.updated',
    entityType: 'pipeline',
    entityId: id,
    oldValue: existing,
    newValue: updated,
    ipAddress: actor.ipAddress ?? null,
  });

  return updated;
}

export async function deletePipelineById(id: string, actor: Actor): Promise<void> {
  const existing = await findPipelineById(id);
  if (!existing) {
    throw new AppError('Pipeline not found', 404);
  }

  if (existing.is_default) {
    throw new AppError('Cannot delete the default pipeline', 400);
  }

  await deletePipeline(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline.deleted',
    entityType: 'pipeline',
    entityId: id,
    oldValue: existing,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function getStages(pipelineId: string): Promise<PipelineStage[]> {
  const pipeline = await findPipelineById(pipelineId);
  if (!pipeline) {
    throw new AppError('Pipeline not found', 404);
  }
  return findStagesByPipeline(pipelineId);
}

export async function createStage(
  pipelineId: string,
  input: CreateStageInput,
  actor: Actor,
): Promise<PipelineStage> {
  const pipeline = await findPipelineById(pipelineId);
  if (!pipeline) {
    throw new AppError('Pipeline not found', 404);
  }

  const stage = await insertStage(
    pipelineId,
    input.name,
    input.position,
    input.is_terminal_won ?? false,
    input.is_terminal_lost ?? false,
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline_stage.created',
    entityType: 'pipeline_stage',
    entityId: stage.id,
    newValue: { pipeline_id: pipelineId, ...input },
    ipAddress: actor.ipAddress ?? null,
  });

  return stage;
}

export async function updateStageById(
  id: string,
  input: UpdateStageInput,
  actor: Actor,
): Promise<PipelineStage> {
  const existing = await findStageById(id);
  if (!existing) {
    throw new AppError('Pipeline stage not found', 404);
  }

  const updated = await updateStage(id, input);

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline_stage.updated',
    entityType: 'pipeline_stage',
    entityId: id,
    oldValue: existing,
    newValue: updated,
    ipAddress: actor.ipAddress ?? null,
  });

  return updated;
}

export async function deleteStageById(id: string, actor: Actor): Promise<void> {
  const existing = await findStageById(id);
  if (!existing) {
    throw new AppError('Pipeline stage not found', 404);
  }

  await deleteStage(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'pipeline_stage.deleted',
    entityType: 'pipeline_stage',
    entityId: id,
    oldValue: existing,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function moveLead(leadId: string, stageId: string, actor: Actor): Promise<void> {
  const stage = await findStageById(stageId);
  if (!stage) {
    throw new AppError('Pipeline stage not found', 404);
  }

  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  if (actor.role === 'sales' && lead.assigned_to !== actor.id) {
    throw new AppError('Forbidden', 403);
  }

  await moveLeadToStage(leadId, stageId);

  await writeAuditLog({
    userId: actor.id,
    action: 'lead.stage_moved',
    entityType: 'lead',
    entityId: leadId,
    newValue: { pipeline_stage_id: stageId },
    ipAddress: actor.ipAddress ?? null,
  });

  // Deals moved into (or out of) a Closed Won/Lost stage carry their outcome
  // automatically — see resolveStageOutcome() for the exact rules.
  const outcome = resolveStageOutcome(lead.status, stage);
  if (outcome) {
    await updateLeadOutcome(leadId, outcome);
    await insertActivity({
      lead_id: leadId,
      user_id: actor.id,
      type: 'status_change',
      metadata: { field: 'status', from: lead.status, to: outcome, reason: 'pipeline_stage_move' },
    });
  }

  void enqueueLeadEvent({
    event: 'lead.stage_moved',
    leadId,
    payload: { fromStageId: null, toStageId: stageId, pipelineId: stage.pipeline_id },
  });
}

export async function getDefaultPipeline(): Promise<Pipeline | null> {
  return findDefaultPipeline();
}
