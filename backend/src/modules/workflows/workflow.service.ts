import { workflowDefinitionSchema } from './workflow.schema';
import type { WorkflowDefinition, WorkflowValidationIssue } from './workflow.types';
import { validateWorkflowDefinition } from './workflow.engine';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  findWorkflowById,
  findWorkflows,
  insertWorkflow,
  publishWorkflow as publishWorkflowRecord,
  replayFailedEnrollment,
  updateWorkflowStatus,
} from './workflow.repository';
import { AppError } from '../../shared/middleware/errorHandler';
import type { CreateWorkflowInput } from './workflow.schema';
import type { WorkflowDetail } from './workflow.types';
import type { WorkflowEnrollmentRow } from './workflow.types';
import { enqueueWorkflowExecution } from '../../workers/queue';

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

/** Validate a workflow at the API boundary and then validate graph invariants. */
export function validateWorkflow(input: unknown): WorkflowValidationResult {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'workflow',
        message: issue.message,
      })),
    };
  }

  const issues = validateWorkflowDefinition(parsed.data as WorkflowDefinition);
  return { valid: issues.length === 0, issues };
}

export async function listWorkflows(): Promise<WorkflowDetail[]> {
  return findWorkflows();
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  const workflow = await findWorkflowById(id);
  if (!workflow) throw new AppError('Workflow not found', 404);
  return workflow;
}

export async function createWorkflow(
  input: CreateWorkflowInput,
  actor: { id: string; ipAddress?: string | null },
): Promise<WorkflowDetail> {
  if (input.definition.name !== input.name) {
    throw new AppError('Definition name must match workflow name', 422);
  }
  const validation = validateWorkflow(input.definition);
  if (!validation.valid) {
    throw new AppError(
      `Invalid workflow definition: ${validation.issues[0]?.message ?? 'unknown error'}`,
      422,
    );
  }
  const created = await insertWorkflow({ ...input, createdBy: actor.id });
  await writeAuditLog({
    userId: actor.id,
    action: 'workflow.created',
    entityType: 'workflow',
    entityId: created.id,
    newValue: created,
    ipAddress: actor.ipAddress ?? null,
  });
  return created;
}

export async function publishWorkflow(
  id: string,
  actor: { id: string; ipAddress?: string | null },
): Promise<WorkflowDetail> {
  const existing = await getWorkflow(id);
  if (existing.status !== 'draft') {
    throw new AppError('Only draft workflows can be published', 400);
  }
  const definition = existing.current_version?.definition;
  if (!definition) throw new AppError('Workflow has no definition to publish', 400);
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    throw new AppError(
      `Invalid workflow definition: ${validation.issues[0]?.message ?? 'unknown error'}`,
      422,
    );
  }
  const published = await publishWorkflowRecord(id);
  await writeAuditLog({
    userId: actor.id,
    action: 'workflow.published',
    entityType: 'workflow',
    entityId: id,
    oldValue: existing,
    newValue: published,
    ipAddress: actor.ipAddress ?? null,
  });
  return published;
}

export async function pauseWorkflow(
  id: string,
  actor: { id: string; ipAddress?: string | null },
): Promise<WorkflowDetail> {
  const existing = await getWorkflow(id);
  if (existing.status !== 'published') {
    throw new AppError('Only published workflows can be paused', 400);
  }
  const paused = await updateWorkflowStatus(id, 'paused');
  await writeAuditLog({
    userId: actor.id,
    action: 'workflow.paused',
    entityType: 'workflow',
    entityId: id,
    oldValue: existing,
    newValue: paused,
    ipAddress: actor.ipAddress ?? null,
  });
  return paused;
}

export async function resumeWorkflow(
  id: string,
  actor: { id: string; ipAddress?: string | null },
): Promise<WorkflowDetail> {
  const existing = await getWorkflow(id);
  if (existing.status !== 'paused') {
    throw new AppError('Only paused workflows can be resumed', 400);
  }
  const resumed = await updateWorkflowStatus(id, 'published');
  await writeAuditLog({
    userId: actor.id,
    action: 'workflow.resumed',
    entityType: 'workflow',
    entityId: id,
    oldValue: existing,
    newValue: resumed,
    ipAddress: actor.ipAddress ?? null,
  });
  return resumed;
}

/** Requeues a failed workflow run from its current node after operator approval. */
export async function replayWorkflowEnrollment(
  enrollmentId: string,
  actor: { id: string; ipAddress?: string | null },
): Promise<WorkflowEnrollmentRow> {
  const replayed = await replayFailedEnrollment(enrollmentId);
  if (!replayed) {
    throw new AppError('Only failed workflow runs can be replayed', 400);
  }

  // The database state is already due, so the scheduler remains a recovery
  // path if Redis is temporarily unavailable after this request commits.
  try {
    await enqueueWorkflowExecution(
      { enrollmentId: replayed.id },
      { jobIdSuffix: `replay-${replayed.lock_version}` },
    );
  } catch (err) {
    logger.warn('Failed to enqueue workflow replay job directly; scheduler will pick it up', {
      enrollmentId: replayed.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await writeAuditLog({
    userId: actor.id,
    action: 'workflow.enrollment_replayed',
    entityType: 'workflow_enrollment',
    entityId: replayed.id,
    newValue: replayed,
    ipAddress: actor.ipAddress ?? null,
  });
  return replayed;
}
