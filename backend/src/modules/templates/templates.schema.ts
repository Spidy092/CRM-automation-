import { z } from 'zod';
import { MessageChannel, TemplateApprovalStatus } from '../../shared/types';

const channelEnum = z.enum(['whatsapp', 'email', 'sms', 'phone_call']) as z.ZodEnum<
  [MessageChannel, ...MessageChannel[]]
>;

const approvalStatusEnum = z.enum(['pending', 'approved', 'rejected']) as z.ZodEnum<
  [TemplateApprovalStatus, ...TemplateApprovalStatus[]]
>;

export const templateIdParamSchema = z.object({
  id: z.string().uuid('Template id must be a valid UUID'),
});

const editorModeEnum = z.enum(['simple', 'visual', 'html']);

const baseTemplateSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  channel: channelEnum,
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1, 'body is required'),
  variables: z.array(z.string()).optional(),
  editor_mode: editorModeEnum.optional(),
  /** Versioned visual-design document — validated server-side when mode is visual. */
  design: z.unknown().optional().nullable(),
  preheader: z.string().max(300).optional().nullable(),
});

export const createTemplateSchema = baseTemplateSchema;

export const updateTemplateSchema = baseTemplateSchema.partial();

export const listTemplatesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  channel: channelEnum.optional(),
  approval_status: approvalStatusEnum.optional(),
  search: z.string().max(255).optional(),
  include_archived: z.coerce.boolean().optional(),
  archived_only: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
});

export const approveTemplateSchema = z.object({
  approved: z.boolean(),
  rejection_reason: z.string().optional().nullable(),
});

export const duplicateTemplateSchema = z.object({
  name: z.string().min(1, 'name is required').max(255).optional(),
});

export const previewTemplateSchema = z.object({
  /** Override sample personalization values for preview (never real lead PII). */
  sample_values: z.record(z.string()).optional(),
});

export const testSendTemplateSchema = z.object({
  /** User-authorized recipient only — never a lead address harvested elsewhere. */
  to: z.string().email('to must be a valid email address'),
  sample_values: z.record(z.string()).optional(),
});

export const attachFromLibrarySchema = z.object({
  file_id: z.string().uuid('file_id must be a valid UUID'),
});

export const attachmentIdParamSchema = z.object({
  id: z.string().uuid('Template id must be a valid UUID'),
  attachmentId: z.string().uuid('Attachment id must be a valid UUID'),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ApproveTemplateInput = z.infer<typeof approveTemplateSchema>;
