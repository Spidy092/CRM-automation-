import { AppError } from '../../shared/middleware/errorHandler';
import { pool, withTransaction } from '../../shared/utils/db';
import type {
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowEnrollmentRow,
  WorkflowExecutionRecord,
  WorkflowExecutionContext,
  WorkflowRow,
  WorkflowStatus,
  WorkflowStepRunRow,
  WorkflowStepRunStatus,
  WorkflowTriggerCandidate,
  WorkflowTriggerType,
  WorkflowVersionRow,
} from './workflow.types';

interface WorkflowQueryRow extends WorkflowRow {
  version_id: string | null;
  version_workflow_id: string | null;
  version_number: number | null;
  version_definition: WorkflowDefinition | null;
  version_status: WorkflowVersionRow['status'] | null;
  version_created_by: string | null;
  version_published_at: string | null;
  version_created_at: string | null;
}

const WORKFLOW_SELECT = `
  w.id, w.name, w.description, w.status, w.created_by, w.created_at,
  w.updated_at, w.deleted_at,
  v.id AS version_id, v.workflow_id AS version_workflow_id,
  v.version AS version_number, v.definition AS version_definition,
  v.status AS version_status, v.created_by AS version_created_by,
  v.published_at AS version_published_at, v.created_at AS version_created_at
`;

function toDetail(row: WorkflowQueryRow): WorkflowDetail {
  const currentVersion =
    row.version_id &&
    row.version_workflow_id &&
    row.version_number !== null &&
    row.version_definition &&
    row.version_status &&
    row.version_created_by &&
    row.version_created_at
      ? {
          id: row.version_id,
          workflow_id: row.version_workflow_id,
          version: row.version_number,
          definition: row.version_definition,
          status: row.version_status,
          created_by: row.version_created_by,
          published_at: row.version_published_at,
          created_at: row.version_created_at,
        }
      : null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    current_version: currentVersion,
  };
}

const FROM_WITH_LATEST_VERSION = `
  FROM workflows w
  LEFT JOIN LATERAL (
    SELECT id, workflow_id, version, definition, status, created_by, published_at, created_at
    FROM workflow_versions
    WHERE workflow_id = w.id
    ORDER BY version DESC
    LIMIT 1
  ) v ON TRUE
`;

export async function findWorkflows(): Promise<WorkflowDetail[]> {
  const result = await pool.query<WorkflowQueryRow>(
    `SELECT ${WORKFLOW_SELECT}${FROM_WITH_LATEST_VERSION}
     WHERE w.deleted_at IS NULL
     ORDER BY w.updated_at DESC`,
  );
  return result.rows.map(toDetail);
}

export async function findWorkflowById(id: string): Promise<WorkflowDetail | null> {
  const result = await pool.query<WorkflowQueryRow>(
    `SELECT ${WORKFLOW_SELECT}${FROM_WITH_LATEST_VERSION}
     WHERE w.id = $1 AND w.deleted_at IS NULL`,
    [id],
  );
  return result.rows[0] ? toDetail(result.rows[0]) : null;
}

export async function insertWorkflow(input: {
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
  createdBy: string;
}): Promise<WorkflowDetail> {
  return withTransaction(async (client) => {
    const workflowResult = await client.query<WorkflowRow>(
      `INSERT INTO workflows (name, description, status, created_by)
       VALUES ($1, $2, 'draft', $3)
       RETURNING id, name, description, status, created_by, created_at, updated_at, deleted_at`,
      [input.name, input.description ?? null, input.createdBy],
    );
    const workflow = workflowResult.rows[0];
    if (!workflow) throw new AppError('Failed to create workflow', 500);

    const versionResult = await client.query<WorkflowVersionRow>(
      `INSERT INTO workflow_versions
       (workflow_id, version, definition, status, created_by)
       VALUES ($1, 1, $2::jsonb, 'draft', $3)
       RETURNING id, workflow_id, version, definition, status, created_by, published_at, created_at`,
      [workflow.id, JSON.stringify(input.definition), input.createdBy],
    );
    const version = versionResult.rows[0];
    if (!version) throw new AppError('Failed to create workflow version', 500);
    return { ...workflow, current_version: version };
  });
}

