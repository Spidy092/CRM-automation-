import { z } from 'zod';

export const manualAssignmentSchema = z.object({
  lead_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export const overrideAssignmentSchema = z.object({
  lead_id: z.string().uuid(),
  new_user_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const updateAssignmentConfigSchema = z.object({
  is_enabled: z.boolean().optional(),
  threshold_score: z.number().int().min(0).max(100).optional(),
  eligible_roles: z.array(z.string()).optional(),
});

export type ManualAssignmentInput = z.infer<typeof manualAssignmentSchema>;
export type OverrideAssignmentInput = z.infer<typeof overrideAssignmentSchema>;
export type UpdateAssignmentConfigInput = z.infer<typeof updateAssignmentConfigSchema>;
