/**
 * Zod schemas for the outreach module.
 *
 * Conventions (per AGENTS.md Input Validation Rules):
 *   • Every request body / query / param is validated here.
 *   • Request and response types are inferred via `z.infer` — never duplicated.
 *   • UUID strings use `.uuid()`; ISO 8601 timestamps use `.datetime()`.
 *
 * The phone_call branch is intentionally a first-class value in the channel
 * enum (PRD §6.1: WhatsApp → Email → SMS → Phone Call). It never auto-sends.
 */
import { z } from 'zod';
import { MessageChannel } from '../../shared/types';

// ── Shared enums ────────────────────────────────────────────────────────────

const channelEnum = z.enum(['whatsapp', 'email', 'sms', 'phone_call']) as z.ZodEnum<
  [MessageChannel, ...MessageChannel[]]
>;

// ── Sequences ──────────────────────────────────────────────────────────────

export const sequenceIdParamSchema = z.object({
  id: z.string().uuid('Sequence id must be a valid UUID'),
});

export const sequenceStepSchema = z.object({
  stepNumber: z.number().int().min(1),
  channel: channelEnum,
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30), // capped at ~30 days
  templateId: z.string().uuid(),
});

export const createSequenceSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  steps: z.array(sequenceStepSchema).min(1, 'At least one step is required'),
});

export const updateSequenceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  steps: z.array(sequenceStepSchema).min(1).optional(),
});

export const listSequencesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── Logs / timeline ────────────────────────────────────────────────────────

export const leadIdParamSchema = z.object({
  leadId: z.string().uuid('Lead id must be a valid UUID'),
});

export const listLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  channel: channelEnum.optional(),
  status: z.string().optional(),
});

// ── Tasks ──────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  leadId: z.string().uuid(),
  campaignId: z.string().uuid().optional().nullable(),
  sequenceId: z.string().uuid().optional().nullable(),
  stepNumber: z.number().int().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  type: z.enum(['phone_call', 'follow_up', 'meeting_prep', 'other']),
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

export const updateTaskSchema = z.object({
  assignedTo: z.string().uuid().optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
});

export const taskIdParamSchema = z.object({
  id: z.string().uuid('Task id must be a valid UUID'),
});

export const listTasksQuerySchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  assignedTo: z.enum(['me']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const manualSendSchema = z.object({
  leadId: z.string().uuid(),
  campaignId: z.string().uuid(),
  sequenceId: z.string().uuid(),
  stepNumber: z.number().int().min(1),
  channel: channelEnum,
  templateId: z.string().uuid(),
  mockMode: z.boolean().optional().default(false),
});

// ── Campaign launch ────────────────────────────────────────────────────────

/**
 * Triggered by the campaigns service (or admin) when a campaign goes live.
 * Enqueues the first step for every joined lead — but step 1 is also re-enqueued
 * here for manual re-launch / re-test.
 */
export const launchCampaignSchema = z.object({
  campaignId: z.string().uuid(),
  sequenceId: z.string().uuid(),
  mockMode: z.boolean().optional().default(false),
});

// ── Inferred request types ─────────────────────────────────────────────────

export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema>;
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ManualSendInput = z.infer<typeof manualSendSchema>;
export type LaunchCampaignInput = z.infer<typeof launchCampaignSchema>;
