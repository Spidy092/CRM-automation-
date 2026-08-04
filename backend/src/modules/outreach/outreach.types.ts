import { MessageChannel, OutreachStatus, TaskStatus, TaskType } from '../../shared/types';

// ── Outreach Sequences ────────────────────────────────────────────────────

export interface SequenceStep {
  stepNumber: number;
  channel: MessageChannel;
  /** Hours to wait after the previous step before dispatching this one. */
  delayHours: number;
  templateId: string;
}

export interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  steps: SequenceStep[];
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SequenceInput {
  name: string;
  description?: string | null;
  is_active?: boolean;
  steps: SequenceStep[];
}

export interface SequenceEnrollmentStats {
  /** Leads currently inside a campaign that uses this sequence (not yet completed all steps). */
  currently_in: number;
  /** Leads that have a completed outreach log for the final step of this sequence. */
  completed: number;
  /** Leads that were removed from a campaign using this sequence (lead status paused/won/lost/opted_out). */
  removed: number;
}

// ── Outreach Logs ─────────────────────────────────────────────────────────

export interface OutreachLogRow {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  channel: MessageChannel;
  template_id: string | null;
  step_number: number | null;
  status: OutreachStatus;
  external_msg_id: string | null;
  message_body: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  click_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachLogInput {
  leadId: string;
  campaignId?: string | null;
  channel: MessageChannel;
  templateId?: string | null;
  stepNumber?: number | null;
  status?: OutreachStatus;
  messageBody?: string | null;
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  step_number: number | null;
  assigned_to: string | null;
  type: TaskType;
  title: string;
  description: string | null;
  due_at: string | null;
  status: TaskStatus;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskInput {
  leadId: string;
  campaignId?: string | null;
  sequenceId?: string | null;
  stepNumber?: number | null;
  assignedTo?: string | null;
  type: TaskType;
  title: string;
  description?: string | null;
  dueAt?: string | null;
}

// ── Timeline ──────────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  type: 'outreach_log' | 'task';
  lead_id: string;
  campaign_id: string | null;
  status: string;
  channel: MessageChannel | 'phone_call' | 'follow_up';
  body: string | null;
  created_at: string;
}

// ── Actor ─────────────────────────────────────────────────────────────────

export interface OutreachActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}