export async function publishWorkflow(id: string): Promise<WorkflowDetail> {
  return withTransaction(async (client) => {
    const workflowResult = await client.query<WorkflowRow>(
      `SELECT id, name, description, status, created_by, created_at, updated_at, deleted_at
       FROM workflows WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    const workflow = workflowResult.rows[0];
    if (!workflow) throw new AppError('Workflow not found', 404);

    const versionResult = await client.query<WorkflowVersionRow>(
      `SELECT id, workflow_id, version, definition, status, created_by, published_at, created_at
       FROM workflow_versions
       WHERE workflow_id = $1 AND status = 'draft'
       ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [id],
    );
    const version = versionResult.rows[0];
    if (!version) throw new AppError('Workflow has no draft version to publish', 400);

    await client.query(
      `UPDATE workflow_versions SET status = 'retired'
       WHERE workflow_id = $1 AND status = 'published'`,
      [id],
    );
    const publishedVersionResult = await client.query<WorkflowVersionRow>(
      `UPDATE workflow_versions
       SET status = 'published', published_at = NOW()
       WHERE id = $1
       RETURNING id, workflow_id, version, definition, status, created_by, published_at, created_at`,
      [version.id],
    );
    const publishedVersion = publishedVersionResult.rows[0];
    if (!publishedVersion) throw new AppError('Failed to publish workflow version', 500);

    const updatedResult = await client.query<WorkflowRow>(
      `UPDATE workflows SET status = 'published', updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, status, created_by, created_at, updated_at, deleted_at`,
      [id],
    );
    const updated = updatedResult.rows[0];
    if (!updated) throw new AppError('Failed to publish workflow', 500);
    return { ...updated, current_version: publishedVersion };
  });
}

export async function updateWorkflowStatus(
  id: string,
  status: WorkflowStatus,
): Promise<WorkflowDetail> {
  const result = await pool.query<WorkflowRow>(
    `UPDATE workflows SET status = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, name, description, status, created_by, created_at, updated_at, deleted_at`,
    [id, status],
  );
  if (!result.rows[0]) throw new AppError('Workflow not found', 404);
  const workflow = await findWorkflowById(id);
  if (!workflow) throw new AppError('Workflow not found', 404);
  return workflow;
}

export async function findPublishedWorkflowCandidates(
  eventType: WorkflowTriggerType,
): Promise<WorkflowTriggerCandidate[]> {
  const result = await pool.query<WorkflowTriggerCandidate>(
    `SELECT
       w.id AS workflow_id,
       v.id AS workflow_version_id,
       v.definition,
       node->>'id' AS trigger_node_id,
       node->'trigger' AS "trigger"
     FROM workflows w
     JOIN workflow_versions v ON v.workflow_id = w.id AND v.status = 'published'
     CROSS JOIN LATERAL jsonb_array_elements(v.definition->'nodes') AS node
     WHERE w.deleted_at IS NULL
       AND w.status = 'published'
       AND node->>'type' = 'trigger'
       AND node->'trigger'->>'event' = $1`,
    [eventType],
  );
  return result.rows;
}

