import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  enqueueWorkflowExecution,
  getBullConnection,
  WORKFLOW_EXECUTE_ENROLLMENT,
  WORKFLOW_QUEUE,
  type WorkflowExecuteEnrollmentJob,
} from './queue';
import {
  advanceEnrollment,
  claimEnrollmentById,
  findDueEnrollmentIds,
  findEnrollmentExecutionById,
  finishStepAndAdvance,
  recordStepRun,
} from '../modules/workflows/workflow.repository';
import {
  evaluateWorkflowCondition,
  resolveWorkflowNextNode,
  validateWorkflowDefinition,
} from '../modules/workflows/workflow.engine';
import { executeWorkflowAction, WorkflowActionError } from '../modules/workflows/workflow.actions';
import type { WorkflowNode } from '../modules/workflows/workflow.types';
import { logger } from '../shared/utils/logger';
import { incJobsFailed, incJobsProcessed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';

const MAX_NODES_PER_JOB = 20;
const MAX_STEP_ATTEMPTS = 3;
const WORKFLOW_RETRY_BASE_DELAY_MS = 2_000;
const WORKFLOW_RETRY_MAX_DELAY_MS = 5 * 60_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

function recoveryJobSuffix(): string {
  return `recovery-${Math.floor(Date.now() / DEFAULT_SWEEP_INTERVAL_MS)}`;
}

type ClaimedEnrollment = NonNullable<Awaited<ReturnType<typeof claimEnrollmentById>>>;
type StepRun = Awaited<ReturnType<typeof recordStepRun>>;

function workerIdFor(job: Job<WorkflowExecuteEnrollmentJob>): string {
  return `workflow-${process.pid}-${job.id ?? 'unknown'}`.slice(0, 100);
}

function nodeMap(nodes: WorkflowNode[]): Map<string, WorkflowNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function nextRunAt(minutes: number, now = new Date()): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function retryRunAt(attempt: number, now = new Date()): string {
  const exponent = Math.max(0, attempt - 1);
  const delayMs = Math.min(
    WORKFLOW_RETRY_MAX_DELAY_MS,
    WORKFLOW_RETRY_BASE_DELAY_MS * 2 ** exponent,
  );
  return new Date(now.getTime() + delayMs).toISOString();
}

function isRetryableWorkflowError(error: unknown): boolean {
  if (error instanceof WorkflowActionError) return false;
  if (error && typeof error === 'object' && 'isAppError' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return (
      statusCode === 409 ||
      statusCode === 429 ||
      (typeof statusCode === 'number' && statusCode >= 500)
    );
  }
  return true;
}

async function markFailure(
  enrollment: ClaimedEnrollment | null,
  workerId: string,
  message: string,
): Promise<void> {
  if (!enrollment) return;
  await advanceEnrollment({
    id: enrollment.id,
    lockVersion: enrollment.lock_version,
    workerId,
    currentNodeId: enrollment.current_node_id,
    status: 'failed',
    lastError: message,
    finishedAt: new Date().toISOString(),
  });
}

/** Repairs an enrollment where a prior process already finalized its step. */
async function resumeFinishedStep(
  enrollment: ClaimedEnrollment,
  node: WorkflowNode,
  step: StepRun,
  workerId: string,
): Promise<{ enrollment: ClaimedEnrollment | null; status: string }> {
  if (step.status === 'failed' || step.status === 'cancelled') {
    await markFailure(enrollment, workerId, step.error_message ?? 'Workflow step failed');
    return { enrollment: null, status: 'failed' };
  }

  if (node.type === 'wait') {
    const waiting = await advanceEnrollment({
      id: enrollment.id,
      lockVersion: enrollment.lock_version,
      workerId,
      currentNodeId: node.next[0] ?? node.id,
      status: 'waiting',
      nextRunAt: enrollment.next_run_at ?? nextRunAt(node.waitMinutes ?? 1),
    });
    return { enrollment: waiting, status: waiting ? 'waiting' : 'lease_lost' };
  }

  if (node.type === 'end' || (node.type === 'goal' && step.result?.goalMet === true)) {
    const completed = await advanceEnrollment({
      id: enrollment.id,
      lockVersion: enrollment.lock_version,
      workerId,
      currentNodeId: node.id,
      status: 'completed',
      finishedAt: new Date().toISOString(),
    });
    return { enrollment: completed, status: completed ? 'completed' : 'lease_lost' };
  }

  if (node.type === 'goal' && node.next.length === 0) {
    const exited = await advanceEnrollment({
      id: enrollment.id,
      lockVersion: enrollment.lock_version,
      workerId,
      currentNodeId: node.id,
      status: 'exited',
      finishedAt: new Date().toISOString(),
    });
    return { enrollment: exited, status: exited ? 'exited' : 'lease_lost' };
  }

  const nextNodeId = resolveWorkflowNextNode(node, enrollment.context);
  if (!nextNodeId) {
    await markFailure(enrollment, workerId, `Node '${node.id}' has no executable continuation`);
    return { enrollment: null, status: 'failed' };
  }
  const advanced = await advanceEnrollment({
    id: enrollment.id,
    lockVersion: enrollment.lock_version,
    workerId,
    currentNodeId: nextNodeId,
    status: 'active',
    nextRunAt: null,
    releaseLock: false,
  });
  return { enrollment: advanced, status: advanced ? 'active' : 'lease_lost' };
}

/** Executes the safe, provider-neutral subset of the workflow graph. */
export async function executeWorkflowEnrollment(
  enrollmentId: string,
  workerId: string,
  jobId: string | undefined,
): Promise<{ status: string; processedNodes: number }> {
  let enrollment = await claimEnrollmentById(enrollmentId, new Date().toISOString(), workerId);
  if (!enrollment) return { status: 'not_due_or_already_claimed', processedNodes: 0 };

  const execution = await findEnrollmentExecutionById(enrollment.id);
  if (!execution) {
    await markFailure(enrollment, workerId, 'Workflow enrollment or version not found');
    return { status: 'failed', processedNodes: 0 };
  }
  if (execution.workflow_status !== 'published') {
    await advanceEnrollment({
      id: enrollment.id,
      lockVersion: enrollment.lock_version,
      workerId,
      currentNodeId: enrollment.current_node_id,
      status: 'paused',
      releaseLock: true,
    });
    return { status: 'paused', processedNodes: 0 };
  }

  const issues = validateWorkflowDefinition(execution.definition);
  if (issues.length > 0) {
    await markFailure(enrollment, workerId, `Invalid workflow definition: ${issues[0]?.message}`);
    return { status: 'failed', processedNodes: 0 };
  }

  const nodes = nodeMap(execution.definition.nodes);
  let processedNodes = 0;

  while (processedNodes < MAX_NODES_PER_JOB) {
    const node = nodes.get(enrollment.current_node_id);
    if (!node) {
      await markFailure(
        enrollment,
        workerId,
        `Unknown workflow node '${enrollment.current_node_id}'`,
      );
      return { status: 'failed', processedNodes };
    }

    const step = await recordStepRun({
      enrollmentId: enrollment.id,
      nodeId: node.id,
      nodeType: node.type,
      // This is a logical step key, not an attempt key. It stays stable when
      // a transient failure is retried so providers can deduplicate side
      // effects; the repository records each attempt separately.
      idempotencyKey: `${enrollment.id}:${node.id}`,
      jobId: jobId ?? null,
      input: node.type === 'action' ? { actionType: node.action?.type ?? null } : null,
      lockVersion: enrollment.lock_version,
      workerId,
    });

    if (step.status === 'succeeded' || step.status === 'skipped' || step.status === 'waiting') {
      const resumed = await resumeFinishedStep(enrollment, node, step, workerId);
      if (!resumed.enrollment) return { status: resumed.status, processedNodes };
      enrollment = resumed.enrollment;
      if (resumed.status !== 'active') return { status: resumed.status, processedNodes };
      processedNodes += 1;
      continue;
    }

    if (step.status === 'failed' || step.status === 'cancelled') {
      await markFailure(enrollment, workerId, step.error_message ?? 'Workflow step failed');
      return { status: 'failed', processedNodes };
    }

    if (node.type === 'action') {
      try {
        if (!node.action)
          throw new WorkflowActionError('INVALID_ACTION', 'Action configuration is missing.');

        const actionResult = await executeWorkflowAction(node.action, {
          leadId: enrollment.lead_id,
          actor: {
            id: execution.workflow_created_by ?? '',
            // A missing role is intentionally treated as non-mutating so the
            // action executor rejects internal actions instead of guessing.
            role: execution.workflow_created_by_role ?? 'marketing',
          },
          idempotencyKey: step.idempotency_key,
        });
        const stepResult = {
          actionType: actionResult.actionType,
          changed: actionResult.changed,
          details: actionResult.details ?? null,
        };
        const nextNodeId = resolveWorkflowNextNode(node, enrollment.context);
        if (!nextNodeId) {
          const failed = await finishStepAndAdvance({
            stepId: step.id,
            enrollmentId: enrollment.id,
            lockVersion: enrollment.lock_version,
            workerId,
            stepStatus: 'succeeded',
            stepResult,
            currentNodeId: node.id,
            enrollmentStatus: 'failed',
            lastError: `Node '${node.id}' has no executable continuation`,
            finishedAt: new Date().toISOString(),
            releaseLock: true,
          });
          return {
            status: failed ? 'failed' : 'lease_lost',
            processedNodes: processedNodes + 1,
          };
        }

        const transition = await finishStepAndAdvance({
          stepId: step.id,
          enrollmentId: enrollment.id,
          lockVersion: enrollment.lock_version,
          workerId,
          stepStatus: 'succeeded',
          stepResult,
          currentNodeId: nextNodeId,
          enrollmentStatus: 'active',
          nextRunAt: null,
          releaseLock: false,
        });
        if (!transition) return { status: 'lease_lost', processedNodes: processedNodes + 1 };
        enrollment = transition.enrollment;
        processedNodes += 1;
        continue;
      } catch (error) {
        const code = error instanceof WorkflowActionError ? error.code : 'ACTION_EXECUTION_FAILED';
        const message = error instanceof Error ? error.message : 'Workflow action failed';
        const retryable = isRetryableWorkflowError(error);
        const shouldRetry = retryable && step.attempt < MAX_STEP_ATTEMPTS;
        const failed = await finishStepAndAdvance({
          stepId: step.id,
          enrollmentId: enrollment.id,
          lockVersion: enrollment.lock_version,
          workerId,
          stepStatus: 'failed',
          errorCode: code,
          errorMessage: message,
          currentNodeId: node.id,
          enrollmentStatus: shouldRetry ? 'active' : 'failed',
          nextRunAt: shouldRetry ? retryRunAt(step.attempt) : null,
          lastError: `${code}: ${message}`,
          finishedAt: shouldRetry ? null : new Date().toISOString(),
          releaseLock: true,
        });
        if (!failed) return { status: 'lease_lost', processedNodes: processedNodes + 1 };
        if (shouldRetry) {
          logger.warn('workflow action failed; retry scheduled', {
            enrollmentId: enrollment.id,
            nodeId: node.id,
            attempt: step.attempt,
            nextRunAt: failed.enrollment.next_run_at,
            errorCode: code,
          });
          return { status: 'retry_scheduled', processedNodes: processedNodes + 1 };
        }
        return {
          status: code === 'ACTION_EXECUTION_DISABLED' ? 'action_blocked' : 'action_failed',
          processedNodes: processedNodes + 1,
        };
      }
    }

    if (node.type === 'wait') {
      const waiting = await finishStepAndAdvance({
        stepId: step.id,
        enrollmentId: enrollment.id,
        lockVersion: enrollment.lock_version,
        workerId,
        stepStatus: 'waiting',
        stepResult: { waitMinutes: node.waitMinutes },
        currentNodeId: node.next[0],
        enrollmentStatus: 'waiting',
        nextRunAt: nextRunAt(node.waitMinutes ?? 1),
        releaseLock: true,
      });
      return { status: waiting ? 'waiting' : 'lease_lost', processedNodes: processedNodes + 1 };
    }

    if (node.type === 'goal') {
      const goalMet = node.goal ? evaluateWorkflowCondition(node.goal, enrollment.context) : false;
      const enrollmentStatus = goalMet ? 'completed' : node.next.length === 0 ? 'exited' : 'active';
      const goalTransition = await finishStepAndAdvance({
        stepId: step.id,
        enrollmentId: enrollment.id,
        lockVersion: enrollment.lock_version,
        workerId,
        stepStatus: 'succeeded',
        stepResult: { goalMet },
        currentNodeId: goalMet || node.next.length === 0 ? node.id : node.next[0],
        enrollmentStatus,
        nextRunAt: null,
        finishedAt: enrollmentStatus === 'active' ? null : new Date().toISOString(),
        releaseLock: enrollmentStatus !== 'active',
      });
      if (!goalTransition) return { status: 'lease_lost', processedNodes: processedNodes + 1 };
      if (enrollmentStatus !== 'active') {
        return { status: enrollmentStatus, processedNodes: processedNodes + 1 };
      }
      enrollment = goalTransition.enrollment;
      processedNodes += 1;
      continue;
    }

    if (node.type === 'end') {
      const completed = await finishStepAndAdvance({
        stepId: step.id,
        enrollmentId: enrollment.id,
        lockVersion: enrollment.lock_version,
        workerId,
        stepStatus: 'succeeded',
        currentNodeId: node.id,
        enrollmentStatus: 'completed',
        finishedAt: new Date().toISOString(),
        releaseLock: true,
      });
      return { status: completed ? 'completed' : 'lease_lost', processedNodes: processedNodes + 1 };
    }

    const nextNodeId = resolveWorkflowNextNode(node, enrollment.context);
    if (!nextNodeId) {
      const failed = await finishStepAndAdvance({
        stepId: step.id,
        enrollmentId: enrollment.id,
        lockVersion: enrollment.lock_version,
        workerId,
        stepStatus: 'succeeded',
        currentNodeId: node.id,
        enrollmentStatus: 'failed',
        lastError: `Node '${node.id}' has no executable continuation`,
        finishedAt: new Date().toISOString(),
        releaseLock: true,
      });
      return {
        status: failed ? 'failed' : 'lease_lost',
        processedNodes: processedNodes + 1,
      };
    }
    const transition = await finishStepAndAdvance({
      stepId: step.id,
      enrollmentId: enrollment.id,
      lockVersion: enrollment.lock_version,
      workerId,
      stepStatus: 'succeeded',
      currentNodeId: nextNodeId,
      enrollmentStatus: 'active',
      nextRunAt: null,
      releaseLock: false,
    });
    if (!transition) return { status: 'lease_lost', processedNodes: processedNodes + 1 };
    enrollment = transition.enrollment;
    processedNodes += 1;
  }

  const continued = await advanceEnrollment({
    id: enrollment.id,
    lockVersion: enrollment.lock_version,
    workerId,
    currentNodeId: enrollment.current_node_id,
    status: 'active',
    nextRunAt: null,
    lastError: null,
    releaseLock: true,
  });
  return {
    status: continued ? 'continued' : 'lease_lost',
    processedNodes,
  };
}

let workflowScheduler: NodeJS.Timeout | null = null;

/** Enqueues due enrollments without claiming them, leaving ownership to workers. */
export async function sweepDueWorkflowEnrollments(limit = 100): Promise<number> {
  const ids = await findDueEnrollmentIds(new Date().toISOString(), limit);
  const results = await Promise.allSettled(
    ids.map((enrollmentId) =>
      enqueueWorkflowExecution({ enrollmentId }, { jobIdSuffix: recoveryJobSuffix() }),
    ),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error('failed to enqueue due workflow enrollment', {
        enrollmentId: ids[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
  return results.filter((result) => result.status === 'fulfilled').length;
}

export function startWorkflowScheduler(intervalMs = DEFAULT_SWEEP_INTERVAL_MS): NodeJS.Timeout {
  if (workflowScheduler) return workflowScheduler;
  const tick = (): void => {
    void sweepDueWorkflowEnrollments().catch((error: unknown) => {
      logger.error('workflow due-enrollment sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  tick();
  workflowScheduler = setInterval(tick, intervalMs);
  workflowScheduler.unref();
  return workflowScheduler;
}

export function startWorkflowWorker(): Worker<WorkflowExecuteEnrollmentJob> {
  const worker = new Worker<WorkflowExecuteEnrollmentJob>(
    WORKFLOW_QUEUE,
    async (job) => {
      const start = Date.now();
      const workerId = workerIdFor(job);
      try {
        if (job.name !== WORKFLOW_EXECUTE_ENROLLMENT)
          throw new Error(`Unknown workflow job '${job.name}'`);
        const result = await executeWorkflowEnrollment(job.data.enrollmentId, workerId, job.id);
        observeJobDuration({ name: job.name, queue: WORKFLOW_QUEUE }, (Date.now() - start) / 1000);
        incJobsProcessed({ name: job.name, queue: WORKFLOW_QUEUE, status: result.status });
        return result;
      } catch (error) {
        incJobsFailed({ name: job.name, queue: WORKFLOW_QUEUE });
        logger.error('workflow job failed', {
          jobId: job.id,
          enrollmentId: job.data.enrollmentId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { connection: getBullConnection() as unknown as ConnectionOptions, concurrency: 10 },
  );

  worker.on('ready', () => logger.info('workflow worker ready', { queue: WORKFLOW_QUEUE }));
  worker.on('failed', (job, error) => {
    logger.error('workflow worker failed job', { jobId: job?.id, error: error.message });
    Sentry.captureException(error, { extra: { jobId: job?.id, queue: WORKFLOW_QUEUE } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(WORKFLOW_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: error.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });
  return worker;
}
