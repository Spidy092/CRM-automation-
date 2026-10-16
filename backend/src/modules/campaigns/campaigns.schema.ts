import { z } from 'zod';

export const enrollmentOptionsQuerySchema = z.object({}).strict();
const triggerValuesSchema = z
  .array(
    z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'Trigger labels must not be blank'),
  )
  .transform((values) => [...new Set(values)])
  .nullable()
  .optional();

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const sendWindowFields = {
  send_window_enabled: z.boolean().optional(),
  send_window_start_hour: z.number().int().min(0).max(23).optional(),
  send_window_end_hour: z.number().int().min(1).max(24).optional(),
  send_window_days: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, {
      message: 'send_window_days must not contain duplicates',
    })
    .optional(),
  send_window_timezone: z
    .string()
    .max(64)
    .refine(isValidTimezone, { message: 'Invalid IANA timezone' })
    .optional(),
  daily_send_limit: z.number().int().min(1).max(100000).nullable().optional(),
};

function sendWindowHoursValid(data: {
  send_window_start_hour?: number;
  send_window_end_hour?: number;
}): boolean {
  if (data.send_window_start_hour === undefined || data.send_window_end_hour === undefined) {
    return true;
  }
  return data.send_window_start_hour < data.send_window_end_hour;
}

const sendWindowHoursIssue = {
  message: 'send_window_start_hour must be before send_window_end_hour',
  path: ['send_window_start_hour'],
};

export const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(255),
    tone: z.enum(['formal', 'professional', 'conversational']).optional().default('professional'),
    target_industries: z.array(z.string()).optional().default([]),
    target_countries: z.array(z.string()).optional().default([]),
    sequence_id: z.string().uuid().optional(),
    pipeline_id: z.string().uuid().nullable().optional(),
    trigger_stage_id: z.string().uuid().optional().nullable(),
    trigger_source: triggerValuesSchema,
    trigger_tags: triggerValuesSchema,
    ai_personalization_enabled: z.boolean().optional().default(false),
    ab_test_enabled: z.boolean().optional().default(false),
    ab_test_metric: z
      .enum(['open_rate', 'click_rate', 'reply_rate'])
      .optional()
      .default('open_rate'),
    ab_test_min_samples: z.number().int().min(10).max(10000).optional().default(100),
    ab_test_confidence: z.number().min(80).max(99.99).optional().default(95),
    ab_test_auto_promote: z.boolean().optional().default(true),
    ...sendWindowFields,
  })
  .refine(sendWindowHoursValid, sendWindowHoursIssue);

export const updateCampaignSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    tone: z.enum(['formal', 'professional', 'conversational']).optional(),
    target_industries: z.array(z.string()).optional(),
    target_countries: z.array(z.string()).optional(),
    sequence_id: z.string().uuid().optional(),
    pipeline_id: z.string().uuid().nullable().optional(),
    trigger_stage_id: z.string().uuid().optional().nullable(),
    trigger_source: triggerValuesSchema,
    trigger_tags: triggerValuesSchema,
    ai_personalization_enabled: z.boolean().optional(),
    ab_test_enabled: z.boolean().optional(),
    ab_test_metric: z.enum(['open_rate', 'click_rate', 'reply_rate']).optional(),
    ab_test_min_samples: z.number().int().min(10).max(10000).optional(),
    ab_test_confidence: z.number().min(80).max(99.99).optional(),
    ab_test_auto_promote: z.boolean().optional(),
    ...sendWindowFields,
  })
  .refine(sendWindowHoursValid, sendWindowHoursIssue);

export const addLeadsSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type AddLeadsInput = z.infer<typeof addLeadsSchema>;

// ── Campaign operations (phases 1–2) ─────────────────────────────────────────

export const campaignIdParamSchema = z.object({
  id: z.string().uuid('Campaign id must be a valid UUID'),
});

export const campaignLeadParamSchema = z.object({
  id: z.string().uuid('Campaign id must be a valid UUID'),
  leadId: z.string().uuid('Lead id must be a valid UUID'),
});

export const operationsSummaryQuerySchema = z.object({
  ids: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
});

export const scheduleQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  includeProjected: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2000).optional(),
});

export const enrollmentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2000).optional(),
  enrollmentStatus: z.enum(['active', 'paused', 'completed', 'stopped']).optional(),
  search: z.string().trim().min(1).max(255).optional(),
});

export const pauseEnrollmentSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  expectedGeneration: z.number().int().min(0),
});

export const resumeEnrollmentSchema = z.object({
  expectedGeneration: z.number().int().min(0),
  /** Explicit schedule — required when the enrollment lost its timing. */
  nextDueAt: z.string().datetime({ offset: true }).optional(),
});

export type OperationsSummaryQuery = z.infer<typeof operationsSummaryQuerySchema>;
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type EnrollmentsQuery = z.infer<typeof enrollmentsQuerySchema>;
export type PauseEnrollmentInput = z.infer<typeof pauseEnrollmentSchema>;
export type ResumeEnrollmentInput = z.infer<typeof resumeEnrollmentSchema>;