export async function createEnrollmentIfAbsent(input: {
  workflowId: string;
  workflowVersionId: string;
  leadId: string;
  currentNodeId: string;
  triggerEventId: string;
  triggerEventType: string;
  context: WorkflowExecutionContext;
  nextRunAt?: string | null;
}): Promise<WorkflowEnrollmentRow | null> {
  const result = await pool.query<WorkflowEnrollmentRow>(
    `INSERT INTO workflow_enrollments
       (workflow_id, workflow_version_id, lead_id, current_node_id,
        trigger_event_id, trigger_event_type, context, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (workflow_id, trigger_event_id) DO NOTHING
     RETURNING id, workflow_id, workflow_version_id, lead_id, status,
       current_node_id, trigger_event_id, trigger_event_type, context,
       next_run_at, lock_version, locked_at, locked_by, last_error,
       enrolled_at, finished_at, updated_at`,
    [
      input.workflowId,
      input.workflowVersionId,
      input.leadId,
      input.currentNodeId,
      input.triggerEventId,
      input.triggerEventType,
      JSON.stringify(input.context),
      input.nextRunAt ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findEnrollmentById(id: string): Promise<WorkflowEnrollmentRow | null> {
  const result = await pool.query<WorkflowEnrollmentRow>(
    `SELECT id, workflow_id, workflow_version_id, lead_id, status,
       current_node_id, trigger_event_id, trigger_event_type, context,
       next_run_at, lock_version, locked_at, locked_by, last_error,
       enrolled_at, finished_at, updated_at
     FROM workflow_enrollments
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findEnrollmentExecutionById(
  id: string,
): Promise<WorkflowExecutionRecord | null> {
  const result = await pool.query<{
    enrollment: WorkflowEnrollmentRow;
    definition: WorkflowDefinition;
    workflow_status: WorkflowStatus;
    workflow_created_by: string;
    workflow_created_by_role: import('../../shared/types').UserRole | null;
  }>(
    `SELECT
       jsonb_build_object(
         'id', e.id,
         'workflow_id', e.workflow_id,
         'workflow_version_id', e.workflow_version_id,
         'lead_id', e.lead_id,
         'status', e.status,
         'current_node_id', e.current_node_id,
         'trigger_event_id', e.trigger_event_id,
         'trigger_event_type', e.trigger_event_type,
         'context', e.context,
         'next_run_at', e.next_run_at,
         'lock_version', e.lock_version,
         'locked_at', e.locked_at,
         'locked_by', e.locked_by,
         'last_error', e.last_error,
         'enrolled_at', e.enrolled_at,
         'finished_at', e.finished_at,
         'updated_at', e.updated_at
       ) AS enrollment,
       v.definition,
       w.status AS workflow_status,
       w.created_by AS workflow_created_by,
       u.role AS workflow_created_by_role
     FROM workflow_enrollments e
     JOIN workflow_versions v ON v.id = e.workflow_version_id
     JOIN workflows w ON w.id = e.workflow_id
     LEFT JOIN users u ON u.id = w.created_by
     WHERE e.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        enrollment: row.enrollment,
        definition: row.definition,
        workflow_status: row.workflow_status,
        workflow_created_by: row.workflow_created_by,
        workflow_created_by_role: row.workflow_created_by_role,
      }
    : null;
}

export async function claimEnrollmentById(
  id: string,
  now: string,
  workerId: string,
): Promise<WorkflowEnrollmentRow | null> {
  const result = await pool.query<WorkflowEnrollmentRow>(
    `UPDATE workflow_enrollments e
     SET status = 'active', locked_at = NOW(), locked_by = $3,
         lock_version = e.lock_version + 1, updated_at = NOW()
     WHERE e.id = $1
       AND e.status IN ('active', 'waiting')
       AND (e.next_run_at IS NULL OR e.next_run_at <= $2::timestamptz)
       AND (
         e.locked_by = $3
         OR e.locked_at IS NULL
         OR e.locked_at < NOW() - INTERVAL '5 minutes'
       )
       AND EXISTS (
         SELECT 1 FROM workflows w
         WHERE w.id = e.workflow_id
           AND w.status = 'published'
           AND w.deleted_at IS NULL
       )
     RETURNING e.id, e.workflow_id, e.workflow_version_id, e.lead_id, e.status,
       e.current_node_id, e.trigger_event_id, e.trigger_event_type, e.context,
       e.next_run_at, e.lock_version, e.locked_at, e.locked_by, e.last_error,
       e.enrolled_at, e.finished_at, e.updated_at`,
    [id, now, workerId],
  );
  return result.rows[0] ?? null;
}

export async function claimDueEnrollments(
  now: string,
  limit: number,
  workerId: string,
): Promise<WorkflowEnrollmentRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError('Workflow claim limit must be between 1 and 500', 422);
  }
  const result = await pool.query<WorkflowEnrollmentRow>(
    `WITH due AS (
       SELECT id
       FROM workflow_enrollments e
       WHERE status IN ('active', 'waiting')
         AND (next_run_at IS NULL OR next_run_at <= $1::timestamptz)
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
         AND EXISTS (
           SELECT 1 FROM workflows w
           WHERE w.id = e.workflow_id
             AND w.status = 'published'
             AND w.deleted_at IS NULL
         )
       ORDER BY COALESCE(next_run_at, enrolled_at), enrolled_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE workflow_enrollments e
     SET status = 'active', locked_at = NOW(), locked_by = $3,
         lock_version = e.lock_version + 1, updated_at = NOW()
     FROM due
     WHERE e.id = due.id
     RETURNING e.id, e.workflow_id, e.workflow_version_id, e.lead_id, e.status,
       e.current_node_id, e.trigger_event_id, e.trigger_event_type, e.context,
       e.next_run_at, e.lock_version, e.locked_at, e.locked_by, e.last_error,
       e.enrolled_at, e.finished_at, e.updated_at`,
    [now, limit, workerId],
  );
  return result.rows;
}

/** Returns due enrollment IDs without taking ownership; the scheduler only enqueues jobs. */
export async function findDueEnrollmentIds(now: string, limit: number): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError('Workflow due-scan limit must be between 1 and 500', 422);
  }
  const result = await pool.query<{ id: string }>(
    `SELECT e.id
     FROM workflow_enrollments e
     JOIN workflows w ON w.id = e.workflow_id
     WHERE e.status IN ('active', 'waiting')
       AND (e.next_run_at IS NULL OR e.next_run_at <= $1::timestamptz)
       AND (e.locked_at IS NULL OR e.locked_at < NOW() - INTERVAL '5 minutes')
       AND w.status = 'published'
       AND w.deleted_at IS NULL
     ORDER BY COALESCE(e.next_run_at, e.enrolled_at), e.enrolled_at
     LIMIT $2`,
    [now, limit],
  );
  return result.rows.map((row) => row.id);
}

