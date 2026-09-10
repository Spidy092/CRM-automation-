import type { UserRole } from '../../shared/types';

/**
 * The provider-neutral workflow contract.
 *
 * Campaigns and outreach sequences remain backwards compatible. This contract
 * is deliberately pure data so it can be persisted and previewed; the worker
 * delegates approved mutations to module service interfaces.
 */

export type WorkflowNodeType = 'trigger' | 'condition' | 'action' | 'wait' | 'goal' | 'end';

export type WorkflowTriggerType =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.stage_changed'
  | 'lead.tag_added'
  | 'form.submitted'
  | 'message.event'
  | 'booking.created'
  | 'booking.cancelled'
  | 'webhook.received'
  | 'schedule.reached';

export type WorkflowActionType =
  | 'lead.update'
  | 'lead.add_tag'
  | 'lead.remove_tag'
  | 'lead.assign'
  | 'pipeline.move'
  | 'task.create'
  | 'message.send'
  | 'sequence.enroll'
  | 'notification.send'
  | 'webhook.call';

export type WorkflowComparisonOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'exists';

export type WorkflowScalar = string | number | boolean | null;

export interface WorkflowFieldCondition {
  field: string;
  operator: WorkflowComparisonOperator;
  value?: WorkflowScalar | WorkflowScalar[];
}

export type WorkflowCondition =
  | WorkflowFieldCondition
  | { all: WorkflowCondition[] }
  | { any: WorkflowCondition[] }
  | { not: WorkflowCondition };

export interface WorkflowTriggerConfig {
  event: WorkflowTriggerType;
  filters?: WorkflowCondition;
}

export interface WorkflowActionConfig {
  type: WorkflowActionType;
  input: Record<string, WorkflowScalar | WorkflowScalar[]>;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  next: string[];
  /** Condition nodes must declare explicit true/false destinations. */
  branches?: { true: string; false: string };
  trigger?: WorkflowTriggerConfig;
  condition?: WorkflowCondition;
  action?: WorkflowActionConfig;
  waitMinutes?: number;
  goal?: WorkflowCondition;
}

export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string | null;
  entryNodeId: string;
  nodes: WorkflowNode[];
}

export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export type WorkflowStatus = 'draft' | 'published' | 'paused' | 'archived';
export type WorkflowVersionStatus = 'draft' | 'published' | 'retired';

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  definition: WorkflowDefinition;
  status: WorkflowVersionStatus;
  created_by: string;
  published_at: string | null;
  created_at: string;
}

export interface WorkflowDetail extends WorkflowRow {
  current_version: WorkflowVersionRow | null;
}

export type WorkflowExecutionContext = Record<string, unknown>;
export type WorkflowEnrollmentStatus =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'exited'
  | 'cancelled';
export type WorkflowStepRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export interface WorkflowTriggerCandidate {
  workflow_id: string;
  workflow_version_id: string;
  definition: WorkflowDefinition;
  trigger_node_id: string;
  trigger: WorkflowTriggerConfig;
}

export interface WorkflowEnrollmentRow {
  id: string;
  workflow_id: string;
  workflow_version_id: string;
  lead_id: string;
  status: WorkflowEnrollmentStatus;
  current_node_id: string;
  trigger_event_id: string;
  trigger_event_type: string;
  context: WorkflowExecutionContext;
  next_run_at: string | null;
  lock_version: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  enrolled_at: string;
  finished_at: string | null;
  updated_at: string;
}

export interface WorkflowExecutionRecord {
  enrollment: WorkflowEnrollmentRow;
  definition: WorkflowDefinition;
  workflow_status: WorkflowStatus;
  workflow_created_by: string;
  workflow_created_by_role: UserRole | null;
}

export interface WorkflowStepRunRow {
  id: string;
  enrollment_id: string;
  node_id: string;
  node_type: WorkflowNodeType;
  status: WorkflowStepRunStatus;
  attempt: number;
  idempotency_key: string;
  job_id: string | null;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
