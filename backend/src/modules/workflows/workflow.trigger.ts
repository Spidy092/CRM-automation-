import { evaluateWorkflowCondition } from './workflow.engine';
import { createEnrollmentIfAbsent, findPublishedWorkflowCandidates } from './workflow.repository';
import type { WorkflowTriggerType } from './workflow.types';
import { enqueueWorkflowExecution } from '../../workers/queue';

/** Events emitted by legacy modules that have an explicit workflow alias. */
const triggerAliases: Record<string, WorkflowTriggerType | undefined> = {
  'lead.stage_moved': 'lead.stage_changed',
};

const supportedTriggerEvents = new Set<WorkflowTriggerType>([
  'lead.created',
  'lead.updated',
  'lead.stage_changed',
  'lead.tag_added',
  'form.submitted',
  'message.event',
  'booking.created',
  'booking.cancelled',
  'webhook.received',
  'schedule.reached',
]);

export interface WorkflowDomainEvent {
  eventId: string;
  eventType: string;
  leadId: string;
  payload: Record<string, unknown>;
}

export interface WorkflowTriggerResult {
  considered: number;
  enrolled: number;
  filtered: number;
}

function canonicalTriggerType(eventType: string): WorkflowTriggerType | null {
  const canonical = triggerAliases[eventType] ?? eventType;
  return supportedTriggerEvents.has(canonical as WorkflowTriggerType)
    ? (canonical as WorkflowTriggerType)
    : null;
}

/**
 * Enrolls published workflows for one durable domain event. The event ID is
 * persisted as the dedupe key, so queue retries cannot create a second
 * enrollment for the same workflow/event pair.
 */
export async function enrollWorkflowsForEvent(
  event: WorkflowDomainEvent,
): Promise<WorkflowTriggerResult> {
  const triggerType = canonicalTriggerType(event.eventType);
  if (!triggerType) return { considered: 0, enrolled: 0, filtered: 0 };

  const candidates = await findPublishedWorkflowCandidates(triggerType);
  const context = {
    ...event.payload,
    leadId: event.leadId,
    event: {
      id: event.eventId,
      type: event.eventType,
      payload: event.payload,
    },
  };
  let enrolled = 0;
  let filtered = 0;

  for (const candidate of candidates) {
    if (
      candidate.trigger.filters &&
      !evaluateWorkflowCondition(candidate.trigger.filters, context)
    ) {
      filtered += 1;
      continue;
    }

    const enrollment = await createEnrollmentIfAbsent({
      workflowId: candidate.workflow_id,
      workflowVersionId: candidate.workflow_version_id,
      leadId: event.leadId,
      currentNodeId: candidate.trigger_node_id,
      triggerEventId: event.eventId,
      triggerEventType: event.eventType,
      context,
    });
    if (!enrollment) continue;

    await enqueueWorkflowExecution({ enrollmentId: enrollment.id });
    enrolled += 1;
  }

  return { considered: candidates.length, enrolled, filtered };
}