export async function recordStepRun(input: {
  enrollmentId: string;
  nodeId: string;
  nodeType: WorkflowStepRunRow['node_type'];
  status?: WorkflowStepRunStatus;
  attempt?: number;
  idempotencyKey: string;
  jobId?: string | null;
  input?: Record<string, unknown> | null;
  lockVersion: number;
  workerId: string;
}): Promise<WorkflowStepRunRow> {
  return withTransaction(async (client) => {
    // The enrollment lease serializes attempts for one logical node. Locking
    // the row here also makes the max(attempt)+1 calculation safe if a stale
    // worker and a recovery worker overlap during lease reclamation.
    const leaseResult = await client.query<{ id: string }>(
      `SELECT id
       FROM workflow_enrollments
       WHERE id = $1 AND lock_version = $2 AND locked_by = $3
       FOR UPDATE`,
      [input.enrollmentId, input.lockVersion, input.workerId],
    );
    if (!leaseResult.rows[0]) {
      throw new AppError('Workflow lease lost before recording step run', 409);
    }

    const existingResult = await client.query<WorkflowStepRunRow>(
      `SELECT id, enrollment_id, node_id, node_type, status, attempt,
         idempotency_key, job_id, input, result, error_code, error_message,
         started_at, finished_at, created_at
       FROM workflow_step_runs
       WHERE enrollment_id = $1
         AND node_id = $2
         AND status IN ('queued', 'running', 'succeeded', 'waiting', 'skipped')
       ORDER BY attempt DESC, created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [input.enrollmentId, input.nodeId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      // A reclaimed job continues the same logical attempt. Refreshing the
      // job ID keeps the run history tied to the worker that owns the lease.
      if (input.jobId && existing.status === 'running' && existing.job_id !== input.jobId) {
        const updatedResult = await client.query<WorkflowStepRunRow>(
          `UPDATE workflow_step_runs
           SET job_id = $2
           WHERE id = $1
           RETURNING id, enrollment_id, node_id, node_type, status, attempt,
             idempotency_key, job_id, input, result, error_code, error_message,
             started_at, finished_at, created_at`,
          [existing.id, input.jobId],
        );
        return updatedResult.rows[0] ?? existing;
      }
      return existing;
    }

    const attemptResult = await client.query<{ attempt: number }>(
      `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
       FROM workflow_step_runs
       WHERE enrollment_id = $1 AND node_id = $2`,
      [input.enrollmentId, input.nodeId],
    );
    const nextAttempt = Number(attemptResult.rows[0]?.attempt ?? 1);
    const attempt = Math.max(input.attempt ?? 1, nextAttempt);
    const result = await client.query<WorkflowStepRunRow>(
      `INSERT INTO workflow_step_runs
         (enrollment_id, node_id, node_type, status, attempt,
          idempotency_key, job_id, input, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       RETURNING id, enrollment_id, node_id, node_type, status, attempt,
         idempotency_key, job_id, input, result, error_code, error_message,
         started_at, finished_at, created_at`,
      [
        input.enrollmentId,
        input.nodeId,
        input.nodeType,
        input.status ?? 'running',
        attempt,
        input.idempotencyKey,
        input.jobId ?? null,
        input.input ? JSON.stringify(input.input) : null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('Failed to record workflow step run', 500);
    return row;
  });
}

export async function finishStepRun(input: {
  id: string;
  enrollmentId: string;
  lockVersion: number;
  workerId: string;
  status: WorkflowStepRunStatus;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<WorkflowStepRunRow | null> {
  const values = [
    input.id,
    input.status,
    input.result === undefined ? null : JSON.stringify(input.result),
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.enrollmentId,
    input.lockVersion,
    input.workerId,
  ];
  const result = await pool.query<WorkflowStepRunRow>(
    `UPDATE workflow_step_runs
     SET status = $2, result = $3::jsonb, error_code = $4,
     error_message = $5, finished_at = NOW()
     WHERE id = $1
       AND EXISTS (
         SELECT 1 FROM workflow_enrollments e
         WHERE e.id = workflow_step_runs.enrollment_id
           AND e.id = $6 AND e.lock_version = $7 AND e.locked_by = $8
       )
     RETURNING id, enrollment_id, node_id, node_type, status, attempt,
       idempotency_key, job_id, input, result, error_code, error_message,
       started_at, finished_at, created_at`,
    values,
  );
  return result.rows[0] ?? null;
}

/**
 * Finalizes a step and advances its enrollment in one transaction. The lease
 * tuple is checked on both writes so a reclaimed worker cannot commit stale
 * state after a slow external call or process pause.
 */
export async function finishStepAndAdvance(input: {
  stepId: string;
  enrollmentId: string;
  lockVersion: number;
  workerId: string;
  stepStatus: WorkflowStepRunStatus;
  stepResult?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  currentNodeId: string;
  enrollmentStatus: WorkflowEnrollmentRow['status'];
  nextRunAt?: string | null;
  context?: WorkflowExecutionContext;
  lastError?: string | null;
  finishedAt?: string | null;
  releaseLock: boolean;
}): Promise<{ step: WorkflowStepRunRow; enrollment: WorkflowEnrollmentRow } | null> {
  return withTransaction(async (client) => {
    const stepResult = await client.query<WorkflowStepRunRow>(
      `UPDATE workflow_step_runs
       SET status = $2, result = $3::jsonb, error_code = $4,
           error_message = $5, finished_at = NOW()
       WHERE id = $1
         AND enrollment_id = $6
         AND EXISTS (
           SELECT 1 FROM workflow_enrollments e
           WHERE e.id = $6 AND e.lock_version = $7 AND e.locked_by = $8
         )
       RETURNING id, enrollment_id, node_id, node_type, status, attempt,
         idempotency_key, job_id, input, result, error_code, error_message,
         started_at, finished_at, created_at`,
      [
        input.stepId,
        input.stepStatus,
        input.stepResult === undefined ? null : JSON.stringify(input.stepResult),
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.enrollmentId,
        input.lockVersion,
        input.workerId,
      ],
    );
    const step = stepResult.rows[0];
    if (!step) return null;

    const enrollmentResult = await client.query<WorkflowEnrollmentRow>(
      `UPDATE workflow_enrollments
       SET status = $4, current_node_id = $5, next_run_at = $6,
           context = COALESCE($7::jsonb, context), last_error = $8,
           finished_at = $9, lock_version = lock_version + 1,
           locked_at = CASE WHEN $10::boolean THEN NULL ELSE locked_at END,
           locked_by = CASE WHEN $10::boolean THEN NULL ELSE locked_by END,
           updated_at = NOW()
       WHERE id = $1 AND lock_version = $2 AND locked_by = $3
       RETURNING id, workflow_id, workflow_version_id, lead_id, status,
         current_node_id, trigger_event_id, trigger_event_type, context,
         next_run_at, lock_version, locked_at, locked_by, last_error,
         enrolled_at, finished_at, updated_at`,
      [
        input.enrollmentId,
        input.lockVersion,
        input.workerId,
        input.enrollmentStatus,
        input.currentNodeId,
        input.nextRunAt ?? null,
        input.context === undefined ? null : JSON.stringify(input.context),
        input.lastError ?? null,
        input.finishedAt ?? null,
        input.releaseLock,
      ],
    );
    const enrollment = enrollmentResult.rows[0];
    if (!enrollment) throw new AppError('Workflow lease lost while advancing enrollment', 409);
    return { step, enrollment };
  });
}

export async function advanceEnrollment(input: {
  id: string;
  lockVersion: number;
  workerId: string;
  currentNodeId: string;
  status: WorkflowEnrollmentRow['status'];
  nextRunAt?: string | null;
  context?: WorkflowExecutionContext;
  lastError?: string | null;
  finishedAt?: string | null;
  releaseLock?: boolean;
}): Promise<WorkflowEnrollmentRow | null> {
  const releaseLock = input.releaseLock ?? true;
  const result = await pool.query<WorkflowEnrollmentRow>(
    `UPDATE workflow_enrollments
     SET status = $4, current_node_id = $5, next_run_at = $6,
         context = COALESCE($7::jsonb, context), last_error = $8,
         finished_at = $9, lock_version = lock_version + 1,
         locked_at = CASE WHEN $10::boolean THEN NULL ELSE locked_at END,
         locked_by = CASE WHEN $10::boolean THEN NULL ELSE locked_by END,
         updated_at = NOW()
     WHERE id = $1 AND lock_version = $2 AND locked_by = $3
     RETURNING id, workflow_id, workflow_version_id, lead_id, status,
       current_node_id, trigger_event_id, trigger_event_type, context,
       next_run_at, lock_version, locked_at, locked_by, last_error,
       enrolled_at, finished_at, updated_at`,
    [
      input.id,
      input.lockVersion,
      input.workerId,
      input.status,
      input.currentNodeId,
      input.nextRunAt ?? null,
      input.context === undefined ? null : JSON.stringify(input.context),
      input.lastError ?? null,
      input.finishedAt ?? null,
      releaseLock,
    ],
  );
  return result.rows[0] ?? null;
}

/** Reopens a failed enrollment at its current node for an operator-approved replay. */
export async function replayFailedEnrollment(
  id: string,
  now = new Date().toISOString(),
): Promise<WorkflowEnrollmentRow | null> {
  const result = await pool.query<WorkflowEnrollmentRow>(
    `UPDATE workflow_enrollments
     SET status = 'active', next_run_at = $2::timestamptz, last_error = NULL,
         finished_at = NULL, locked_at = NULL, locked_by = NULL,
         lock_version = lock_version + 1, updated_at = NOW()
     WHERE id = $1 AND status = 'failed'
     RETURNING id, workflow_id, workflow_version_id, lead_id, status,
       current_node_id, trigger_event_id, trigger_event_type, context,
       next_run_at, lock_version, locked_at, locked_by, last_error,
       enrolled_at, finished_at, updated_at`,
    [id, now],
  );
  return result.rows[0] ?? null;
}

export async function findEnrollmentTimeline(
  enrollmentId: string,
  limit = 100,
): Promise<WorkflowStepRunRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError('Workflow timeline limit must be between 1 and 500', 422);
  }
  const result = await pool.query<WorkflowStepRunRow>(
    `SELECT id, enrollment_id, node_id, node_type, status, attempt,
       idempotency_key, job_id, input, result, error_code, error_message,
       started_at, finished_at, created_at
     FROM workflow_step_runs
     WHERE enrollment_id = $1
     ORDER BY created_at DESC, attempt DESC
     LIMIT $2`,
    [enrollmentId, limit],
  );
  return result.rows;
}
